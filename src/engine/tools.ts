// Helix Tool Execution & Security Confinement (Phases 03 & 06)
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  CommandSecurityInspector,
  DangerousCommandError,
  isForbidden,
  isTamperProtected,
  redactSecrets,
  resolveSafePath,
  sanitizeEnvironment,
  SecurityGuard,
  SENSITIVE_PATTERNS,
  ToolArgumentValidationError,
  ToolSecurityError,
  validateToolArguments,
} from "./security.ts";
import type {
  CommandClassificationResult,
  ToolExecutionContext,
  ToolExecutionResult,
  ToolExecutor,
} from "./types.ts";

// Re-export core security helpers from security.ts for backward compatibility
export { ToolSecurityError, SENSITIVE_PATTERNS, isForbidden, isTamperProtected, resolveSafePath };

export type CachedFileRead = {
  content: string;
  mtimeMs: number;
  size: number;
  readCount: number;
};

export class DefaultToolExecutor implements ToolExecutor {
  private fileReadCache = new Map<string, CachedFileRead>();
  private repeatedReadCount = 0;
  private readonly defaultSecurityGuard: SecurityGuard;

  constructor(securityGuard?: SecurityGuard) {
    this.defaultSecurityGuard = securityGuard || new SecurityGuard();
  }

  getRepeatedReadCount(): number {
    return this.repeatedReadCount;
  }

  clearCache(): void {
    this.fileReadCache.clear();
    this.repeatedReadCount = 0;
  }

  getSecurityGuard(): SecurityGuard {
    return this.defaultSecurityGuard;
  }

  async executeCommand(
    command: string,
    context: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    const t0 = Date.now();
    const guard = this.defaultSecurityGuard;
    const auditLogger = context.auditLogger || guard.getAuditLogger();
    const timeoutMs = context.timeoutMs > 0 ? context.timeoutMs : 30000;
    const maxBytes = context.maxOutputBytes > 0 ? context.maxOutputBytes : 4096;

    // 1. Argument validation
    if (context.validateArguments !== false) {
      try {
        validateToolArguments("executeCommand", { command }, context.permissions);
      } catch (err) {
        auditLogger.log({
          type: "argument_validation",
          severity: "violation",
          role: context.role,
          message: err instanceof Error ? err.message : String(err),
          details: { command },
        });
        return {
          exitCode: 1,
          output: `Command blocked by security policy: ${err instanceof Error ? err.message : String(err)}`,
          truncated: false,
          durationMs: 0,
          error: "SecurityViolation",
        };
      }
    }

    // 2. Command Security & Permission Boundary Inspection
    let _inspection: CommandClassificationResult;
    try {
      _inspection = CommandSecurityInspector.assertCommandPermitted(
        command,
        context.permissions,
        context.role,
      );
    } catch (err) {
      auditLogger.log({
        type:
          err instanceof DangerousCommandError ? "dangerous_command_blocked" : "permission_check",
        severity: "violation",
        role: context.role,
        message: err instanceof Error ? err.message : String(err),
        details: { command },
      });
      return {
        exitCode: 1,
        output: `Command blocked by security policy: ${err instanceof Error ? err.message : String(err)}`,
        truncated: false,
        durationMs: 0,
        error: "SecurityViolation",
      };
    }

    // Check system directory access (retaining Phase 03 credentials check)
    if (/\b(~|\$HOME)\/(\.ssh|\.aws|\.gnupg)\b/.test(command)) {
      auditLogger.log({
        type: "forbidden_path_access",
        severity: "violation",
        role: context.role,
        message: "Command references sensitive system directories",
        details: { command },
      });
      return {
        exitCode: 1,
        output: "Command blocked by security policy: access to sensitive credentials detected",
        truncated: false,
        durationMs: 0,
        error: "SecurityViolation",
      };
    }

    // 3. Environment Variable Sanitization
    const sanitizedEnv = sanitizeEnvironment(
      { ...process.env, ...context.environmentVariables },
      [],
      context.networkPolicy || context.permissions?.networkPolicy || "none",
    );

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
        env: sanitizedEnv,
        stdio: ["ignore", "pipe", "pipe"],
        detached: isPosix,
      });

      const timer = setTimeout(() => {
        killed = true;
        auditLogger.log({
          type: "execution_limit_exceeded",
          severity: "warning",
          role: context.role,
          message: `Command timed out after ${timeoutMs}ms: ${command}`,
          details: { command, timeoutMs },
        });
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

        // Secret redaction filter on output
        if (context.redactSecrets !== false) {
          const redacted = redactSecrets(output);
          if (redacted.count > 0) {
            auditLogger.log({
              type: "secret_redacted",
              severity: "warning",
              role: context.role,
              message: `Redacted ${redacted.count} secret(s) from command output`,
              details: { command, count: redacted.count, types: redacted.types },
            });
            output = redacted.text;
          }
        }

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
    const guard = this.defaultSecurityGuard;
    const auditLogger = context?.auditLogger || guard.getAuditLogger();

    // 1. Permission check
    guard.assertPermission("readFile", context?.permissions, context?.role);

    // 2. Argument validation
    if (context?.validateArguments !== false) {
      validateToolArguments("readFile", { filePath, startLine, endLine }, context?.permissions);
    }

    const safePath = resolveSafePath(root, filePath, context?.forbiddenPaths);

    if (!fs.existsSync(safePath)) {
      throw new Error(`File does not exist: ${filePath}`);
    }

    const stat = fs.statSync(safePath);
    if (!stat.isFile()) {
      throw new Error(`Path is not a regular file: ${filePath}`);
    }

    // 3. File size limit
    const maxFileSize = context?.permissions?.maxFileSizeBytes || 10 * 1024 * 1024;
    if (stat.size > maxFileSize) {
      throw new ToolArgumentValidationError(
        "readFile",
        "filePath",
        `File size (${stat.size} bytes) exceeds maximum allowable limit (${maxFileSize} bytes)`,
      );
    }

    const cacheKey = `${safePath}:${stat.mtimeMs}:${stat.size}:${startLine ?? 1}:${endLine ?? -1}`;
    const cached = this.fileReadCache.get(cacheKey);
    if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
      cached.readCount++;
      this.repeatedReadCount++;
      return cached.content;
    }

    let content = fs.readFileSync(safePath, "utf8");

    // Redact secrets if requested
    if (context?.redactSecrets) {
      const red = redactSecrets(content);
      if (red.count > 0) {
        auditLogger.log({
          type: "secret_redacted",
          severity: "warning",
          role: context?.role,
          message: `Redacted ${red.count} secret(s) during file read of ${filePath}`,
          details: { filePath, count: red.count, types: red.types },
        });
        content = red.text;
      }
    }

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
    const guard = this.defaultSecurityGuard;
    const auditLogger = context?.auditLogger || guard.getAuditLogger();

    // 1. Permission check
    guard.assertPermission("writeFile", context?.permissions, context?.role);

    // 2. Argument validation
    if (context?.validateArguments !== false) {
      validateToolArguments("writeFile", { filePath, content }, context?.permissions);
    }

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

      auditLogger.log({
        type: "argument_validation",
        severity: "info",
        role: context?.role,
        message: `Successfully wrote ${Buffer.byteLength(content, "utf8")} bytes to ${filePath}`,
        details: { filePath, bytes: Buffer.byteLength(content, "utf8") },
      });

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
