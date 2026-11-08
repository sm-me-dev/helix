import fs from "node:fs";
import path from "node:path";
import { Lang, parse } from "@ast-grep/napi";
import { countTokens } from "../measure.ts";
import { matchPathGlob } from "../knowledge/glob.ts";
import { MODE_2_DISPOSABLE_SCOUT, validateScoutSynthesis, type ScoutSynthesis } from "../crew.ts";
import { DEFAULT_HELIX_V2_ROUTING, type ModelRoute } from "./provider.ts";

export interface DisposableScoutRequest {
  readonly taskId: string;
  readonly query: string;
  readonly pathScope?: string;
  readonly timeoutSec?: number;
}

export interface ScoutToolCall {
  readonly id: string;
  readonly name: string;
  readonly input: unknown;
}

export interface ScoutTurnRequest {
  readonly taskId: string;
  readonly worktreeRoot: string;
  readonly route: ModelRoute;
  readonly systemPrompt: string;
  readonly messages: readonly {
    readonly role: "user" | "assistant" | "tool";
    readonly content: string;
    readonly toolCallId?: string;
  }[];
  readonly tools: readonly Readonly<Record<string, unknown>>[];
  readonly turn: number;
  readonly maxTurns: 8;
  readonly maxOutputTokens: 250;
  readonly readOnlyToolsOnly: true;
  readonly timeoutMs: number;
}

export interface ScoutTurnResponse {
  readonly stopReason: "tool_use" | "end_turn";
  readonly content?: string;
  readonly toolCalls?: readonly ScoutToolCall[];
}

/** Provider routers return proposed calls; only this loop can execute their tools. */
export interface ScoutProviderRouter {
  invokeTurn(request: ScoutTurnRequest): Promise<ScoutTurnResponse>;
}

export const SCOUT_TOOL_ALLOWLIST = ["Read", "Grep", "Glob", "ast_search"] as const;

const SCOUT_TOOL_SCHEMAS: readonly Readonly<Record<string, unknown>>[] = [
  {
    name: "Read",
    description: "Read a bounded source line range.",
    inputSchema: {
      type: "object",
      properties: {
        filePath: { type: "string" },
        startLine: { type: "integer", minimum: 1 },
        endLine: { type: "integer", minimum: 1 },
      },
      required: ["filePath"],
      additionalProperties: false,
    },
  },
  {
    name: "Grep",
    description: "Search repository text without executing commands.",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string" }, pathScope: { type: "string" } },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "Glob",
    description: "List repository files matching a glob.",
    inputSchema: {
      type: "object",
      properties: { pattern: { type: "string" } },
      required: ["pattern"],
      additionalProperties: false,
    },
  },
  {
    name: "ast_search",
    description: "Find source nodes matching an AST pattern.",
    inputSchema: {
      type: "object",
      properties: { filePath: { type: "string" }, pattern: { type: "string" } },
      required: ["filePath", "pattern"],
      additionalProperties: false,
    },
  },
];

const SYSTEM_PROMPT = [
  "You are a disposable read-only repository scout. The only available tools are Read, Grep, Glob, and ast_search.",
  "Investigate the query, cite exact repository paths and line numbers, and do not modify files or run commands.",
  "Finish with strict JSON containing exactly files, symbols, entryPoints, and negativeFindings arrays of strings.",
  "Keep the serialized synthesis at or below 250 tokens.",
].join("\n");

function objectInput(input: unknown): Record<string, unknown> {
  if (input === null || typeof input !== "object" || Array.isArray(input))
    throw new Error("Scout tool input must be a JSON object");
  return input as Record<string, unknown>;
}

function requiredString(input: Record<string, unknown>, key: string): string {
  const value = input[key];
  if (typeof value !== "string" || !value.trim()) throw new Error(`Scout tool requires '${key}'`);
  return value;
}

function normalizeRelative(value: string): string {
  const normalized = value.replace(/\\/g, "/").replace(/^\.\//, "");
  if (
    !normalized ||
    normalized.startsWith("/") ||
    /^[a-z]:/i.test(normalized) ||
    normalized.split("/").includes("..")
  ) {
    throw new Error("Scout tool path must stay inside the worktree");
  }
  return normalized;
}

function resolveScoutFile(root: string, requested: string): { absolute: string; relative: string } {
  const relative = normalizeRelative(requested);
  const absolute = path.resolve(root, relative);
  const lexical = path.relative(root, absolute);
  if (lexical === ".." || lexical.startsWith(`..${path.sep}`) || path.isAbsolute(lexical))
    throw new Error("Scout tool path escapes the worktree");
  const real = fs.realpathSync(absolute);
  const realRelative = path.relative(root, real);
  if (
    realRelative === ".." ||
    realRelative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(realRelative)
  )
    throw new Error("Scout tool path resolves outside the worktree");
  if (!fs.statSync(real).isFile()) throw new Error("Scout Read requires a regular file");
  return { absolute: real, relative: realRelative.replace(/\\/g, "/") };
}

function listWorkspaceFiles(root: string, scope = "**/*"): string[] {
  const glob = normalizeRelative(scope);
  const files: string[] = [];
  const visit = (directory: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (
        entry.name.startsWith(".") ||
        ["node_modules", "dist", "build", "coverage"].includes(entry.name)
      )
        continue;
      const absolute = path.join(directory, entry.name);
      const relative = path.relative(root, absolute).replace(/\\/g, "/");
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile() && matchPathGlob(relative, glob)) files.push(relative);
      if (files.length >= 500) return;
    }
  };
  visit(root);
  return files.sort().slice(0, 500);
}

function languageForFile(
  filePath: string,
): typeof Lang.TypeScript | typeof Lang.Tsx | typeof Lang.JavaScript {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".tsx" || ext === ".jsx") return Lang.Tsx;
  if ([".js", ".mjs", ".cjs", ".jsx"].includes(ext)) return Lang.JavaScript;
  if ([".ts", ".mts", ".cts"].includes(ext)) return Lang.TypeScript;
  throw new Error(`ast_search does not support '${ext || "extensionless"}' files`);
}

function executeScoutTool(root: string, name: string, rawInput: unknown): string {
  if (!(SCOUT_TOOL_ALLOWLIST as readonly string[]).includes(name)) {
    throw new Error(
      `Scout attempted forbidden tool '${name}'; only ${SCOUT_TOOL_ALLOWLIST.join(", ")} are permitted`,
    );
  }
  const input = objectInput(rawInput);
  if (name === "Read") {
    const file = resolveScoutFile(root, requiredString(input, "filePath"));
    const lines = fs.readFileSync(file.absolute, "utf8").split(/\r?\n/);
    const start = typeof input.startLine === "number" ? input.startLine : 1;
    const end =
      typeof input.endLine === "number" ? input.endLine : Math.min(lines.length, start + 99);
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start < 1 ||
      end < start ||
      end - start >= 100 ||
      end > lines.length
    )
      throw new Error("Scout Read line range must be valid and no longer than 100 lines");
    return lines
      .slice(start - 1, end)
      .map((line, index) => `${start + index}: ${line}`)
      .join("\n");
  }
  if (name === "Glob") return listWorkspaceFiles(root, requiredString(input, "pattern")).join("\n");
  if (name === "Grep") {
    const query = requiredString(input, "query");
    const scope = typeof input.pathScope === "string" ? input.pathScope : "**/*";
    const results: string[] = [];
    for (const filePath of listWorkspaceFiles(root, scope)) {
      const file = resolveScoutFile(root, filePath);
      let contents: string;
      try {
        contents = fs.readFileSync(file.absolute, "utf8");
      } catch {
        continue;
      }
      const lines = contents.split(/\r?\n/);
      for (let index = 0; index < lines.length; index++) {
        if (lines[index]?.includes(query))
          results.push(`${file.relative}:${index + 1}: ${lines[index]}`);
        if (results.length === 100) return results.join("\n");
      }
    }
    return results.join("\n");
  }
  const file = resolveScoutFile(root, requiredString(input, "filePath"));
  const lang = languageForFile(file.relative);
  const rootNode = parse(lang, fs.readFileSync(file.absolute, "utf8")).root();
  const pattern = requiredString(input, "pattern");
  return rootNode
    .findAll({ rule: { pattern } })
    .slice(0, 50)
    .map((node) => `${file.relative}:${node.range().start.line + 1}: ${node.text()}`)
    .join("\n");
}

/** Run a tool-locked, bounded scout loop and return its validated synthesis only. */
export async function runDisposableScout(
  request: DisposableScoutRequest,
  providerRouter: ScoutProviderRouter,
  worktreeRoot: string,
): Promise<ScoutSynthesis> {
  if (!request.taskId.trim() || !request.query.trim())
    throw new Error("Disposable scout requires taskId and query");
  const root = fs.realpathSync(path.resolve(worktreeRoot));
  const timeoutMs = Math.min(120_000, Math.max(1_000, (request.timeoutSec ?? 60) * 1_000));
  const deadline = Date.now() + timeoutMs;
  const route = DEFAULT_HELIX_V2_ROUTING.FAST_DISPOSABLE_SCOUT;
  const userQuery = request.pathScope
    ? `${request.query}\nPath scope: ${normalizeRelative(request.pathScope)}`
    : request.query;
  const messages: Array<{
    role: "user" | "assistant" | "tool";
    content: string;
    toolCallId?: string;
  }> = [{ role: "user", content: userQuery }];

  for (let turn = 1; turn <= MODE_2_DISPOSABLE_SCOUT.maxTurns; turn++) {
    if (Date.now() >= deadline) throw new Error("Disposable scout timed out");
    const turnRequest: ScoutTurnRequest = {
      taskId: request.taskId,
      worktreeRoot: root,
      route,
      systemPrompt: SYSTEM_PROMPT,
      messages,
      tools: SCOUT_TOOL_SCHEMAS,
      turn,
      maxTurns: 8,
      maxOutputTokens: 250,
      readOnlyToolsOnly: true,
      timeoutMs: deadline - Date.now(),
    };
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let response: ScoutTurnResponse;
    try {
      response = await Promise.race([
        providerRouter.invokeTurn(turnRequest),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(
            () => reject(new Error("Disposable scout timed out")),
            turnRequest.timeoutMs,
          );
        }),
      ]);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
    const toolCalls = response.toolCalls ?? [];
    const forbidden = toolCalls.find(
      (call) => !(SCOUT_TOOL_ALLOWLIST as readonly string[]).includes(call.name),
    );
    if (forbidden)
      throw new Error(
        `Scout attempted forbidden tool '${forbidden.name}'; mutation and command tools are disabled`,
      );

    if (response.stopReason === "end_turn") {
      if (toolCalls.length > 0) throw new Error("Scout returned tool calls after ending its turn");
      if (typeof response.content !== "string") throw new Error("Scout did not return a synthesis");
      let decoded: unknown;
      try {
        decoded = JSON.parse(response.content.trim());
      } catch {
        throw new Error("Scout returned invalid synthesis JSON");
      }
      return validateScoutSynthesis(decoded);
    }
    if (toolCalls.length === 0)
      throw new Error("Scout requested another turn without any tool calls");
    messages.push({ role: "assistant", content: JSON.stringify({ toolCalls }) });
    for (const call of toolCalls) {
      if (Date.now() >= deadline) throw new Error("Disposable scout timed out");
      const output = executeScoutTool(root, call.name, call.input);
      messages.push({ role: "tool", toolCallId: call.id, content: output.slice(0, 20_000) });
    }
    if (countTokens(messages.map((message) => message.content).join("\n")) > 20_000)
      throw new Error("Disposable scout context exceeded its token budget");
  }
  throw new Error(`Disposable scout exceeded its ${MODE_2_DISPOSABLE_SCOUT.maxTurns}-turn limit`);
}
