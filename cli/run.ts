import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  createAgentRunner,
  createModelProvider,
  HelixExecutionEngine,
  loadEngineConfig,
  normalizeTaskDefinition,
  createHeadlessAuditorInvoker,
  resolveOrthogonalAuditor,
  type EngineExecutionOptions,
  type ExecutionEvent,
  type OrchestrationStrategy,
  type PlatformId,
  type ProviderId,
  type RunMetrics,
  type TaskDefinition,
  type TaskResult,
} from "../src/engine/index.ts";
import type { HeadlessApiConfiguration, HeadlessProvider } from "../src/engine/provider.ts";
import { createExecutionEventMapper } from "../src/daemon/execution-events.ts";
import type { SessionRuntime } from "../src/daemon/contracts.ts";
import { loadAiConfig } from "../src/engine/config-loader.ts";
import { countTokens } from "../src/measure.ts";
import { computeContentHash } from "../src/knowledge/repository.ts";
import { matchDomainsForFilePath } from "../src/knowledge/discovery.ts";
import { persistAutomatedRunLearning } from "./learn.ts";
import { formatTeamProgressEvent, startTmuxTeamMonitor } from "./ui.ts";

const RUN_USAGE = `Usage: helix run [task-prompt-or-file] [options]

Execute a coding task using the Helix execution engine with bounded context,
ephemeral worktrees, and mechanical verification.

Arguments:
  task-prompt-or-file        Task prompt text, or path to a .md / .json task file.
                             If omitted and stdin is piped, reads prompt from stdin.

Options:
  --strategy <strategy>      Execution strategy: single (default), chain, parallel,
                             parallel-implementation, full-crew
  --platform <id>            Target agent platform (claude-code, opencode, codex, cursor)
  --provider <id>            LLM provider for cost/tokens (anthropic, openai, gemini)
  --model <id>               LLM model identifier
  --dry                      Plan only; do not launch agent or modify files
  --no-worktree              Execute directly in workspace instead of isolated git worktree
  --timeout <sec>            Task execution timeout in seconds (default: 600)
  --max-retries <n>          Maximum gate verification retry attempts (default: 2, max: 2)
  --pass <command>           Verification command (e.g., "npm test" or "cargo test")
  --target <files>           Expected target files (comma-separated)
  --forbidden <paths>        Forbidden paths that must not be accessed (comma-separated)
  --simulation               Run in simulated mode with deterministic mock agent
  --tmux                     Open a split pane following the persisted team DAG
  --json                     Output result and metrics as JSON (ideal for CI/scripts)
  --out <path>               Save full execution report JSON to specified file
  -h, --help                 Show this help message

Exit codes:
  0: Task succeeded and passed mechanical validation
  1: Task failed execution or verification
  2: Invalid arguments, missing task, or syntax error
  3: Task blocked by workflow policy
`;

export type RunCliOptions = {
  runArgs?: string[];
  /** Optional event sink for daemon and non-terminal clients. */
  onExecutionEvent?: (event: ExecutionEvent) => void;
  /** Stream assistant text chunks without writing them to the terminal. */
  onMessageDelta?: (text: string) => void;
  /** Forward measured engine usage to daemon clients. */
  onTelemetry?: (metrics: RunMetrics) => void;
  /** Suppress terminal output when invoked by the daemon runtime. */
  silent?: boolean;
  signal?: AbortSignal;
};

function mapStrategy(val: string): OrchestrationStrategy | "single" {
  if (val === "chain") return "chain";
  if (val === "parallel") return "parallel";
  if (val === "parallel-implementation") return "parallel-implementation";
  if (val === "review" || val === "implementer-plus-reviewer") return "implementer-plus-reviewer";
  if (val === "full-crew" || val === "multiple-implementers") return "multiple-implementers";
  return "single";
}

export async function cmdRun(opts: RunCliOptions): Promise<void> {
  const stdout = opts.silent ? { write: (_text: string) => true } : process.stdout;
  const stderr = opts.silent ? { write: (_text: string) => true } : process.stderr;
  const setExitCode = (code: number) => {
    if (!opts.silent) process.exitCode = code;
  };
  const args = opts.runArgs || [];
  let taskArg: string | null = null;
  let strategy: "single" | "chain" | "parallel" | "parallel-implementation" | "full-crew" =
    "single";
  let platform: PlatformId | null = null;
  let provider: ProviderId | null = null;
  let model: string | null = null;
  let dryRun = false;
  let isolatedWorktree = true;
  let timeoutSec: number | null = null;
  let maxRetries: number | null = null;
  let passCommand: string | null = null;
  let targetFiles: string[] = [];
  let forbiddenPaths: string[] = [];
  let simulation = false;
  let jsonOutput = false;
  let tmuxMonitor = false;
  let outPath: string | null = null;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "-h" || a === "--help") {
      stdout.write(RUN_USAGE);
      return;
    } else if (a === "--json") {
      jsonOutput = true;
    } else if (a === "--dry") {
      dryRun = true;
    } else if (a === "--no-worktree") {
      isolatedWorktree = false;
    } else if (a === "--simulation") {
      simulation = true;
    } else if (a === "--tmux") {
      tmuxMonitor = true;
    } else if (a === "--strategy") {
      const val = args[++i];
      if (
        val === "single" ||
        val === "chain" ||
        val === "parallel" ||
        val === "parallel-implementation" ||
        val === "full-crew"
      ) {
        strategy = val;
      } else {
        stderr.write(
          `[helix run] Error: Invalid strategy "${val}". Valid options: single, chain, parallel, parallel-implementation, full-crew\n`,
        );
        setExitCode(2);
        return;
      }
    } else if (a.startsWith("--strategy=")) {
      const val = a.slice("--strategy=".length);
      if (
        val === "single" ||
        val === "chain" ||
        val === "parallel" ||
        val === "parallel-implementation" ||
        val === "full-crew"
      ) {
        strategy = val as typeof strategy;
      } else {
        stderr.write(`[helix run] Error: Invalid strategy "${val}".\n`);
        setExitCode(2);
        return;
      }
    } else if (a === "--platform") {
      platform = (args[++i] || null) as PlatformId | null;
    } else if (a.startsWith("--platform=")) {
      platform = a.slice("--platform=".length) as PlatformId;
    } else if (a === "--provider") {
      const p = (args[++i] || "").toLowerCase();
      provider = (p === "gemini" ? "google" : p) as ProviderId;
    } else if (a.startsWith("--provider=")) {
      const p = a.slice("--provider=".length).toLowerCase();
      provider = (p === "gemini" ? "google" : p) as ProviderId;
    } else if (a === "--model") {
      model = args[++i] || null;
    } else if (a.startsWith("--model=")) {
      model = a.slice("--model=".length);
    } else if (a === "--timeout") {
      const val = parseInt(args[++i], 10);
      if (!Number.isNaN(val) && val > 0) timeoutSec = val;
    } else if (a.startsWith("--timeout=")) {
      const val = parseInt(a.slice("--timeout=".length), 10);
      if (!Number.isNaN(val) && val > 0) timeoutSec = val;
    } else if (a === "--max-retries") {
      const val = parseInt(args[++i], 10);
      if (!Number.isNaN(val) && val >= 0) maxRetries = Math.min(val, 2);
    } else if (a.startsWith("--max-retries=")) {
      const val = parseInt(a.slice("--max-retries=".length), 10);
      if (!Number.isNaN(val) && val >= 0) maxRetries = Math.min(val, 2);
    } else if (a === "--pass") {
      passCommand = args[++i] || null;
    } else if (a.startsWith("--pass=")) {
      passCommand = a.slice("--pass=".length);
    } else if (a === "--target") {
      const val = args[++i] || "";
      targetFiles = val
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    } else if (a.startsWith("--target=")) {
      targetFiles = a
        .slice("--target=".length)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    } else if (a === "--forbidden") {
      const val = args[++i] || "";
      forbiddenPaths = val
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    } else if (a.startsWith("--forbidden=")) {
      forbiddenPaths = a
        .slice("--forbidden=".length)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    } else if (a === "--out") {
      outPath = args[++i] || null;
    } else if (a.startsWith("--out=")) {
      outPath = a.slice("--out=".length);
    } else if (!a.startsWith("-") && taskArg === null) {
      taskArg = a;
    } else {
      stderr.write(
        `[helix run] Error: Unknown argument "${a}". Run "helix run --help" for usage.\n`,
      );
      setExitCode(2);
      return;
    }
  }

  // Handle piped stdin if no task positional argument provided
  if (!taskArg && !process.stdin.isTTY) {
    try {
      taskArg = fs.readFileSync(0, "utf8").trim();
    } catch {
      // Ignored
    }
  }

  if (!taskArg) {
    stderr.write("[helix run] Error: Missing task prompt or task file.\n\n");
    stdout.write(RUN_USAGE);
    setExitCode(2);
    return;
  }

  const workspaceRoot = process.cwd();
  const config = await loadEngineConfig(workspaceRoot, {
    defaultPlatform: platform || undefined,
    defaultProvider: provider || undefined,
    defaultModelId: model || undefined,
    defaultTimeoutSec: timeoutSec || undefined,
    maxRetries: maxRetries !== null ? maxRetries : undefined,
    dryRun,
  });

  // Construct TaskDefinition
  let task: TaskDefinition;
  const resolvedTaskPath = path.resolve(workspaceRoot, taskArg);

  if (fs.existsSync(resolvedTaskPath) && fs.statSync(resolvedTaskPath).isFile()) {
    const ext = path.extname(resolvedTaskPath).toLowerCase();
    const content = fs.readFileSync(resolvedTaskPath, "utf8");

    if (ext === ".json") {
      try {
        const parsed = JSON.parse(content);
        task = normalizeTaskDefinition({
          workspaceRoot,
          ...parsed,
          passCommand: passCommand || parsed.passCommand,
          targetFiles: targetFiles.length > 0 ? targetFiles : parsed.targetFiles || [],
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        stderr.write(
          `[helix run] Error: Failed to parse task JSON at ${resolvedTaskPath}: ${msg}\n`,
        );
        setExitCode(2);
        return;
      }
    } else {
      // Markdown or plain text file
      const taskId = "task-" + path.basename(resolvedTaskPath, ext).replace(/[^a-zA-Z0-9_-]/g, "-");
      task = normalizeTaskDefinition({
        id: taskId,
        title: path.basename(resolvedTaskPath),
        prompt: content.trim(),
        workspaceRoot,
        passCommand: passCommand || undefined,
        targetFiles,
        constraints: {
          timeoutSec: config.defaultTimeoutSec,
          maxRetries: config.maxRetries,
          forbiddenPaths,
        },
      });
    }
  } else {
    // Treat argument directly as prompt string
    const taskId = "task-" + Date.now().toString(36);
    task = normalizeTaskDefinition({
      id: taskId,
      title: taskArg.slice(0, 60).replace(/[\r\n]+/g, " "),
      prompt: taskArg,
      workspaceRoot,
      passCommand: passCommand || undefined,
      targetFiles,
      constraints: {
        timeoutSec: config.defaultTimeoutSec,
        maxRetries: config.maxRetries,
        forbiddenPaths,
      },
    });
  }

  if (tmuxMonitor) {
    try {
      startTmuxTeamMonitor(workspaceRoot, task.id);
    } catch (error) {
      stderr.write(
        `[helix run] Error: Could not start tmux team monitor: ${error instanceof Error ? error.message : String(error)}\n`,
      );
      setExitCode(2);
      return;
    }
  }

  // Runner & Provider setup
  const runner = createAgentRunner({
    platform: config.defaultPlatform,
    simulation: simulation || process.env.HELIX_SIMULATION === "1",
  });

  const modelProvider = createModelProvider(config.defaultProvider || "anthropic");

  const isSimulation = simulation || process.env.HELIX_SIMULATION === "1";
  const aiConfig = loadAiConfig({
    workspaceRoot,
    cli: { provider: config.defaultProvider, model: config.defaultModelId },
  }).config;
  const generatorHarness = headlessHarnessForPlatform(config.defaultPlatform, aiConfig.providerId);
  const generatorProvider = { harness: generatorHarness, modelId: config.defaultModelId };
  const auditorRoute = resolveOrthogonalAuditor(generatorProvider);
  const resolveAuditorApi = (route: typeof auditorRoute): HeadlessApiConfiguration | undefined => {
    const base = aiConfig.baseUrl?.replace(/\/+$/u, "");
    if (!base || !aiConfig.apiKey) return undefined;
    const endpoint = (suffix: string) => {
      if (base.endsWith(suffix)) return base;
      const versionedSuffix = `/v1${suffix}`;
      return base.endsWith("/v1") ? `${base}${suffix}` : `${base}${versionedSuffix}`;
    };
    if (route.harness === "claude" && aiConfig.providerId === "anthropic") {
      return {
        endpoint: endpoint("/messages"),
        format: "anthropic-messages",
        apiKey: aiConfig.apiKey,
        headers: aiConfig.defaultHeaders,
      };
    }
    if (
      route.harness === "codex" &&
      (aiConfig.providerId === "openai" ||
        aiConfig.providerId === "generic" ||
        aiConfig.providerId === "local")
    ) {
      return {
        endpoint: endpoint("/chat/completions"),
        format: "openai-chat-completions",
        apiKey: aiConfig.apiKey,
        headers: aiConfig.defaultHeaders,
      };
    }
    return undefined;
  };
  const auditApi = resolveAuditorApi(auditorRoute);
  const auditorAdapterConfigured = isHeadlessExecutableAvailable(auditorRoute.harness);
  const adversarialAudit =
    !isSimulation && (auditApi || auditorAdapterConfigured)
      ? {
          generatorProvider,
          invokeAuditor: createHeadlessAuditorInvoker(resolveAuditorApi, 120_000, true),
        }
      : undefined;

  const engine = new HelixExecutionEngine({
    runner,
    provider: modelProvider,
    config,
    adversarialAudit,
  });

  // Event listener for progress reporting
  const onEvent = (event: ExecutionEvent) => {
    opts.onExecutionEvent?.(event);
    if (jsonOutput) return;

    const teamMessage = formatTeamProgressEvent(event);
    if (teamMessage) {
      stdout.write(`${teamMessage}\n`);
      return;
    }

    const time = new Date().toLocaleTimeString();
    switch (event.type) {
      case "task_started":
        stdout.write(
          `\x1b[36m[${time}] [start]\x1b[0m Task started: ${task.id} (${task.title || "untitled"})\n`,
        );
        break;
      case "tier_classified": {
        const tier = (event.payload?.tier as string) || "standard";
        const review = event.payload?.independentReviewRequired ? " [independent-review]" : "";
        stdout.write(`\x1b[35m[${time}] [plan]\x1b[0m Classified as ${tier} tier${review}\n`);
        break;
      }
      case "worktree_created": {
        const wt = (event.payload?.worktreePath as string) || "isolated";
        const rel = path.relative(workspaceRoot, wt);
        stdout.write(
          `\x1b[34m[${time}] [worktree]\x1b[0m Isolated workspace provisioned: ${rel}\n`,
        );
        break;
      }
      case "agent_launched": {
        const role = (event.payload?.role as string) || "agent";
        const retry = event.payload?.retryCount ? ` (retry ${event.payload.retryCount})` : "";
        stdout.write(`\x1b[33m[${time}] [agent]\x1b[0m Executing ${role}${retry}...\n`);
        break;
      }
      case "agent_completed": {
        const code = event.payload?.exitCode;
        const dur = (event.payload?.durationMs as number) || 0;
        stdout.write(
          `\x1b[33m[${time}] [agent]\x1b[0m Agent completed in ${(dur / 1000).toFixed(1)}s (exit ${code})\n`,
        );
        break;
      }
      case "gate_started":
        stdout.write(`\x1b[34m[${time}] [gate]\x1b[0m Running mechanical verification...\n`);
        break;
      case "gate_passed": {
        const checks = event.payload?.checksRun || 0;
        stdout.write(
          `\x1b[32m[${time}] [gate]\x1b[0m Mechanical verification passed (${checks} checks)\n`,
        );
        break;
      }
      case "gate_failed": {
        const stage = (event.payload?.failingStage as string) || "checks";
        stdout.write(`\x1b[31m[${time}] [gate]\x1b[0m Verification failed at stage: ${stage}\n`);
        break;
      }
      case "retry_scheduled": {
        const count = event.payload?.retryCount || 1;
        stdout.write(
          `\x1b[33m[${time}] [retry]\x1b[0m Scheduling retry attempt ${count} with failure feedback\n`,
        );
        break;
      }
      case "task_completed":
        stdout.write(`\x1b[32m[${time}] [done]\x1b[0m Task execution completed successfully!\n`);
        break;
      case "task_failed": {
        const reason = (event.payload?.reason as string) || "Verification or execution failed";
        stdout.write(`\x1b[31m[${time}] [failed]\x1b[0m Task ended: ${reason}\n`);
        break;
      }
      default:
        break;
    }
  };

  // Graceful interrupt handling
  let interrupted = false;
  const abortHandler = async () => {
    if (interrupted) return;
    interrupted = true;
    stderr.write("\n[helix run] Received interrupt signal. Aborting task and cleaning up...\n");
    await engine.abort(task.id, "Process terminated by SIGINT/SIGTERM");
    if (!opts.silent) process.exit(130);
  };
  process.once("SIGINT", abortHandler);
  process.once("SIGTERM", abortHandler);
  opts.signal?.addEventListener("abort", abortHandler, { once: true });

  if (!jsonOutput) {
    stdout.write("\n\x1b[1mHelix AI Coding Harness\x1b[0m\n");
    stdout.write(`Task:        ${task.id}\n`);
    stdout.write(`Strategy:    ${strategy}\n`);
    stdout.write(`Platform:    ${config.defaultPlatform}\n`);
    stdout.write(
      `Isolation:   ${isolatedWorktree ? "Ephemeral Git Worktree" : "Direct in-place"}\n`,
    );
    if (dryRun) stdout.write("Mode:        Dry run (planning only)\n");
    stdout.write("─".repeat(60) + "\n");
  }

  const mapped = mapStrategy(strategy);
  const executionOptions: EngineExecutionOptions = {
    singleAgentOnly: mapped === "single",
    orchestrationStrategy: mapped === "single" ? undefined : mapped,
    isolatedWorktree,
    dryRun,
    onEvent,
    onMessageDelta: opts.onMessageDelta,
  };

  let result: TaskResult;
  const previousExecutionMode = process.env.HELIX_EXECUTION_MODE;
  try {
    process.env.HELIX_EXECUTION_MODE = "run";
    result = await engine.execute(task, executionOptions);
    const blockingFaultsCaught =
      result.validation.adversarialAudit?.findings.filter(
        (finding) => finding.severity === "BLOCKING_FAULT",
      ).length ?? 0;
    if (
      (result.metrics.gateRuns > 1 && result.status === "succeeded") ||
      blockingFaultsCaught > 0
    ) {
      try {
        const affected = result.affectedFiles[0] ?? task.targetFiles?.[0];
        if (affected) {
          const filePath = path.isAbsolute(affected)
            ? path.relative(workspaceRoot, affected).replace(/\\/g, "/")
            : affected.replace(/\\/g, "/");
          const domain = matchDomainsForFilePath(filePath, workspaceRoot)[0];
          if (domain) {
            const stage = result.validation.failingStage ?? "mechanical verification";
            const changeEvidence = extractChangedLinesForFile(result.diff, filePath);
            if (changeEvidence.length > 0) {
              const id = `run-${computeContentHash(`${task.id}:${filePath}:${stage}:${result.diff}`).slice(0, 20)}`;
              persistAutomatedRunLearning(workspaceRoot, {
                gateAttempts: result.metrics.gateRuns,
                blockingFaults: 0,
                blockingFaultsCaught,
                helpedPassGate: result.status === "succeeded",
                presentInFailedRun: result.status !== "succeeded",
                extractCandidate: () => ({
                  id,
                  domainId: domain.domainId,
                  triggerSummary: `A ${stage} gate retry occurred in ${filePath}`,
                  resolutionRule: `Verified change after retry:\n\`\`\`\n${changeEvidence.join("\n")}\n\`\`\``,
                  fileGlob: domain.pathGlobs[0],
                  sourceTaskId: task.id,
                  createdAtIso: new Date().toISOString(),
                }),
              });
            }
          }
        }
      } catch (learningError) {
        const msg = learningError instanceof Error ? learningError.message : String(learningError);
        stderr.write(`[helix run] Quarantine learning failed: ${msg}\n`);
      }
    }
    opts.onTelemetry?.(result.metrics);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    stderr.write(`[helix run] Fatal execution error: ${msg}\n`);
    setExitCode(1);
    return;
  } finally {
    if (previousExecutionMode === undefined) delete process.env.HELIX_EXECUTION_MODE;
    else process.env.HELIX_EXECUTION_MODE = previousExecutionMode;
    process.removeListener("SIGINT", abortHandler);
    process.removeListener("SIGTERM", abortHandler);
    opts.signal?.removeEventListener("abort", abortHandler);
  }

  // Save report if requested
  if (outPath) {
    try {
      const dir = path.dirname(path.resolve(outPath));
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(outPath, JSON.stringify(result, null, 2), "utf8");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      stderr.write(`[helix run] Warning: Could not write report to ${outPath}: ${msg}\n`);
    }
  }

  if (jsonOutput) {
    stdout.write(JSON.stringify(result, null, 2) + "\n");
  } else {
    stdout.write("─".repeat(60) + "\n");
    const statusColor =
      result.status === "succeeded"
        ? "\x1b[32m"
        : result.status === "blocked"
          ? "\x1b[33m"
          : "\x1b[31m";
    stdout.write(`Status:      ${statusColor}${result.status.toUpperCase()}\x1b[0m\n`);
    stdout.write(`Summary:     ${result.summary}\n`);

    if (result.metrics) {
      const durationSec = (result.metrics.wallClockDurationMs / 1000).toFixed(2);
      const agentSec = (result.metrics.agentDurationMs / 1000).toFixed(2);
      const gateSec = (result.metrics.gateDurationMs / 1000).toFixed(2);
      stdout.write(`Duration:    ${durationSec}s (agent: ${agentSec}s, gate: ${gateSec}s)\n`);

      const tokens = result.metrics.tokens;
      if (tokens) {
        const costStr =
          tokens.estimatedCostUsd > 0 ? ` ($${tokens.estimatedCostUsd.toFixed(4)} USD)` : "";
        stdout.write(
          `Tokens:      ${tokens.inputTokens.toLocaleString()} in / ${tokens.outputTokens.toLocaleString()} out / ${tokens.totalTokens.toLocaleString()} total${costStr}\n`,
        );
      }
    }

    if (result.affectedFiles.length > 0) {
      stdout.write(`Affected:    ${result.affectedFiles.join(", ")}\n`);
    }

    if (result.diff) {
      stdout.write("\nModifications:\n");
      const lines = result.diff.split("\n").slice(0, 20);
      for (const line of lines) {
        if (line.startsWith("+") && !line.startsWith("+++")) {
          stdout.write(`\x1b[32m${line}\x1b[0m\n`);
        } else if (line.startsWith("-") && !line.startsWith("---")) {
          stdout.write(`\x1b[31m${line}\x1b[0m\n`);
        } else {
          stdout.write(`${line}\n`);
        }
      }
      if (result.diff.split("\n").length > 20) {
        stdout.write(`... (+${result.diff.split("\n").length - 20} more lines)\n`);
      }
    }

    if (result.validation?.checks && result.validation.checks.length > 0) {
      stdout.write("\nValidation Checks:\n");
      for (const chk of result.validation.checks) {
        const symbol = chk.passed ? "\x1b[32m✔\x1b[0m" : "\x1b[31m✖\x1b[0m";
        stdout.write(`  ${symbol} [${chk.stage}] ${chk.command} (${chk.durationMs}ms)\n`);
        if (!chk.passed && chk.failuresOnly) {
          stdout.write(`    \x1b[31m${chk.failuresOnly.trim()}\x1b[0m\n`);
        }
      }
    }

    if (result.error) {
      stdout.write(`\n\x1b[31mError (${result.error.code}):\x1b[0m ${result.error.message}\n`);
    }

    stdout.write(`\nArtifact:    .helix-work/reports/run-${result.taskId}.json\n`);
  }

  // Set appropriate process exit code
  if (result.status === "succeeded") {
    setExitCode(0);
  } else if (result.status === "blocked") {
    setExitCode(3);
  } else {
    setExitCode(1);
  }
}

function extractChangedLinesForFile(diff: string, filePath: string): string[] {
  const additions: string[] = [];
  const deletions: string[] = [];
  let currentFile = "";
  for (const line of diff.split(/\r?\n/)) {
    if (line.startsWith("+++ ")) {
      currentFile = line.slice(4).replace(/^b\//, "").replace(/\\/g, "/");
      continue;
    }
    if (line.startsWith("--- ")) continue;
    if (currentFile !== filePath) continue;
    if (line.startsWith("+") && !line.startsWith("+++")) additions.push(line.slice(1));
    else if (line.startsWith("-") && !line.startsWith("---")) deletions.push(line.slice(1));
  }
  const evidence = additions.length > 0 ? additions : deletions.map((line) => `removed: ${line}`);
  return evidence.filter((line) => line.trim().length > 0).slice(0, 5);
}

/** In-process runtime used by helixd; progress is forwarded through UICallback. */
export function createCliSessionRuntime(): SessionRuntime {
  return {
    async rollback(_sessionId, taskId) {
      const branch = "helix/" + taskId;
      const git = (args: string[]) =>
        spawnSync("git", args, { cwd: process.cwd(), encoding: "utf8" });
      const inside = git(["rev-parse", "--is-inside-work-tree"]);
      if (inside.status !== 0 || inside.stdout.trim() !== "true") {
        throw new Error("Task rollback requires a Git workspace");
      }
      const listed = git(["branch", "--list", "--format=%(refname:short)", branch]);
      if (listed.status !== 0 || listed.stdout.trim() !== branch) {
        return { rolledBack: false, message: "No retained Helix task branch exists for " + taskId };
      }
      const current = git(["branch", "--show-current"]);
      if (current.stdout.trim() === branch) {
        throw new Error("Cannot discard the Helix task branch while it is checked out");
      }
      const removed = git(["branch", "-D", "--", branch]);
      if (removed.status !== 0)
        throw new Error(removed.stderr.trim() || "Git could not discard " + branch);
      return {
        rolledBack: true,
        message:
          "Discarded retained task branch " + branch + "; the current checkout was left unchanged",
      };
    },
    providers() {
      const { config } = loadAiConfig();
      return [
        {
          id: config.providerId,
          model: config.model,
          baseUrl: config.baseUrl,
          configured: Boolean(config.apiKey),
        },
      ];
    },
    async prompt(_sessionId, prompt, callback, signal) {
      const mapEvent = createExecutionEventMapper();
      let failed = false;
      const startedAt = Date.now();
      let streamedText = "";
      const aiConfig = loadAiConfig().config;
      const modelProvider = createModelProvider(aiConfig.providerId);
      const promptTokens = countTokens(prompt);
      let lastUsageEmissionAt = 0;
      await cmdRun({
        runArgs: [prompt, "--json"],
        silent: true,
        signal,
        onMessageDelta(text) {
          streamedText += text;
          callback.emit({ type: "message.delta", role: "assistant", delta_text: text });
          const now = Date.now();
          if (now - lastUsageEmissionAt < 250) return;
          lastUsageEmissionAt = now;
          const completionTokens = countTokens(streamedText);
          const estimate = modelProvider.calculateCost(aiConfig.model ?? "", {
            inputTokens: promptTokens,
            outputTokens: completionTokens,
            cacheReadTokens: 0,
            totalTokens: promptTokens + completionTokens,
          });
          callback.emit({
            type: "telemetry.usage",
            prompt_tokens: promptTokens,
            completion_tokens: completionTokens,
            cache_read_tokens: 0,
            cache_write_tokens: 0,
            context_window_pct: 0,
            latency_ms: Date.now() - startedAt,
            cost_usd: estimate.estimatedTotalUsd,
          });
        },
        onTelemetry(metrics) {
          callback.emit({
            type: "telemetry.usage",
            prompt_tokens: metrics.tokens.inputTokens,
            completion_tokens: metrics.tokens.outputTokens,
            cache_read_tokens: metrics.tokens.cacheReadTokens,
            cache_write_tokens: 0,
            context_window_pct: 0,
            latency_ms: metrics.agentDurationMs,
            cost_usd: metrics.tokens.estimatedCostUsd,
          });
        },
        onExecutionEvent(event) {
          const translated = mapEvent(event);
          if (translated) callback.emit(translated);
          if (event.type === "task_completed" && typeof event.payload.diffPatch === "string") {
            callback.emit({
              type: "tool.call.result",
              call_id: event.taskId,
              status: "succeeded",
              stdout: "",
              stderr: "",
              diff_patch: event.payload.diffPatch,
              duration_ms: Number(event.payload.durationMs ?? 0),
            });
          }
          if (event.type === "task_failed") failed = true;
        },
      });
      if (signal.aborted) throw new Error("Session was cancelled");
      if (failed) throw new Error("Helix task failed");
    },
  };
}

function headlessHarnessForPlatform(platform: PlatformId, provider: ProviderId): HeadlessProvider {
  if (platform === "claude-code") return "claude";
  if (platform === "codex") return "codex";
  if (platform === "opencode") return "opencode";
  if (platform === "copilot") return "copilot";
  if (provider === "openai") return "codex";
  if (provider === "google") return "opencode";
  return "claude";
}

function isHeadlessExecutableAvailable(provider: HeadlessProvider): boolean {
  if (provider === "copilot") return false;
  const executable = provider === "claude" ? "claude" : provider;
  const extensions = process.platform === "win32" ? [".exe", ".cmd", ".bat", ""] : [""];
  return (process.env.PATH ?? "").split(path.delimiter).some((directory) =>
    extensions.some((extension) => {
      const candidate = path.join(directory, `${executable}${extension}`);
      try {
        fs.accessSync(
          candidate,
          process.platform === "win32" ? fs.constants.F_OK : fs.constants.X_OK,
        );
        return fs.statSync(candidate).isFile();
      } catch {
        return false;
      }
    }),
  );
}
