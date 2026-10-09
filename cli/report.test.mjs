import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  OVERSIZED_CHARS,
  formatReport,
  loadOpenCodeDb,
  parseClaudeCodeJsonl,
  parseOpenCodeRows,
  sumSessions,
  sumTotals,
} from "./report.ts";

// All transcripts below are SYNTHETIC. Never commit real sessions.
const CANARY = "SECRET-PROMPT-TEXT-xyz";

const usage = (input, output, read, write) => ({
  input_tokens: input,
  output_tokens: output,
  cache_read_input_tokens: read,
  cache_creation_input_tokens: write,
});

const rec = (o) => JSON.stringify(o);

/** One API message written as three records (text, tool_use, tool_use), same id and usage. */
function assistantBlocks(msgId, u, blocks, extra = {}) {
  return blocks.map((content) =>
    rec({ type: "assistant", message: { id: msgId, role: "assistant", content: [content], usage: u }, ...extra }),
  );
}

const toolUse = (id, name, input) => ({ type: "tool_use", id, name, input });
const toolResult = (id, content, isError = false) =>
  rec({
    type: "user",
    message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content, is_error: isError }] },
  });

function sampleClaude() {
  const lines = [
    rec({ type: "user", message: { role: "user", content: CANARY } }),
    // msg_1: 3 records, one usage
    ...assistantBlocks("msg_1", usage(100, 40, 1000, 200), [
      { type: "text", text: CANARY },
      toolUse("t1", "Read", { file_path: "/p/a.ts" }),
      toolUse("t2", "Read", { file_path: "/p/a.ts" }),
    ]),
    toolResult("t1", "x".repeat(100)),
    toolResult("t2", "x".repeat(OVERSIZED_CHARS + 1)),
    // msg_2: errored call, then identical retry in msg_3
    ...assistantBlocks("msg_2", usage(120, 30, 1200, 0), [toolUse("t3", "Bash", { command: "npm t" })]),
    toolResult("t3", "boom", true),
    ...assistantBlocks("msg_3", usage(130, 20, 1300, 0), [toolUse("t4", "Bash", { command: "npm t" })]),
    toolResult("t4", "ok"),
    // subagent message
    ...assistantBlocks("msg_side", usage(50, 10, 500, 0), [{ type: "text", text: "sub" }], { isSidechain: true }),
    "not json at all",
    rec({ type: "future-record-type", message: { weird: true } }),
  ];
  return lines.join("\n");
}

describe("parseClaudeCodeJsonl", () => {
  const r = parseClaudeCodeJsonl(sampleClaude(), "s1");

  it("counts usage once per message id (naive per-record summing over-counts)", () => {
    // msg_1 has 3 records, msg_2..3 one each: deduped main output = 40 + 30 + 20
    assert.equal(r.main.output, 90);
    assert.equal(r.main.input, 350);
    assert.equal(r.main.cacheRead, 3500);
    assert.equal(r.main.cacheWrite, 200);
    assert.equal(r.messages, 3);
    // naive sums msg_1 three times; this assertion fails if the parser ever sums per record
    assert.equal(r.naiveMain.output, 40 * 3 + 30 + 20);
    assert.notEqual(sumTotals(r.main), sumTotals(r.naiveMain));
  });

  it("reports sidechain tokens separately", () => {
    assert.equal(r.sidechain.output, 10);
    assert.equal(r.sidechain.input, 50);
    assert.equal(sumTotals(r.sidechain), 560);
  });

  it("finds repeated reads, oversized outputs, retries and wasted turns", () => {
    assert.deepEqual(r.repeatedReads, [{ path: "/p/a.ts", count: 2 }]);
    assert.equal(r.oversized.length, 1);
    assert.equal(r.oversized[0].tool, "Read");
    assert.equal(r.toolErrors, 1);
    assert.equal(r.retries, 1);
    assert.equal(r.wastedTurns, 1);
    assert.equal(r.toolCalls.Read, 2);
    assert.equal(r.toolCalls.Bash, 2);
  });

  it("ignores unknown and malformed records and never carries message text", () => {
    assert.equal(r.costUsd, null);
    const text = JSON.stringify(r) + formatReport([r]);
    assert.ok(!text.includes(CANARY));
  });

  it("returns zeros for an empty transcript", () => {
    const e = parseClaudeCodeJsonl("", "e");
    assert.equal(e.messages, 0);
    assert.equal(sumTotals(e.main), 0);
  });
});

const ocMsg = (id, session_id, tokens, cost) => ({
  id,
  session_id,
  data: JSON.stringify({ role: "assistant", tokens, cost, content: CANARY }),
});
const tokens = (input, output, reasoning, read, write) => ({ input, output, reasoning, cache: { read, write } });

describe("parseOpenCodeRows", () => {
  const sessions = [
    { id: "s1", parent_id: null },
    { id: "s2", parent_id: "s1" },
  ];
  const messages = [
    ocMsg("m1", "s1", tokens(10, 5, 2, 100, 20), 0.01),
    ocMsg("m2", "s1", tokens(20, 5, 0, 200, 0), 0.02),
    ocMsg("m3", "s2", tokens(7, 3, 0, 70, 0), 0.005),
    { id: "mu", session_id: "s1", data: JSON.stringify({ role: "user" }) },
  ];
  const parts = [
    // step-finish parts repeat message tokens; they must not be counted
    {
      id: "p0",
      message_id: "m1",
      session_id: "s1",
      data: JSON.stringify({ type: "step-finish", tokens: { total: 137, input: 10, output: 5 }, cost: 0.01 }),
    },
    {
      id: "p1",
      message_id: "m1",
      session_id: "s1",
      data: JSON.stringify({
        type: "tool",
        tool: "read",
        callID: "c1",
        state: { status: "completed", input: { filePath: "/p/a.ts" }, output: "y".repeat(10) },
      }),
    },
    {
      id: "p2",
      message_id: "m2",
      session_id: "s1",
      data: JSON.stringify({
        type: "tool",
        tool: "read",
        callID: "c2",
        state: { status: "error", input: { filePath: "/p/a.ts" }, error: "nope" },
      }),
    },
    {
      id: "p3",
      message_id: "m2",
      session_id: "s1",
      data: JSON.stringify({
        type: "tool",
        tool: "read",
        callID: "c3",
        state: { status: "completed", input: { filePath: "/p/a.ts" }, output: "z" },
      }),
    },
  ];
  const [s1] = parseOpenCodeRows(sessions, messages, parts).filter((s) => s.id === "s1");
  const [s2] = parseOpenCodeRows(sessions, messages, parts).filter((s) => s.id === "s2");

  it("sums assistant message rows only, not step-finish parts", () => {
    assert.equal(s1.main.input, 30);
    assert.equal(s1.main.output, 10);
    assert.equal(s1.main.reasoning, 2);
    assert.equal(s1.main.cacheRead, 300);
    assert.equal(s1.main.cacheWrite, 20);
    assert.equal(s1.messages, 2);
  });

  it("folds subagent sessions into the parent's sidechain, not its main total", () => {
    assert.equal(s2, undefined);
    assert.equal(sumTotals(s1.sidechain), 80);
    assert.equal(s1.subagentSessions, 1);
    assert.equal(s1.main.input, 30);
    assert.ok(Math.abs(s1.costUsd - 0.035) < 1e-9);
  });

  it("reads tool parts for repeats, errors and retries", () => {
    assert.deepEqual(s1.repeatedReads, [{ path: "/p/a.ts", count: 3 }]);
    assert.equal(s1.toolErrors, 1);
    // only c3 repeats an EARLIER errored call (c2); c1 came before the error
    assert.equal(s1.retries, 1);
    assert.equal(s1.toolCalls.read, 3);
  });

  it("never carries message text", () => {
    assert.ok(!(JSON.stringify(s1) + formatReport([s1])).includes(CANARY));
  });
});

describe("sumSessions", () => {
  it("adds main and subagent tokens and separates the uncached figure", () => {
    const [s1] = parseOpenCodeRows(
      [
        { id: "s1", parent_id: null },
        { id: "s2", parent_id: "s1" },
      ],
      [ocMsg("m1", "s1", tokens(10, 5, 2, 100, 20), 0.01), ocMsg("m3", "s2", tokens(7, 3, 0, 70, 0), 0.005)],
      [],
    );
    const t = sumSessions([s1]);
    assert.equal(t.total, 137 + 80);
    assert.equal(t.uncached, 37 + 10);
    assert.equal(t.subagent, 80);
    assert.ok(Math.abs(t.costUsd - 0.015) < 1e-9);
    assert.equal(sumSessions([]).total, 0);
    assert.equal(sumSessions([]).costUsd, null);
  });
});

describe("loadOpenCodeDb", () => {
  it("reads a synthetic database with node:sqlite, or skips with a message", async (t) => {
    let sqlite;
    try {
      sqlite = await import("node:sqlite");
    } catch {
      const r = await loadOpenCodeDb("/nonexistent.db");
      assert.match(r.skipped ?? "", /node:sqlite is unavailable/);
      return;
    }
    const dir = mkdtempSync(join(tmpdir(), "helix-report-"));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const path = join(dir, "oc.db");
    const db = new sqlite.DatabaseSync(path);
    db.exec(`
      CREATE TABLE session (id TEXT, parent_id TEXT, directory TEXT, time_updated INTEGER);
      CREATE TABLE message (id TEXT, session_id TEXT, data TEXT);
      CREATE TABLE part (id TEXT, message_id TEXT, session_id TEXT, data TEXT);
    `);
    db.prepare("INSERT INTO session VALUES (?,?,?,?)").run("a", null, "/proj", 2);
    db.prepare("INSERT INTO session VALUES (?,?,?,?)").run("b", "a", "/proj", 3);
    db.prepare("INSERT INTO session VALUES (?,?,?,?)").run("c", null, "/other", 4);
    db.prepare("INSERT INTO session VALUES (?,?,?,?)").run("d", null, "/proj", 1);
    const ins = db.prepare("INSERT INTO message VALUES (?,?,?)");
    ins.run("m1", "a", JSON.stringify({ role: "assistant", tokens: tokens(1, 2, 0, 3, 4), cost: 0.5 }));
    ins.run("m2", "b", JSON.stringify({ role: "assistant", tokens: tokens(5, 5, 0, 0, 0), cost: 0.1 }));
    ins.run("m3", "c", JSON.stringify({ role: "assistant", tokens: tokens(9, 9, 0, 9, 9), cost: 9 }));
    db.close();

    const r = await loadOpenCodeDb(path, { directory: "/proj" });
    assert.equal(r.skipped, null);
    assert.deepEqual(r.sessions.map((s) => s.id), ["a"]);
    const a = r.sessions[0];
    assert.equal(a.main.output, 2);
    assert.equal(sumTotals(a.sidechain), 10);

    // limit keeps the most recent root sessions (and their subagent children)
    const limited = await loadOpenCodeDb(path, { directory: "/proj", limit: 1 });
    assert.deepEqual(limited.sessions.map((s) => s.id), ["a"]);
    assert.equal(limited.sessions[0].subagentSessions, 1);

    const bad = await loadOpenCodeDb(join(dir, "missing.db"));
    assert.ok(bad.skipped);
  });
});
