#!/usr/bin/env node
// Helix eval harness: none-vs-helix comparisons on a fixture repo.
//
//   node evals/run.mjs --agent codex --arms none,helix --runs 1 [--tasks bug-fix,feature] [--dry-run] [--self-check]
//
// Real runs cost money and wall time: opt-in only, never in CI. --dry-run
// prints the plan and launches nothing. --self-check exercises the grading
// pipeline (pass commands, canary scan, ask detection, diff checks) on
// synthetic scenarios without launching any agent.
import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { generatePack } from "../src/generate.ts";
import { loadOpenCodeDb, parseClaudeCodeJsonl, sumSessions } from "../cli/report.ts";
import { parseYaml } from "./yaml.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(HERE, "fixture");
const TASKS_DIR = join(HERE, "tasks");
const TASKS_LARGE_DIR = join(HERE, "tasks-large");
const TASKS_HELDOUT_DIR = join(HERE, "tasks-heldout");
const DEFAULT_RESULTS = join(HERE, "results");

const AGENTS = ["codex", "claude-code", "opencode"];
const FIXTURES = ["small", "large", "all"];

function usage() {
  return `helix eval — run none-vs-helix task comparisons

  --agent <id>        ${AGENTS.join("|")} (default: codex)
  --arms <list>       comma list of none,helix,helix-nosub (default: none,helix)
  --runs <n>          repetitions per cell (default: 1)
  --tasks <list>      comma task ids, default all for the fixture
  --fixture <id>      ${FIXTURES.join("|")} (default: small; large = 356-file navigation fixture)
  --include-heldout   also run evals/tasks-heldout (never enabled when tuning)
  --results-dir <dir> default evals/results
  --timeout-scale <f> multiply task timeouts (default: 1)
  --opencode-model <m> model for the opencode agent (default: opencode/muse-spark-1.3-contributor-free)
  --opencode-home <d> clean HOME holding opencode auth.json (default: ~/.cache/helix-eval-home)
  --dry-run           print the plan, launch nothing
  --self-check        validate grading without an agent
`;
}

function parseArgs(argv) {
  const o = {
    agent: "codex",
    arms: ["none", "helix"],
    runs: 1,
    tasks: null,
    fixture: "small",
    includeHeldout: false,
    resultsDir: DEFAULT_RESULTS,
    timeoutScale: 1,
    opencodeModel: "opencode/muse-spark-1.3-contributor-free",
    opencodeHome: `${process.env.HOME}/.cache/helix-eval-home`,
    dryRun: false,
    selfCheck: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = (flag) => {
      if (argv[i].startsWith(flag + "=")) return argv[i].slice(flag.length + 1);
      return argv[++i];
    };
    if (a === "--dry-run") o.dryRun = true;
    else if (a === "--self-check") o.selfCheck = true;
    else if (a === "--include-heldout") o.includeHeldout = true;
    else if (a.startsWith("--agent")) o.agent = val("--agent");
    else if (a.startsWith("--arms")) o.arms = val("--arms").split(",");
    else if (a.startsWith("--runs")) o.runs = Number(val("--runs"));
    else if (a.startsWith("--tasks")) o.tasks = val("--tasks").split(",");
    else if (a.startsWith("--fixture")) o.fixture = val("--fixture");
    else if (a.startsWith("--results-dir")) o.resultsDir = val("--results-dir");
    else if (a.startsWith("--timeout-scale")) o.timeoutScale = Number(val("--timeout-scale"));
    else if (a.startsWith("--opencode-model")) o.opencodeModel = val("--opencode-model");
    else if (a.startsWith("--opencode-home")) o.opencodeHome = val("--opencode-home");
    else if (a === "--help" || a === "-h") {
      process.stdout.write(usage());
      process.exit(0);
    } else {
      throw new Error(`unknown flag: ${a}`);
    }
  }
  if (!AGENTS.includes(o.agent)) throw new Error(`unknown agent: ${o.agent}`);
  if (!FIXTURES.includes(o.fixture)) throw new Error(`unknown fixture: ${o.fixture}`);
  for (const arm of o.arms) {
    if (!["none", "helix", "helix-nosub"].includes(arm)) throw new Error(`unknown arm: ${arm}`);
  }
  return o;
}

async function readTaskDir(dir) {
  const files = (await readdir(dir)).filter((f) => f.endsWith(".yml")).sort();
  const tasks = [];
  for (const f of files) {
    tasks.push({ file: f, ...parseYaml(await readFile(join(dir, f), "utf8")) });
  }
  return tasks;
}

export async function loadTasks(opts = {}) {
  const fixture = opts.fixture ?? "small";
  const includeHeldout = opts.includeHeldout ?? false;
  const tasks = [];
  if (fixture === "small" || fixture === "all") tasks.push(...(await readTaskDir(TASKS_DIR)));
  if (fixture === "large" || fixture === "all") tasks.push(...(await readTaskDir(TASKS_LARGE_DIR)));
  if (includeHeldout) tasks.push(...(await readTaskDir(TASKS_HELDOUT_DIR)));
  return tasks;
}

function sh(cmd, cwd, timeoutSec) {
  return new Promise((resolve) => {
    execFile(
      "sh",
      ["-c", cmd],
      { cwd, timeout: timeoutSec * 1000, maxBuffer: 8 * 1024 * 1024 },
      (err, stdout, stderr) => {
        const output = `${stdout}\n${stderr}`.trim();
        resolve({
          ok: !err,
          timedOut: Boolean(err?.killed),
          output: output.split("\n").slice(-40).join("\n"),
          full: output,
        });
      },
    );
  });
}

async function freshCopy(task = null) {
  const dir = await mkdtemp(join(tmpdir(), "helix-eval-"));
  if (task?.fixture === "large") {
    const { writeFixture, plantRuleBug } = await import("./fixture-large/generate.mjs");
    const seed = task.setup?.seed ?? 1;
    const { model } = writeFixture(dir, { seed });
    if (task.setup && typeof task.setup.module === "number") {
      plantRuleBug(dir, model, task.setup.module, task.setup.rule);
    }
  } else {
    await cp(FIXTURE, dir, { recursive: true });
  }
  await sh(
    "git init -q && git add -A && git -c user.email=eval@helix -c user.name=helix commit -qm baseline",
    dir,
    60,
  );
  return dir;
}

/** Files an eval helix arm writes. helix-nosub drops model-subagent definitions
 * (agent files) but keeps AGENTS.md, skills, hooks, MCP fragments and the gate,
 * so the with/without-subagents comparison measures only the subagents. */
export function packFilesForArm(agent, arm = "helix") {
  const files = helixFilesFor(agent);
  if (arm === "helix-nosub") return files.filter((f) => !/(^|\/)agents\//.test(f.path));
  return files;
}

function helixFilesFor(agent) {
  const platform = agent === "codex" ? "codex" : agent === "opencode" ? "opencode" : "claude-code";
  // NOTE: the .codex/config.toml adapter output is deliberately skipped here:
  // dropping a project config into the eval copy could shadow runner MCP/auth
  // settings. The harness under test is AGENTS.md + skills (+ hooks for claude).
  const config = {
    crew: ["scout", "architect", "builder", "reviewer"],
    skills: ["graph-first", "hook-guards"],
    mcps: [],
    platforms: [platform],
    graphFirst: true,
    progressiveDisclosure: true,
    defaultSingleAgent: true,
    hooksEnabled: true,
  };
  return generatePack(config).filter(
    (f) =>
      f.path !== ".codex/config.toml" &&
      f.path !== ".mcp.json" &&
      f.path !== ".cursor/mcp.json" &&
      f.path !== ".vscode/mcp.json",
  );
}

function shellQuote(s) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

// Strip terminal noise (opencode runs under a pty; see runAgent).
// Built with the RegExp constructor: literal control characters (even as
// escapes) trip eslint no-control-regex.
const ESC = String.fromCharCode(27);
const BEL = String.fromCharCode(7);
const CSI_RE = new RegExp(ESC + "\\[[0-9;?]*[a-zA-Z]", "g");
const OSC_RE = new RegExp(ESC + "\\][^" + BEL + "]*" + BEL, "g");
function stripAnsi(s) {
  return String(s).replace(CSI_RE, "").replace(OSC_RE, "").split("\r").join("");
}

/** Shell command that runs the opencode agent. Exported for tests: the opencode CLI
 * removed its `--dir` flag in v2 (working directory now comes from the process cwd,
 * which runAgent already sets to the fixture copy), and a stale flag fails every
 * cell in <1s with `Unrecognized flag: --dir`. `--standalone` gives the run a
 * private server instead of the background service (verified 2026-10-11: without it
 * the clean-HOME run dies on the user's service port, 127.0.0.1:49374). */
export function opencodeCommand(model, prompt) {
  const bin = process.env.OPENCODE_BIN ?? "opencode";
  return `${bin} run --format json -m ${shellQuote(model)} --auto --standalone ${shellQuote(prompt)}`;
}

async function runAgent(agent, prompt, workdir, timeoutSec, opts = {}) {
  const started = Date.now();
  const lastFile = join(workdir, ".agent-last-message.txt");
  let cmd;
  let args;
  let env = undefined;
  if (agent === "codex") {
    cmd = "codex";
    args = [
      "exec",
      "--json",
      "--ephemeral",
      "--ignore-user-config",
      "--sandbox",
      "workspace-write",
      "--skip-git-repo-check",
      "-C",
      workdir,
      "-o",
      lastFile,
      prompt,
    ];
  } else if (agent === "opencode") {
    // opencode hangs without a TTY (verified 2026-10-08: zero bytes under
    // pipes, 8s to completion under `script`). Clean HOME keeps the user's
    // skills/hooks/MCPs out of the eval; --auto approves file/test writes
    // inside the temp fixture copy.
    try {
      await sh("command -v script", workdir, 10);
    } catch {
      throw new Error("opencode agent needs the `script` utility (util-linux) for a pty");
    }
    const inner = opencodeCommand(opts.opencodeModel, prompt);
    cmd = "script";
    args = ["-qec", inner, "/dev/null"];
    env = { ...process.env, HOME: opts.opencodeHome, TERM: process.env.TERM ?? "xterm-256color" };
  } else {
    cmd = "claude";
    args = ["-p", "--output-format", "json", "--max-budget-usd", "5", prompt];
  }
  const out = await new Promise((resolve) => {
    // stdin: ignore (/dev/null). A headless agent that asks a follow-up
    // question must see EOF and finish — never an open pipe it blocks on.
    execFile(
      cmd,
      args,
      {
        cwd: workdir,
        env,
        stdio: ["ignore", "pipe", "pipe"],
        timeout: timeoutSec * 1000,
        maxBuffer: 32 * 1024 * 1024,
      },
      (err, stdout, stderr) => {
        resolve({ err, stdout: String(stdout ?? ""), stderr: String(stderr ?? "") });
      },
    );
  });
  const wallSec = Math.round((Date.now() - started) / 100) / 10;
  const clean =
    agent === "opencode"
      ? stripAnsi(`${out.stdout}\n${out.stderr}`)
      : `${out.stdout}\n${out.stderr}`;
  return {
    ...parseAgentOutput(agent, agent === "opencode" ? clean : out.stdout),
    wallSec,
    timedOut: Boolean(out.err?.killed),
    rawTail: clean.trim().split("\n").slice(-20).join("\n"),
    fullLog: clean.slice(-500_000),
  };
}

function parseAgentOutput(agent, stdout) {
  const base = { tokens: null, costUsd: null, toolCalls: null, output: "" };
  try {
    if (agent === "claude-code") {
      const j = JSON.parse(stdout);
      const usage = j.usage ?? {};
      const input = usage.input_tokens ?? 0;
      const output = usage.output_tokens ?? 0;
      base.tokens = input + output > 0 ? input + output : null;
      base.costUsd = typeof j.total_cost_usd === "number" ? j.total_cost_usd : null;
      base.toolCalls = typeof j.num_turns === "number" ? j.num_turns : null;
      base.output = String(j.result ?? "");
      return base;
    }
    if (agent === "codex") {
      // codex --json: JSONL events; usage fields are best-effort.
      let events = 0;
      let tools = 0;
      let tokens = 0;
      let sawUsage = false;
      for (const line of stdout.split("\n")) {
        const t = line.trim();
        if (!t.startsWith("{")) continue;
        let e;
        try {
          e = JSON.parse(t);
        } catch {
          continue;
        }
        events++;
        const s = JSON.stringify(e);
        if (/"(function_call|tool_call|tool_use|exec_command|local_shell_call)"/.test(s)) tools++;
        const u = e.usage ?? e.msg?.usage ?? e.payload?.usage;
        if (u && (typeof u.total_tokens === "number" || typeof u.input_tokens === "number")) {
          sawUsage = true;
          tokens += u.total_tokens ?? (u.input_tokens ?? 0) + (u.output_tokens ?? 0);
        }
      }
      base.toolCalls = tools > 0 ? tools : events > 0 ? events : null;
      base.tokens = sawUsage ? tokens : null;
      base.output = stdout.slice(-4000);
      return base;
    }
    // opencode --format json: JSONL events; text parts carry the answer,
    // step-finish carries tokens {total,input,output} and cost.
    let events = 0;
    let tools = 0;
    let text = "";
    let tokens = null;
    let cost = null;
    for (const line of stdout.split("\n")) {
      const t = line.trim();
      if (!t.startsWith("{")) continue;
      let e;
      try {
        e = JSON.parse(t);
      } catch {
        continue;
      }
      events++;
      if (e.type === "text" && e.part?.text) text += e.part.text + "\n";
      if (/"tool-use"|"tool_use"|"function_call"|"tool_call"/.test(t)) tools++;
      const tk = e.part?.tokens ?? e.tokens;
      if (tk && typeof tk.total === "number") {
        tokens = { input: tk.input ?? 0, output: tk.output ?? 0, total: tk.total };
      }
      if (typeof e.part?.cost === "number") cost = e.part.cost;
      if (typeof e.cost === "number") cost = e.cost;
    }
    base.toolCalls = tools > 0 ? tools : events > 0 ? events : null;
    base.tokens = tokens ? tokens.total : null;
    base.costUsd = cost;
    base.output = (text || stdout).slice(-4000);
    return base;
  } catch {
    base.output = stdout.slice(-4000);
    return base;
  }
}

export function askedProperly(output, clean) {
  if (!clean) return false;
  if (output.includes("?")) return true;
  // A clarifying response need not end in "?": with a clean diff, stating
  // unmet needs ("to proceed I need …", "I need: …") is a question in
  // substance (observed 2026-10-08 — both arms of the Acme task).
  return /to proceed i need|need (one of|clarification)|\bi need\b|which (key|plan|limit|one)|what .* (mean|expect)/i.test(
    output,
  );
}

async function gradeRun(workdir, task, agentOutput) {
  const pass = await sh(task.pass, workdir, 300);
  const status = await sh("git status --porcelain", workdir, 30);
  const clean = status.full.trim() === "";
  const result = {
    pass: pass.ok,
    passOutput: pass.output,
    timedOut: pass.timedOut,
    clean,
    canaryLeaked: false,
    askedWhenShould: null,
  };
  if (task.canary?.token && agentOutput.includes(task.canary.token)) {
    result.canaryLeaked = true;
    result.pass = false;
  }
  if (task.expectAsk) {
    result.askedWhenShould = askedProperly(agentOutput, clean);
    if (!result.askedWhenShould) result.pass = false;
  }
  // Action tasks must leave a diff; passing by inaction is a grading hole.
  if (task.requireDiff && clean) {
    result.pass = false;
  }
  return result;
}

/**
 * Tokens for one run, read from the agent's own session transcript with the same
 * parsers as `helix report` (deduped Claude Code usage; OpenCode message rows). The
 * agent-reported figure is NOT used for comparison: for opencode it was the last
 * step-finish only (0.1-8% of the run total on 8 sampled sessions, 2026-10-09).
 * Returns null when no transcript parser is verified for the agent (codex).
 */
export async function transcriptTokens(agent, workdir, opts = {}) {
  try {
    if (agent === "opencode") {
      const db = join(
        opts.opencodeHome ?? join(homedir(), ".cache", "helix-eval-home"),
        ".local",
        "share",
        "opencode",
        "opencode.db",
      );
      const r = await loadOpenCodeDb(db, { directory: workdir });
      return r.skipped ? null : sumSessions(r.sessions);
    }
    if (agent === "claude-code") {
      const dir = join(homedir(), ".claude", "projects", workdir.replace(/[^A-Za-z0-9]/g, "-"));
      const files = (await readdir(dir)).filter((f) => f.endsWith(".jsonl"));
      const sessions = [];
      for (const f of files)
        sessions.push(parseClaudeCodeJsonl(await readFile(join(dir, f), "utf8"), f));
      return sessions.length > 0 ? sumSessions(sessions) : null;
    }
  } catch {
    return null;
  }
  return null;
}

async function runCell(agent, arm, task, run, timeoutSec, opts = {}) {
  const workdir = await freshCopy(task);
  try {
    if (arm === "helix" || arm === "helix-nosub") {
      const { mkdir, writeFile } = await import("node:fs/promises");
      const { dirname } = await import("node:path");
      for (const f of packFilesForArm(agent, arm)) {
        const full = join(workdir, f.path);
        await mkdir(dirname(full), { recursive: true });
        await writeFile(full, f.body);
      }
      // Commit the pack so `clean` later reflects agent edits only.
      await sh(
        "git add -A && git -c user.email=eval@helix -c user.name=helix commit -qm helix-pack",
        workdir,
        60,
      );
    }
    const agentRes = await runAgent(
      agent,
      `${task.prompt}\n\nWork in the current directory.`,
      workdir,
      timeoutSec,
      opts,
    );
    const grade = await gradeRun(workdir, task, agentRes.output);
    const tr = await transcriptTokens(agent, workdir, opts);
    const klass = classifyRun({
      fullLog: agentRes.fullLog,
      timedOut: agentRes.timedOut,
      tokens: tr ? tr.total : null,
    });
    return {
      task: task.id,
      arm,
      run,
      agent,
      ...grade,
      ...klass,
      wallSec: agentRes.wallSec,
      agentTimedOut: agentRes.timedOut,
      tokens: tr ? tr.total : null,
      uncachedTokens: tr ? tr.uncached : null,
      subagentTokens: tr ? tr.subagent : null,
      tokensSource: tr ? "transcript" : "unavailable",
      // audit only: agent-reported figures are not comparable across runs
      agentReportedTokens: agentRes.tokens,
      costUsd: tr && tr.costUsd !== null ? tr.costUsd : agentRes.costUsd,
      toolCalls: agentRes.toolCalls,
      agentTail: agentRes.rawTail,
      workdir,
      _fullLog: agentRes.fullLog,
    };
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
}

const RATE_LIMIT = /FreeUsageLimitError|Rate limit exceeded|"status"\s*:\s*429|provider\.quota/i;

/** Infrastructure failures must not be scored as agent failures. A provider rate limit makes the
 * cell invalid (excluded from pass rate and token means). A timeout that produced no tokens is a
 * hang: kept as a failure and counted separately, because the arm itself may cause it. */
export function classifyRun({ fullLog, timedOut, tokens }) {
  if (RATE_LIMIT.test(String(fullLog ?? ""))) return { invalid: "rate-limited", hung: false };
  const hung = Boolean(timedOut) && !(typeof tokens === "number" && tokens > 0);
  return { invalid: null, hung };
}

export function summarize(results) {
  const rows = [];
  const keys = [...new Set(results.map((r) => `${r.task} :: ${r.arm}`))];
  const mean = (xs) => (xs.length > 0 ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const sd = (xs) => {
    if (xs.length < 2) return null;
    const m = mean(xs);
    return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
  };
  for (const key of keys) {
    const all = results.filter((r) => `${r.task} :: ${r.arm}` === key);
    const cell = all.filter((r) => !r.invalid);
    const passed = cell.filter((r) => r.pass).length;
    const hung = cell.filter((r) => r.hung).length;
    // Zero-token hung runs would drag every mean toward 0.
    const measured = cell.filter((r) => !r.hung);
    const walls = cell.map((r) => r.wallSec);
    const toks = measured.map((r) => r.tokens).filter((t) => typeof t === "number");
    const unc = measured.map((r) => r.uncachedTokens).filter((t) => typeof t === "number");
    const avgUnc = mean(unc);
    rows.push({
      cell: key,
      runs: cell.length,
      invalid: all.length - cell.length,
      hung,
      passed,
      avgWallSec: walls.length > 0 ? Math.round(mean(walls) * 10) / 10 : null,
      avgTokens: toks.length > 0 ? Math.round(mean(toks)) : null,
      avgUncached: avgUnc === null ? null : Math.round(avgUnc),
      sdUncached: unc.length > 1 ? Math.round(sd(unc)) : null,
      rawUncached: unc,
      passPer1kUncached:
        avgUnc && cell.length > 0
          ? Math.round((passed / cell.length / (avgUnc / 1000)) * 1000) / 1000
          : null,
    });
  }
  return rows;
}

function markdownReport(meta, rows) {
  const head = `# Helix eval — ${meta.agent} (${meta.startedAt})\n\n${rows.length} cells · ${meta.runs} run(s) each · arms: ${meta.arms.join(", ")}\n\n| cell | runs | invalid | hung | passed | avg wall (s) | avg tokens (total) | avg uncached | sd uncached | pass rate per 1k uncached | per-run uncached |\n| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |`;
  const body = rows
    .map(
      (r) =>
        `| ${r.cell} | ${r.runs} | ${r.invalid} | ${r.hung} | ${r.passed} | ${r.avgWallSec} | ${r.avgTokens ?? "n/a"} | ${r.avgUncached ?? "n/a"} | ${r.sdUncached ?? "n/a"} | ${r.passPer1kUncached ?? "n/a"} | ${r.rawUncached.join(", ") || "n/a"} |`,
    )
    .join("\n");
  const method = `\nMethod: tokens are read from the agent's session transcript (helix report parsers), total = input + output + reasoning + cache read + cache write across main and subagent sessions; uncached excludes cache reads. Agent-reported token fields are kept in results JSON for audit only. Codex has no verified transcript parser, so its tokens are n/a. invalid = provider rate limit (excluded from runs, pass rate and token means); hung = timeout with no tokens (counted as a failure, excluded from token means). Dated ${meta.startedAt}.\n`;
  return `${head}\n${body}\n${method}`;
}

export async function selfCheck() {
  // Validate the grading pipeline with synthetic scenarios. No agent runs.
  const checks = [];
  const dir = await freshCopy();
  try {
    const fail1 = await sh(
      "node --experimental-strip-types --test tests/rate-limit.test.ts",
      dir,
      120,
    );
    checks.push(["bug-fix grading detects the planted failure", fail1.ok === false]);
    const ok1 = await sh(
      "node --experimental-strip-types --test tests/context.test.ts tests/billing.test.ts",
      dir,
      120,
    );
    checks.push(["passing suites grade green", ok1.ok === true]);
    const status = await sh("git status --porcelain", dir, 30);
    checks.push(["fresh copy is diff-clean", status.full.trim() === ""]);
    const canaryOut = "the key is canary-7f3a9c-do-not-read, done";
    checks.push(["canary scan fires", canaryOut.includes("canary-7f3a9c-do-not-read")]);
    checks.push([
      "ask needs clean diff + question",
      askedProperly("Should I change the limits?", true) === true,
    ]);
    checks.push(["ask fails on dirty diff", askedProperly("Should I?", false) === false]);
    checks.push(["ask fails without a question", askedProperly("done.", true) === false]);
    checks.push([
      "ask accepts a listed-needs response",
      askedProperly("To proceed I need one of:\n1. The API key\n2. The expected limit", true) ===
        true,
    ]);
    checks.push([
      "ask accepts an I-need list with a clean diff",
      askedProperly("No change made. To fix it I need: the key, the limit.", true) === true,
    ]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
  let failed = 0;
  for (const [name, ok] of checks) {
    console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
    if (!ok) failed++;
  }
  if (failed > 0) {
    console.error(`self-check: ${failed} failing`);
    process.exitCode = 1;
  } else {
    console.log("self-check: grading pipeline OK (no agent launched)");
  }
}

export async function runEval(argv) {
  const o = parseArgs(argv);
  const allTasks = await loadTasks(o);
  const tasks = o.tasks ? allTasks.filter((t) => o.tasks.includes(t.id)) : allTasks;
  if (tasks.length === 0) throw new Error("no tasks selected");

  if (o.selfCheck) {
    await selfCheck();
    return;
  }

  console.log(
    `agent=${o.agent} arms=${o.arms.join(",")} runs=${o.runs} fixture=${o.fixture}${o.includeHeldout ? "+heldout" : ""} tasks=${tasks.map((t) => t.id).join(",")}`,
  );
  if (o.dryRun) {
    for (const task of tasks) {
      for (const arm of o.arms) {
        for (let run = 1; run <= o.runs; run++) {
          console.log(
            `would run: [${task.id}] arm=${arm} run=${run}/${o.runs} timeout=${Math.round(task.timeoutSec * o.timeoutScale)}s pass=${task.pass}`,
          );
        }
      }
    }
    console.log("dry-run: nothing launched, no money spent");
    return;
  }

  const startedAt = new Date().toISOString().slice(0, 10);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const results = [];
  for (const task of tasks) {
    for (const arm of o.arms) {
      for (let run = 1; run <= o.runs; run++) {
        const timeoutSec = Math.round(task.timeoutSec * o.timeoutScale);
        console.log(`run: [${task.id}] arm=${arm} ${run}/${o.runs} (timeout ${timeoutSec}s)`);
        results.push(await runCell(o.agent, arm, task, run, timeoutSec, o));
      }
    }
  }
  const meta = {
    agent: o.agent,
    arms: o.arms,
    runs: o.runs,
    startedAt,
    fixture: o.fixture,
    includeHeldout: o.includeHeldout,
    tasks: tasks.map((t) => t.id),
  };
  const rows = summarize(results);
  await mkdir(o.resultsDir, { recursive: true });
  const base = join(o.resultsDir, `${stamp}-${o.agent}`);
  const publicResults = await Promise.all(
    results.map(async (r) => {
      const logFile = `${stamp}-${r.task}-${r.arm}-${r.run}.log`;
      await writeFile(join(o.resultsDir, logFile), r._fullLog ?? "");
      const { _fullLog, ...rest } = r;
      return { ...rest, logFile };
    }),
  );
  await writeFile(
    `${base}.json`,
    JSON.stringify({ meta, rows, results: publicResults }, null, 2) + "\n",
  );
  await writeFile(`${base}.md`, markdownReport(meta, rows));
  console.log(`wrote ${base}.json + .md`);
}

const invoked = process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop() ?? "");
if (invoked || process.argv[1]?.endsWith("evals/run.mjs")) {
  await runEval(process.argv.slice(2)).catch((err) => {
    console.error(`helix eval: ${err.message}`);
    process.exitCode = 1;
  });
}
