// Helix Tool Execution & Security Confinement (Phase 03)
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { isInside } from "../../cli/safe-write.ts";
import type { ToolExecutionContext, ToolExecutionResult, ToolExecutor } from "./types.ts";

export class ToolSecurityError extends Error {
  public readonly violatedPath?: string;

  constructor(message: string, violatedPath?: string) {
    super(`Tool security violation: ${message}${violatedPath ? ` (${violatedPath})` : ""}`);
    this.name = "ToolSecurityError";
    this.violatedPath = violatedPath;
  }
}

export const SENSITIVE_PATTERNS = [
  /(?:^|[/\\])\.env(?:\..+)?$/i,
  /(?:^|[/\\])secrets[/\\]/i,
  /(?:^|[/\\])\.git[/\\]/i,
  /(?:^|[/\\])\.ssh[/\\]/i,
  /(?:^|[/\\])\.aws[/\\]/i,
  /\.(?:pem|key|pfx|pkcs12)$/i,
];

/**
 * Checks whether a relative or absolute path violates forbidden patterns or sensitive lists.
 */
export function isForbidden(targetPath: string, customForbidden: string[] = []): boolean {
  const normalized = targetPath.replace(/\\/g, "/");

  for (const re of SENSITIVE_PATTERNS) {
    if (re.test(normalized)) return true;
  }

  for (const pattern of customForbidden) {
    const cleanPattern = pattern.replace(/\\/g, "/");
    if (cleanPattern.endsWith("/")) {
      if (
        normalized === cleanPattern.slice(0, -1) ||
        normalized.startsWith(cleanPattern) ||
        normalized.includes("/" + cleanPattern)
      ) {
        return true;
      }
    } else if (cleanPattern.includes("*")) {
      const regexStr = "^" + cleanPattern.replace(/\./g, "\\.").replace(/\*/g, ".*") + "$";
      if (new RegExp(regexStr).test(path.basename(normalized))) {
        return true;
      }
    } else {
      if (
        normalized === cleanPattern ||
        normalized.endsWith("/" + cleanPattern) ||
        normalized.startsWith(cleanPattern + "/")
      ) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Resolves and validates that the candidate path is strictly contained within root.
 */
export function resolveSafePath(
  workspaceRoot: string,
  candidatePath: string,
  forbidden: string[] = [],
): string {
  const rootReal = fs.existsSync(workspaceRoot)
    ? fs.realpathSync(workspaceRoot)
    : path.resolve(workspaceRoot);

  const resolved = path.isAbsolute(candidatePath)
    ? path.resolve(candidatePath)
    : path.resolve(rootReal, candidatePath);

  // Containment check
  if (!isInside(rootReal, resolved)) {
    throw new ToolSecurityError(
      `Access denied: path escapes workspace root [${rootReal}]`,
      candidatePath,
    );
  }

  // Deny-list check
  const rel = path.relative(rootReal, resolved);
  if (isForbidden(rel, forbidden)) {
    throw new ToolSecurityError(
      "Access denied: path matches forbidden pattern or security boundary",
      candidatePath,
    );
  }

  return resolved;
}

export type CachedFileRead = {
  content: string;
  mtimeMs: number;
  size: number;
  readCount: number;
};

export class DefaultToolExecutor implements ToolExecutor {
  private fileReadCache = new Map<string, CachedFileRead>();
  private repeatedReadCount = 0;

  getRepeatedReadCount(): number {
    return this.repeatedReadCount;
  }

  clearCache(): void {
    this.fileReadCache.clear();
    this.repeatedReadCount = 0;
  }

  async executeCommand(
    command: string,
    context: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    const t0 = Date.now();
    const timeoutMs = context.timeoutMs > 0 ? context.timeoutMs : 30000;
    const maxBytes = context.maxOutputBytes > 0 ? context.maxOutputBytes : 4096;

    // Check if command references sensitive system directories
    if (/\b(~|\$HOME)\/(\.ssh|\.aws|\.gnupg)\b/.test(command)) {
      return {
        exitCode: 1,
        output: "Command blocked by security policy: access to sensitive credentials detected",
        truncated: false,
        durationMs: 0,
        error: "SecurityViolation",
      };
    }

    return new Promise((resolve) => {
      let stdoutFull = "";
      let stdoutTail = "";
      let stdoutTotal = 0;

      let stderrFull = "";
      let stderrTail = "";
      let stderrTotal = 0;

      let killed = false;

      const headBytes = Math.floor(maxBytes * 0.6);
      const tailBytes = Math.max(0, maxBytes - headBytes);

      const isPosix = process.platform !== "win32";
      const proc = spawn(command, {
        shell: true,
        cwd: context.workspaceRoot,
        env: { ...process.env, ...context.environmentVariables },
        stdio: ["ignore", "pipe", "pipe"],
        detached: isPosix,
      });

      const timer = setTimeout(() => {
        killed = true;
        try {
          if (isPosix && proc.pid) {
            process.kill(-proc.pid, "SIGKILL");
          } else {
            proc.kill("SIGKILL");
          }
        } catch {
          // Process might already be dead
        }
      }, timeoutMs);

      proc.stdout?.on("data", (chunk: Buffer) => {
        const text = chunk.toString("utf8");
        stdoutTotal += text.length;
        if (stdoutFull.length < maxBytes) {
          stdoutFull += text;
        }
        stdoutTail += text;
        if (stdoutTail.length > tailBytes) {
          stdoutTail = stdoutTail.slice(stdoutTail.length - tailBytes);
        }
      });

      proc.stderr?.on("data", (chunk: Buffer) => {
        const text = chunk.toString("utf8");
        stderrTotal += text.length;
        if (stderrFull.length < maxBytes) {
          stderrFull += text;
        }
        stderrTail += text;
        if (stderrTail.length > tailBytes) {
          stderrTail = stderrTail.slice(stderrTail.length - tailBytes);
        }
      });

      proc.on("error", (err) => {
        clearTimeout(timer);
        const durationMs = Date.now() - t0;
        resolve({
          exitCode: 1,
          output: stderrFull || err.message,
          truncated: false,
          durationMs,
          error: err.message,
        });
      });

      proc.on("close", (code) => {
        clearTimeout(timer);
        const durationMs = Date.now() - t0;

        const formatStream = (
          full: string,
          tail: string,
          total: number,
        ): { text: string; wasTruncated: boolean } => {
          if (total <= maxBytes) {
            return { text: full, wasTruncated: false };
          }
          const head = full.slice(0, headBytes);
          const omitted = Math.max(0, total - (head.length + tail.length));
          return {
            text: `${head}\n\n[... output truncated: ${omitted} bytes omitted to preserve token budget ...]\n\n${tail}`,
            wasTruncated: true,
          };
        };

        const outRes = formatStream(stdoutFull, stdoutTail, stdoutTotal);
        const errRes = formatStream(stderrFull, stderrTail, stderrTotal);

        let output = outRes.text;
        if (errRes.text) {
          output = output ? `${output}\n${errRes.text}` : errRes.text;
        }

        const truncated = outRes.wasTruncated || errRes.wasTruncated;

        if (killed) {
          resolve({
            exitCode: 124,
            output: output
              ? `${output}\n[command timed out after ${timeoutMs}ms]`
              : `[command timed out after ${timeoutMs}ms]`,
            truncated,
            durationMs,
            error: "ETIMEDOUT",
          });
          return;
        }

        resolve({
          exitCode: code ?? 0,
          output: output.trimEnd(),
          truncated,
          durationMs,
        });
      });
    });
  }

  async readFile(
    filePath: string,
    startLine?: number,
    endLine?: number,
    context?: ToolExecutionContext,
  ): Promise<string> {
    const root = context?.workspaceRoot || process.cwd();
    const safePath = resolveSafePath(root, filePath, context?.forbiddenPaths);

    if (!fs.existsSync(safePath)) {
      throw new Error(`File does not exist: ${filePath}`);
    }

    const stat = fs.statSync(safePath);
    if (!stat.isFile()) {
      throw new Error(`Path is not a regular file: ${filePath}`);
    }

    const cacheKey = `${safePath}:${stat.mtimeMs}:${stat.size}:${startLine ?? 1}:${endLine ?? -1}`;
    const cached = this.fileReadCache.get(cacheKey);
    if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
      cached.readCount++;
      this.repeatedReadCount++;
      return cached.content;
    }

    const content = fs.readFileSync(safePath, "utf8");
    let result: string;

    if (startLine !== undefined || endLine !== undefined) {
      const lines = content.split("\n");
      const start = Math.max(1, startLine ?? 1) - 1;
      const end = endLine !== undefined ? Math.min(lines.length, endLine) : lines.length;
      result = lines.slice(start, end).join("\n");
    } else {
      const lines = content.split("\n");
      // Output control: if whole file has > 200 lines and no bounds provided, clamp to first 200 lines
      if (lines.length > 200) {
        result = [
          ...lines.slice(0, 200),
          `\n// [Output control: File has ${lines.length} lines; clamped to first 200 lines to avoid token blowout. Request targeted line ranges to inspect further.]`,
        ].join("\n");
      } else {
        result = content;
      }
    }

    this.fileReadCache.set(cacheKey, {
      content: result,
      mtimeMs: stat.mtimeMs,
      size: stat.size,
      readCount: 1,
    });

    return result;
  }

  async writeFile(
    filePath: string,
    content: string,
    context?: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    const t0 = Date.now();
    const root = context?.workspaceRoot || process.cwd();
    const safePath = resolveSafePath(root, filePath, context?.forbiddenPaths);

    try {
      const dir = path.dirname(safePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      const tmp = `${safePath}.tmp.${Date.now()}`;
      fs.writeFileSync(tmp, content, "utf8");
      fs.renameSync(tmp, safePath);

      // Invalidate file read cache for this path
      for (const key of this.fileReadCache.keys()) {
        if (key.startsWith(`${safePath}:`)) {
          this.fileReadCache.delete(key);
        }
      }

      return {
        exitCode: 0,
        output: `Successfully wrote ${Buffer.byteLength(content, "utf8")} bytes to ${filePath}`,
        truncated: false,
        durationMs: Date.now() - t0,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        exitCode: 1,
        output: `Failed to write file: ${msg}`,
        truncated: false,
        durationMs: Date.now() - t0,
        error: msg,
      };
    }
  }
}
