// Helix Agent Runner Implementations (Phase 03 - Component 4)
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { PlatformId } from "../types.ts";
import type {
  AgentCapabilities,
  AgentExecutionOutput,
  AgentMessage,
  AgentRunner,
  AgentSession,
} from "./types.ts";

export type MockAgentAction = {
  exitCode?: number;
  stdout?: string;
  stderr?: string;
  fileEdits?: Record<string, string>;
  delayMs?: number;
  tokens?: { input: number; output: number; cacheRead?: number };
  interrupted?: boolean;
};

export type MockAgentHandler = (
  session: AgentSession,
  invocationCount: number,
) => Promise<MockAgentAction> | MockAgentAction;

export class MockAgentRunner implements AgentRunner {
  readonly platform: PlatformId;
  readonly capabilities: AgentCapabilities;
  public calls: AgentSession[] = [];
  private readonly handler?: MockAgentHandler;
  private readonly defaultActions: MockAgentAction[];
  private activeSessions = new Map<string, { abort: () => void }>();

  constructor(
    platform: PlatformId = "opencode",
    actionsOrHandler?: MockAgentAction[] | MockAgentHandler,
  ) {
    this.platform = platform;
    this.capabilities = {
      supportsBash: true,
      supportsSubagents: false,
      supportsHooks: true,
      supportsMcp: true,
    };

    if (typeof actionsOrHandler === "function") {
      this.handler = actionsOrHandler;
      this.defaultActions = [];
    } else {
      this.defaultActions = actionsOrHandler || [
        { exitCode: 0, stdout: "Mock task completed successfully." },
      ];
    }
  }

  async run(session: AgentSession): Promise<AgentExecutionOutput> {
    const t0 = Date.now();
    this.calls.push(session);

    let interrupted = false;

    const abortController = new Promise<void>((_, reject) => {
      this.activeSessions.set(session.sessionId, {
        abort: () => {
          interrupted = true;
          reject(new Error("ExecutionInterrupted"));
        },
      });
    });

    try {
      const invocationCount = this.calls.length;
      let action: MockAgentAction;

      if (this.handler) {
        action = await Promise.race([
          Promise.resolve(this.handler(session, invocationCount)),
          abortController.then(() => ({}) as MockAgentAction),
        ]);
      } else {
        const idx = Math.min(invocationCount - 1, this.defaultActions.length - 1);
        action = this.defaultActions[idx] || { exitCode: 0, stdout: "OK" };
      }

      if (action.delayMs && action.delayMs > 0) {
        await Promise.race([
          new Promise((resolve) => setTimeout(resolve, action.delayMs)),
          abortController,
        ]);
      }

      // Apply any simulated file edits to session.workdir
      if (action.fileEdits && fs.existsSync(session.workdir)) {
        for (const [relPath, content] of Object.entries(action.fileEdits)) {
          const fullPath = path.join(session.workdir, relPath);
          fs.mkdirSync(path.dirname(fullPath), { recursive: true });
          fs.writeFileSync(fullPath, content, "utf8");
        }
      }

      const durationMs = Date.now() - t0;
      const exitCode = action.exitCode ?? 0;
      const stdout = action.stdout || (exitCode === 0 ? "Success" : "");
      const stderr = action.stderr || (exitCode !== 0 ? "Error encountered" : "");
      if (stdout) session.onOutputChunk?.(stdout);

      const assistantMsg: AgentMessage = {
        role: "assistant",
        content: stdout || stderr,
        timestamp: new Date().toISOString(),
      };

      return {
        exitCode,
        stdout,
        stderr,
        messages: [...session.messages, assistantMsg],
        durationMs,
        tokens: action.tokens || {
          input: 250,
          output: 100,
        },
        interrupted: action.interrupted ?? interrupted,
      };
    } catch (err) {
      const isInterrupted =
        interrupted || (err instanceof Error && err.message === "ExecutionInterrupted");
      return {
        exitCode: isInterrupted ? 130 : 1,
        stdout: "",
        stderr: err instanceof Error ? err.message : String(err),
        messages: session.messages,
        durationMs: Date.now() - t0,
        interrupted: isInterrupted,
      };
    } finally {
      this.activeSessions.delete(session.sessionId);
    }
  }

  async terminate(sessionId: string): Promise<void> {
    const handle = this.activeSessions.get(sessionId);
    if (handle) {
      handle.abort();
      this.activeSessions.delete(sessionId);
    }
  }
}

export class SubprocessAgentRunner implements AgentRunner {
  readonly platform: PlatformId;
  readonly capabilities: AgentCapabilities;
  private readonly command: string;
  private readonly args: string[];
  private activeProcesses = new Map<string, ChildProcess>();

  constructor(
    platform: PlatformId,
    command: string,
    args: string[] = [],
    capabilities?: Partial<AgentCapabilities>,
  ) {
    this.platform = platform;
    this.command = command;
    this.args = args;
    this.capabilities = {
      supportsBash: capabilities?.supportsBash ?? true,
      supportsSubagents: capabilities?.supportsSubagents ?? false,
      supportsHooks: capabilities?.supportsHooks ?? false,
      supportsMcp: capabilities?.supportsMcp ?? true,
    };
  }

  async run(session: AgentSession): Promise<AgentExecutionOutput> {
    const t0 = Date.now();
    const timeoutMs = (session.timeoutSec > 0 ? session.timeoutSec : 600) * 1000;

    return new Promise((resolve) => {
      let stdout = "";
      let stderr = "";
      let killed = false;
      let interrupted = false;

      const proc = spawn(this.command, this.args, {
        cwd: session.workdir,
        env: {
          ...process.env,
          HELIX_SESSION_ID: session.sessionId,
          HELIX_TASK_ID: session.taskId,
          HELIX_ROLE: session.role,
        },
        stdio: ["pipe", "pipe", "pipe"],
      });

      this.activeProcesses.set(session.sessionId, proc);

      // Pipe system prompt and messages to stdin if supported
      if (proc.stdin) {
        const payload = JSON.stringify({
          systemPrompt: session.systemPrompt,
          messages: session.messages,
          toolAllowlist: session.toolAllowlist,
          maxTurns: session.maxTurns,
          readOnly: session.readOnly,
        });
        proc.stdin.write(payload);
        proc.stdin.end();
      }

      const timer = setTimeout(() => {
        killed = true;
        try {
          proc.kill("SIGKILL");
        } catch {
          // Process already closed
        }
      }, timeoutMs);

      proc.stdout?.on("data", (chunk: Buffer) => {
        const text = chunk.toString("utf8");
        stdout += text;
        session.onOutputChunk?.(text);
      });

      proc.stderr?.on("data", (chunk: Buffer) => {
        stderr += chunk.toString("utf8");
      });

      proc.on("error", (err) => {
        clearTimeout(timer);
        this.activeProcesses.delete(session.sessionId);
        resolve({
          exitCode: 1,
          stdout,
          stderr: stderr ? `${stderr}\n${err.message}` : err.message,
          messages: session.messages,
          durationMs: Date.now() - t0,
          interrupted: false,
        });
      });

      proc.on("close", (code, signal) => {
        clearTimeout(timer);
        this.activeProcesses.delete(session.sessionId);
        const durationMs = Date.now() - t0;

        if (signal === "SIGINT" || signal === "SIGTERM") {
          interrupted = true;
        }

        const exitCode = killed ? 124 : (code ?? (interrupted ? 130 : 0));
        const assistantMsg: AgentMessage = {
          role: "assistant",
          content: stdout || stderr,
          timestamp: new Date().toISOString(),
        };

        resolve({
          exitCode,
          stdout,
          stderr,
          messages: [...session.messages, assistantMsg],
          durationMs,
          interrupted: killed || interrupted,
        });
      });
    });
  }

  async terminate(sessionId: string): Promise<void> {
    const proc = this.activeProcesses.get(sessionId);
    if (proc) {
      try {
        proc.kill("SIGTERM");
        setTimeout(() => {
          try {
            proc.kill("SIGKILL");
          } catch {
            // Already dead
          }
        }, 2000);
      } catch {
        // Ignore termination errors
      }
      this.activeProcesses.delete(sessionId);
    }
  }
}

export type AgentRunnerFactoryOptions = {
  platform?: PlatformId;
  command?: string;
  args?: string[];
  simulation?: boolean;
  mockActions?: MockAgentAction[];
  mockHandler?: MockAgentHandler;
};

export const PLATFORM_DEFAULT_BINARIES: Record<PlatformId, string> = {
  "claude-code": "claude",
  cursor: "cursor",
  codex: "codex",
  gemini: "gemini",
  copilot: "copilot",
  windsurf: "windsurf",
  cline: "cline",
  aider: "aider",
  opencode: "opencode",
  antigravity: "antigravity",
  devin: "devin",
  factory: "factory",
  kiro: "kiro",
  amp: "amp",
  kilo: "kilo",
};

/**
 * Check if a command binary exists on system PATH.
 */
export function isBinaryAvailable(bin: string): boolean {
  const pathEnv = process.env.PATH || "";
  const sep = path.delimiter;
  const dirs = pathEnv.split(sep);
  for (const dir of dirs) {
    if (!dir) continue;
    const full = path.join(dir, bin);
    try {
      if (fs.existsSync(full) && fs.statSync(full).isFile()) {
        return true;
      }
    } catch {
      // Permission or FS access error
    }
  }
  return false;
}

/**
 * Unified factory to create an appropriate AgentRunner instance based on
 * platform settings, environment variables, or simulation preferences.
 */
export function createAgentRunner(options: AgentRunnerFactoryOptions = {}): AgentRunner {
  const platform = options.platform || (process.env.HELIX_PLATFORM as PlatformId) || "claude-code";

  if (
    options.simulation ||
    options.mockActions ||
    options.mockHandler ||
    process.env.HELIX_SIMULATION === "1"
  ) {
    return new MockAgentRunner(platform, options.mockActions || options.mockHandler);
  }

  const customCommand = options.command || process.env.HELIX_RUNNER_COMMAND;
  if (customCommand) {
    return new SubprocessAgentRunner(platform, customCommand, options.args || []);
  }

  const defaultBin = PLATFORM_DEFAULT_BINARIES[platform] || "claude";
  return new SubprocessAgentRunner(platform, defaultBin, options.args || []);
}
