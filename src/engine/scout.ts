import { validateScoutSynthesis, type ScoutSynthesis, MODE_2_DISPOSABLE_SCOUT } from "../crew.ts";
import type { AgentRunner } from "./types.ts";

export interface DisposableScoutRequest {
  readonly taskId: string;
  readonly workdir: string;
  readonly query: string;
  readonly pathScope?: string;
  readonly timeoutSec?: number;
}

const SCOUT_TOOLS = ["Read", "Grep", "Glob", "ast_search"] as const;

/** Run a fresh, read-only scout and return only its validated compact synthesis. */
export async function runDisposableScout(
  runner: AgentRunner,
  request: DisposableScoutRequest,
): Promise<ScoutSynthesis> {
  const query = request.pathScope
    ? `${request.query}\nPath scope: ${request.pathScope}`
    : request.query;
  const result = await runner.run({
    sessionId: `${request.taskId}-scout-${Date.now()}`,
    taskId: request.taskId,
    role: "scout",
    platform: runner.platform,
    workdir: request.workdir,
    systemPrompt: [
      "You are a disposable read-only repository scout.",
      "Use only Read, Grep, Glob, and ast_search. Never edit files or run commands.",
      "Return only one JSON object with arrays: files, symbols, entryPoints, negativeFindings.",
      "Use precise file:line evidence. Keep the complete JSON at or below 250 tokens.",
    ].join("\n"),
    messages: [{ role: "user", content: query, timestamp: new Date().toISOString() }],
    timeoutSec: Math.min(120, Math.max(1, request.timeoutSec ?? 60)),
    toolAllowlist: SCOUT_TOOLS,
    maxTurns: MODE_2_DISPOSABLE_SCOUT.maxTurns,
    readOnly: true,
  });
  if (result.exitCode !== 0)
    throw new Error(`Disposable scout failed: ${result.stderr || result.stdout}`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(result.stdout.trim());
  } catch {
    throw new Error("Disposable scout returned invalid JSON");
  }
  return validateScoutSynthesis(parsed);
}
