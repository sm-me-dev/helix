// helix report: token and waste accounting from agent session transcripts.
//
// Transcript shapes below are OBSERVED locally, not vendor-documented. Parsing is
// defensive: unknown record types and missing fields are ignored, never thrown on.
// Message contents are never returned or printed; only counts, sizes, tool names
// and the file paths a tool was asked to read.

export type Totals = {
  input: number;
  output: number;
  reasoning: number;
  cacheRead: number;
  cacheWrite: number;
};

export type ReadCount = { path: string; count: number };
export type Oversized = { tool: string; size: number };

export type SessionReport = {
  source: "claude-code" | "opencode";
  id: string;
  /** API messages after dedupe (Claude Code) or assistant messages (OpenCode). */
  messages: number;
  main: Totals;
  /** Subagent (sidechain) tokens, kept apart so their cost is visible. */
  sidechain: Totals;
  /** Number of subagent sessions folded into `sidechain` (OpenCode). */
  subagentSessions: number;
  /** What naive per-record summing would have given (Claude Code only; shows the over-count). */
  naiveMain: Totals | null;
  /** USD as reported by the agent (OpenCode). null when the source reports none. */
  costUsd: number | null;
  toolCalls: Record<string, number>;
  toolErrors: number;
  repeatedReads: ReadCount[];
  oversized: Oversized[];
  toolResultChars: number;
  /** Tool calls identical to an earlier call that errored. */
  retries: number;
  /** Assistant turns whose every tool call errored. */
  wastedTurns: number;
};

/** A tool result larger than this many characters is reported as oversized. */
export const OVERSIZED_CHARS = 20_000;

export function emptyTotals(): Totals {
  return { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 };
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

export function addTotals(a: Totals, b: Totals): Totals {
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    reasoning: a.reasoning + b.reasoning,
    cacheRead: a.cacheRead + b.cacheRead,
    cacheWrite: a.cacheWrite + b.cacheWrite,
  };
}

/** Total tokens processed: every field once (cache reads and writes included). */
export function sumTotals(t: Totals): number {
  return t.input + t.output + t.reasoning + t.cacheRead + t.cacheWrite;
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function readPath(input: unknown): string | null {
  if (!isObj(input)) return null;
  for (const k of ["file_path", "filePath", "path"]) {
    const v = input[k];
    if (typeof v === "string" && v.length > 0) return v;
  }
  return null;
}

function isReadTool(name: string): boolean {
  return name.toLowerCase() === "read";
}

function sizeOf(v: unknown): number {
  if (typeof v === "string") return v.length;
  if (v === undefined || v === null) return 0;
  try {
    return JSON.stringify(v).length;
  } catch {
    return 0;
  }
}

type Call = { name: string; key: string; path: string | null; sidechain: boolean; turn: string };
type Result = { size: number; error: boolean };

/** Shared bookkeeping for tool calls, results, retries, repeats and oversized outputs. */
class ToolLedger {
  calls = new Map<string, Call>();
  results = new Map<string, Result>();

  addCall(id: string, call: Call): void {
    if (!this.calls.has(id)) this.calls.set(id, call);
  }

  addResult(id: string, result: Result): void {
    this.results.set(id, result);
  }

  summarize(): Pick<
    SessionReport,
    | "toolCalls"
    | "toolErrors"
    | "repeatedReads"
    | "oversized"
    | "toolResultChars"
    | "retries"
    | "wastedTurns"
  > {
    const toolCalls: Record<string, number> = {};
    const reads = new Map<string, number>();
    const oversized: Oversized[] = [];
    const erroredKeys = new Set<string>();
    const turnCalls = new Map<string, { total: number; errors: number }>();
    let toolErrors = 0;
    let toolResultChars = 0;
    let retries = 0;
    for (const [id, call] of this.calls) {
      toolCalls[call.name] = (toolCalls[call.name] ?? 0) + 1;
      if (isReadTool(call.name) && call.path) reads.set(call.path, (reads.get(call.path) ?? 0) + 1);
      const res = this.results.get(id);
      if (erroredKeys.has(call.key)) retries += 1;
      const t = turnCalls.get(call.turn) ?? { total: 0, errors: 0 };
      t.total += 1;
      if (res) {
        toolResultChars += res.size;
        if (res.size > OVERSIZED_CHARS) oversized.push({ tool: call.name, size: res.size });
        if (res.error) {
          toolErrors += 1;
          t.errors += 1;
          erroredKeys.add(call.key);
        }
      }
      turnCalls.set(call.turn, t);
    }
    let wastedTurns = 0;
    for (const t of turnCalls.values()) if (t.total > 0 && t.errors === t.total) wastedTurns += 1;
    const repeatedReads = [...reads.entries()]
      .filter(([, count]) => count > 1)
      .map(([path, count]) => ({ path, count }))
      .sort((a, b) => b.count - a.count || a.path.localeCompare(b.path));
    oversized.sort((a, b) => b.size - a.size);
    return {
      toolCalls,
      toolErrors,
      repeatedReads,
      oversized,
      toolResultChars,
      retries,
      wastedTurns,
    };
  }
}

function claudeUsage(u: unknown): Totals {
  if (!isObj(u)) return emptyTotals();
  return {
    input: num(u.input_tokens),
    output: num(u.output_tokens),
    reasoning: 0,
    cacheRead: num(u.cache_read_input_tokens),
    cacheWrite: num(u.cache_creation_input_tokens),
  };
}

/**
 * Parse one Claude Code session JSONL (observed format). Assistant records are written
 * per content block: blocks of one API message share message.id and identical usage, so
 * usage is taken once per message.id (the last record's), never summed per record.
 */
export function parseClaudeCodeJsonl(text: string, id = "session"): SessionReport {
  const usageById = new Map<string, { usage: Totals; sidechain: boolean }>();
  const ledger = new ToolLedger();
  let naive = emptyTotals();
  let anonymous = 0;

  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    let rec: unknown;
    try {
      rec = JSON.parse(line);
    } catch {
      continue;
    }
    if (!isObj(rec)) continue;
    const message = isObj(rec.message) ? rec.message : null;
    if (!message) continue;
    const sidechain = rec.isSidechain === true;

    if (rec.type === "assistant") {
      const msgId = typeof message.id === "string" ? message.id : `anon-${anonymous++}`;
      const usage = claudeUsage(message.usage);
      if (!sidechain) naive = addTotals(naive, usage);
      usageById.set(msgId, { usage, sidechain });
      if (Array.isArray(message.content)) {
        for (const block of message.content) {
          if (!isObj(block) || block.type !== "tool_use" || typeof block.id !== "string") continue;
          const name = typeof block.name === "string" ? block.name : "unknown";
          ledger.addCall(block.id, {
            name,
            key: `${name}:${sizeOf(block.input) > 4096 ? block.id : JSON.stringify(block.input)}`,
            path: readPath(block.input),
            sidechain,
            turn: msgId,
          });
        }
      }
    } else if (rec.type === "user" && Array.isArray(message.content)) {
      for (const block of message.content) {
        if (!isObj(block) || block.type !== "tool_result" || typeof block.tool_use_id !== "string")
          continue;
        ledger.addResult(block.tool_use_id, {
          size: sizeOf(block.content),
          error: block.is_error === true,
        });
      }
    }
  }

  let main = emptyTotals();
  let sidechain = emptyTotals();
  let messages = 0;
  for (const { usage, sidechain: side } of usageById.values()) {
    if (side) sidechain = addTotals(sidechain, usage);
    else {
      main = addTotals(main, usage);
      messages += 1;
    }
  }
  return {
    source: "claude-code",
    id,
    messages,
    main,
    sidechain,
    subagentSessions: 0,
    naiveMain: naive,
    costUsd: null,
    ...ledger.summarize(),
  };
}

/** Rows as read from the OpenCode database; `data` is the raw JSON text of the row. */
export type OpenCodeSessionRow = {
  id: string;
  parent_id: string | null;
  directory?: string | null;
};
export type OpenCodeMessageRow = { id: string; session_id: string; data: string };
export type OpenCodePartRow = { id: string; message_id: string; session_id: string; data: string };

/**
 * Build per-session reports from OpenCode rows. Tokens come from assistant message rows
 * ONLY: step-finish parts repeat the same numbers, so summing both would double count.
 * Sessions with a parent_id are subagent sessions and are reported as sidechain.
 */
export function parseOpenCodeRows(
  sessions: OpenCodeSessionRow[],
  messages: OpenCodeMessageRow[],
  parts: OpenCodePartRow[],
): SessionReport[] {
  const out = new Map<string, SessionReport>();
  const ledgers = new Map<string, ToolLedger>();
  const child = new Set(sessions.filter((s) => s.parent_id).map((s) => s.id));
  const get = (sid: string): SessionReport => {
    let r = out.get(sid);
    if (!r) {
      r = {
        source: "opencode",
        id: sid,
        messages: 0,
        main: emptyTotals(),
        sidechain: emptyTotals(),
        subagentSessions: 0,
        naiveMain: null,
        costUsd: 0,
        toolCalls: {},
        toolErrors: 0,
        repeatedReads: [],
        oversized: [],
        toolResultChars: 0,
        retries: 0,
        wastedTurns: 0,
      };
      out.set(sid, r);
      ledgers.set(sid, new ToolLedger());
    }
    return r;
  };

  for (const s of sessions) get(s.id);
  for (const m of messages) {
    let data: unknown;
    try {
      data = JSON.parse(m.data);
    } catch {
      continue;
    }
    if (!isObj(data) || data.role !== "assistant" || !isObj(data.tokens)) continue;
    const t = data.tokens;
    const cache = isObj(t.cache) ? t.cache : {};
    const usage: Totals = {
      input: num(t.input),
      output: num(t.output),
      reasoning: num(t.reasoning),
      cacheRead: num(cache.read),
      cacheWrite: num(cache.write),
    };
    const r = get(m.session_id);
    if (child.has(m.session_id)) r.sidechain = addTotals(r.sidechain, usage);
    else {
      r.main = addTotals(r.main, usage);
      r.messages += 1;
    }
    r.costUsd = (r.costUsd ?? 0) + num(data.cost);
  }

  for (const p of parts) {
    let data: unknown;
    try {
      data = JSON.parse(p.data);
    } catch {
      continue;
    }
    if (!isObj(data) || data.type !== "tool" || !isObj(data.state)) continue;
    const name = typeof data.tool === "string" ? data.tool : "unknown";
    const ledger = ledgers.get(p.session_id) ?? (get(p.session_id), ledgers.get(p.session_id)!);
    const callId = typeof data.callID === "string" ? data.callID : p.id;
    const input = data.state.input;
    ledger.addCall(callId, {
      name,
      key: `${name}:${sizeOf(input) > 4096 ? callId : JSON.stringify(input)}`,
      path: readPath(input),
      sidechain: child.has(p.session_id),
      turn: p.message_id,
    });
    const status = data.state.status;
    if (status === "completed" || status === "error") {
      ledger.addResult(callId, {
        size: sizeOf(data.state.output ?? data.state.error),
        error: status === "error",
      });
    }
  }

  for (const [sid, r] of out) Object.assign(r, ledgers.get(sid)!.summarize());
  // Fold each subagent session into its parent so cost is visible in one row.
  const parentOf = new Map(
    sessions.filter((s) => s.parent_id).map((s) => [s.id, s.parent_id as string]),
  );
  const folded = new Set<string>();
  for (const [childId, parentId] of parentOf) {
    const c = out.get(childId);
    const p = out.get(parentId);
    if (!c || !p) continue;
    p.sidechain = addTotals(p.sidechain, c.sidechain);
    p.subagentSessions += 1;
    p.costUsd = (p.costUsd ?? 0) + (c.costUsd ?? 0);
    folded.add(childId);
  }
  return [...out.values()].filter(
    (r) => !folded.has(r.id) && (r.messages > 0 || sumTotals(r.sidechain) > 0),
  );
}

export type OpenCodeLoad = { sessions: SessionReport[]; skipped: string | null };

/**
 * Read an OpenCode database with node:sqlite (no dependency). When the module is
 * unavailable (Node below 22.13 needs a flag) the source is skipped with a message.
 */
export async function loadOpenCodeDb(
  dbPath: string,
  opts: { directory?: string; sessionIds?: string[]; limit?: number } = {},
): Promise<OpenCodeLoad> {
  let DatabaseSync: typeof import("node:sqlite").DatabaseSync;
  try {
    ({ DatabaseSync } = await import("node:sqlite"));
  } catch {
    return {
      sessions: [],
      skipped:
        "opencode: node:sqlite is unavailable on this Node version (needs 22.13+ or --experimental-sqlite); skipped",
    };
  }
  let db: InstanceType<typeof DatabaseSync>;
  try {
    db = new DatabaseSync(dbPath, { readOnly: true });
  } catch (e) {
    return { sessions: [], skipped: `opencode: cannot open ${dbPath}: ${(e as Error).message}` };
  }
  try {
    const where: string[] = [];
    const args: (string | number)[] = [];
    if (opts.directory) {
      where.push("directory = ?");
      args.push(opts.directory);
    }
    if (opts.sessionIds && opts.sessionIds.length > 0) {
      where.push(`id IN (${opts.sessionIds.map(() => "?").join(",")})`);
      args.push(...opts.sessionIds);
    } else {
      where.push("parent_id IS NULL");
    }
    const clause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
    const limit = opts.limit && opts.limit > 0 ? ` LIMIT ${Math.floor(opts.limit)}` : "";
    const sessions = db
      .prepare(
        `SELECT id, parent_id, directory FROM session ${clause} ORDER BY time_updated DESC${limit}`,
      )
      .all(...args) as OpenCodeSessionRow[];
    // include subagent children of the selected sessions
    const ids = sessions.map((s) => s.id);
    const kids =
      ids.length > 0
        ? (db
            .prepare(
              `SELECT id, parent_id, directory FROM session WHERE parent_id IN (${ids.map(() => "?").join(",")})`,
            )
            .all(...ids) as OpenCodeSessionRow[])
        : [];
    const all = [...sessions, ...kids.filter((k) => !ids.includes(k.id))];
    const allIds = all.map((s) => s.id);
    if (allIds.length === 0) return { sessions: [], skipped: null };
    const q = allIds.map(() => "?").join(",");
    const messages = db
      .prepare(`SELECT id, session_id, data FROM message WHERE session_id IN (${q})`)
      .all(...allIds) as OpenCodeMessageRow[];
    const parts = db
      .prepare(
        `SELECT id, message_id, session_id, data FROM part WHERE session_id IN (${q}) AND json_extract(data,'$.type') = 'tool'`,
      )
      .all(...allIds) as OpenCodePartRow[];
    return { sessions: parseOpenCodeRows(all, messages, parts), skipped: null };
  } catch (e) {
    return {
      sessions: [],
      skipped: `opencode: unexpected database layout (${(e as Error).message}); skipped`,
    };
  } finally {
    db.close();
  }
}

export type RunTotals = {
  /** Everything processed: main + subagents, cache included. */
  total: number;
  /** The same without cache reads, which dominate long sessions. */
  uncached: number;
  /** Subagent share of `total`. */
  subagent: number;
  costUsd: number | null;
  sessions: number;
};

/** Collapse the sessions of one eval run into a single comparable figure. */
export function sumSessions(sessions: SessionReport[]): RunTotals {
  let total = 0;
  let uncached = 0;
  let subagent = 0;
  let cost: number | null = null;
  for (const s of sessions) {
    const side = sumTotals(s.sidechain);
    total += sumTotals(s.main) + side;
    uncached += sumTotals(s.main) - s.main.cacheRead + (side - s.sidechain.cacheRead);
    subagent += side;
    if (s.costUsd !== null) cost = (cost ?? 0) + s.costUsd;
  }
  return { total, uncached, subagent, costUsd: cost, sessions: sessions.length };
}

function k(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

export function formatReport(sessions: SessionReport[], skipped: string[] = []): string {
  const lines: string[] = [];
  for (const s of sessions) {
    const total = sumTotals(s.main);
    lines.push(`${s.source} ${s.id}`);
    lines.push(
      `  tokens ${k(total)} total, ${k(total - s.main.cacheRead)} uncached  (in ${k(s.main.input)} · out ${k(s.main.output)}${s.main.reasoning ? ` · reasoning ${k(s.main.reasoning)}` : ""} · cache read ${k(s.main.cacheRead)} · cache write ${k(s.main.cacheWrite)})  over ${s.messages} message(s)`,
    );
    if (sumTotals(s.sidechain) > 0) {
      const n = s.subagentSessions > 0 ? ` across ${s.subagentSessions} session(s)` : "";
      lines.push(
        `  subagents ${k(sumTotals(s.sidechain))} tokens${n} (reported separately, not in the line above)`,
      );
    }
    lines.push(
      `  cost ${s.costUsd === null ? "not reported by this agent (no price table in this repo)" : `$${s.costUsd.toFixed(4)} as reported by the agent`}`,
    );
    if (s.naiveMain && sumTotals(s.naiveMain) !== total) {
      lines.push(
        `  note: summing per record would give ${k(sumTotals(s.naiveMain))}; deduped by message id`,
      );
    }
    const calls = Object.entries(s.toolCalls).sort((a, b) => b[1] - a[1]);
    lines.push(
      `  tool calls ${calls.reduce((n, [, c]) => n + c, 0)}  ${calls
        .slice(0, 6)
        .map(([n, c]) => `${n} ${c}`)
        .join(" · ")}`,
    );
    lines.push(
      `  tool results ${k(s.toolResultChars)} chars · errors ${s.toolErrors} · retries ${s.retries} · wasted turns ${s.wastedTurns}`,
    );
    for (const r of s.repeatedReads.slice(0, 5))
      lines.push(`  repeated read x${r.count}  ${r.path}`);
    for (const o of s.oversized.slice(0, 5))
      lines.push(`  oversized output ${k(o.size)} chars  (${o.tool})`);
  }
  for (const m of skipped) lines.push(m);
  if (sessions.length === 0 && skipped.length === 0) lines.push("no sessions found");
  lines.push(
    "method: Claude Code usage deduped by message.id; OpenCode tokens from assistant message rows only (step-finish parts repeat them). Formats are observed, not vendor-verified. Message contents are never read into this report.",
  );
  return lines.join("\n");
}
