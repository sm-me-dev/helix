#!/usr/bin/env -S node --experimental-strip-types
// helix — init, doctor, measure, export, eval for the Helix harness pack.
// Requires Node 22.6+ (type stripping). No dependencies beyond the repo.
import { execFileSync, spawn, spawnSync } from "node:child_process";
import {
  accessSync,
  constants,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { GATE_SOURCE } from "../src/gate.ts";
import { generatePack } from "../src/generate.ts";
import { pluginPack } from "../src/plugin.ts";
import { cmdLearn } from "./learn.ts";
import { cmdRun } from "./run.ts";
import { addRcBlock, installShim, isOnPath, rcFileFor, removeRcBlock, removeShim } from "./link.ts";
import { startUi } from "./ui.ts";
import { DEFAULT_PLATFORMS, PLATFORM_BY_ID } from "../src/platforms.ts";
import {
  configForStack,
  defaultConfig,
  detectStack,
  diffLines,
  detectPlatforms,
  doctorPack,
  graphFreshness,
  mcpSummary,
  mergeOpenCodeConfig,
  measureReport,
  packJson,
  reconstructConfig,
} from "./lib.ts";
import {
  UnsafeDestinationError,
  prepareTargetRoot,
  preflightPack,
  readContained,
  writeContained,
} from "./safe-write.ts";
import { formatReport, loadOpenCodeDb, parseClaudeCodeJsonl } from "./report.ts";

const USAGE = `helix — AI coding harness pack manager

  helix init [dir] [--platform a,b|all] [--force] [--claude-plugin]
             [--crew [--lean-subagents]] [--ci|--no-ci] [--no-index]
                                                detect stack and agents, write the pack. Default:
                                                the universal pack, no model subagents.
                                                --crew: add scout/architect/builder/reviewer
                                                  (--lean-subagents: Claude Code starts the
                                                  read-only roles without AGENTS.md, v2.1.271+)
                                                --ci / --no-ci: GitHub workflow that runs the gate
                                                  (default: when the repo already has .github/)
                                                --no-index: do not run \`graphify update .\`
                                                --claude-plugin: Claude Code gets only what a
                                                plugin cannot ship; install \`helix plugin\` output
  helix plugin --out <dir>                      write a Claude Code plugin marketplace (one plugin:
                                                agents, skills, hooks, MCP) to <dir>
  helix doctor [dir]                            check the installed harness
  helix measure [dir]                           print the real token breakdown
  helix gate [dir] [--all] [--dry] [--json]     secrets, lint, typecheck, affected tests
                                                (exit 0 pass · 1 check failed · 2 usage)
  helix report [dir] [--claude <path>] [--opencode <db>] [--limit n] [--json]
                                                tokens, repeated reads, oversized outputs and
                                                retries from real session transcripts
  helix export --platform <id>                  print the pack as JSON (scripted use)
  helix run [task] [options]                    execute a coding task with ephemeral worktree,
                                                bounded context, and mechanical verification
                                                (--strategy, --platform, --dry, --pass, --json)
  helix bench [options]                         repeatable benchmark suite across 10 categories
                                                and 5 strategies (--strategy, --category, --json)
  helix eval [options]                          run the eval harness (see evals/README.md)
  helix learn <sub> [dir] [flags]               Learning Ledger: opt-in, evidence-gated
  helix link [--bin-dir <dir>] [--modify-rc|--no-modify-rc] [--force]
                                                put a \`helix\` command on your PATH (a shim in
                                                ~/.local/bin that points at this checkout)
  helix unlink [--bin-dir <dir>]                remove the shim and the PATH line \`link\` added
  helix ui [dir] [--port <n>] [--open]          local web view (127.0.0.1 only, token-protected):
                                                doctor, measure, gate, report, init
`;

function parseArgs(argv) {
  const [cmd, ...rest] = argv;
  const opts = {
    dir: ".",
    platforms: null,
    force: false,
    out: null,
    claudePlugin: false,
    crew: false,
    leanSubagents: false,
    ci: null,
    index: true,
    help: false,
    platform: null,
    benchArgs: [],
    evalArgs: [],
    gateArgs: [],
    reportArgs: [],
    learnArgs: [],
    runArgs: [],
    binDir: null,
    modifyRc: null,
    port: null,
    open: false,
  };
  const positional = [];
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    // eval, bench, and run have their own --help; every other command shows the shared usage.
    if ((a === "--help" || a === "-h") && cmd !== "eval" && cmd !== "bench" && cmd !== "run")
      opts.help = true;
    else if (cmd === "bench") opts.benchArgs.push(a);
    else if (cmd === "run") opts.runArgs.push(a);
    else if (cmd === "gate" && a.startsWith("--")) opts.gateArgs.push(a);
    else if (cmd === "report") opts.reportArgs.push(a);
    else if (cmd === "learn") opts.learnArgs.push(a);
    else if (a === "--force") opts.force = true;
    else if (a === "--claude-plugin") opts.claudePlugin = true;
    else if (a === "--crew") opts.crew = true;
    else if (a === "--lean-subagents") opts.leanSubagents = true;
    else if (a === "--ci") opts.ci = true;
    else if (a === "--no-ci") opts.ci = false;
    else if (a === "--no-index") opts.index = false;
    else if (a === "--out" && cmd === "plugin") opts.out = rest[++i] ?? null;
    else if (a.startsWith("--out=") && cmd === "plugin") opts.out = a.slice("--out=".length);
    else if (a === "--platform" && cmd === "export") opts.platform = rest[++i];
    else if (a.startsWith("--platform=")) opts.platforms = a.slice("--platform=".length).split(",");
    else if (a === "--platform") opts.platforms = (rest[++i] ?? "").split(",");
    else if (a === "--bin-dir") opts.binDir = rest[++i] ?? null;
    else if (a.startsWith("--bin-dir=")) opts.binDir = a.slice("--bin-dir=".length);
    else if (a === "--modify-rc") opts.modifyRc = true;
    else if (a === "--no-modify-rc") opts.modifyRc = false;
    else if (a === "--port") opts.port = Number(rest[++i]);
    else if (a.startsWith("--port=")) opts.port = Number(a.slice("--port=".length));
    else if (a === "--open") opts.open = true;
    else if (a.startsWith("-")) opts.evalArgs.push(a);
    else if (cmd === "eval") opts.evalArgs.push(a);
    else positional.push(a);
  }
  if (positional[0]) opts.dir = positional[0];
  return { cmd, opts };
}

function readText(path) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

function walkFiles(dir, out = new Map(), root = dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e === "node_modules" || e === ".git" || e === "graphify-out") continue;
    const full = join(dir, e);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) walkFiles(full, out, root);
    else out.set(full.slice(root.length + 1), readText(full) ?? "");
  }
  return out;
}

/** Paths `helix init` itself writes. They must not count as repo size, or a second init on a small
 * repo sees its own output, crosses the Graphify threshold and rewrites the pack. */
const PACK_OWNED =
  /^(\.helix|\.claude|\.cursor|\.codex|\.agents|\.opencode)\/|^(AGENTS\.md|CLAUDE\.md|GEMINI\.md|opencode\.json|\.mcp\.json|\.vscode\/mcp\.json|\.github\/workflows\/helix-gate\.yml|\.github\/copilot-instructions\.md)$/;

function detectDir(dir, files = walkFiles(dir)) {
  const names = new Set(files.keys());
  const pkgRaw = files.get("package.json");
  const stack = detectStack({
    names,
    packageJson: pkgRaw ? JSON.parse(pkgRaw) : null,
    makefile: files.get("Makefile") ?? files.get("makefile") ?? null,
    justfile: files.get("justfile") ?? files.get("Justfile") ?? null,
  });
  return { ...stack, fileCount: [...names].filter((n) => !PACK_OWNED.test(n)).length };
}

async function confirm(question) {
  // No terminal (CI, pipe, agent shell): never prompt, never overwrite. Pass
  // --force to overwrite non-interactively.
  if (!process.stdin.isTTY) return false;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    // Closing stdin mid-prompt (Ctrl-D) must resolve, or the process exits 13
    // with an unsettled top-level await.
    rl.once("close", () => resolve(false));
    rl.question(`${question} [y/N] `, (answer) => {
      rl.close();
      resolve(/^y(es)?$/i.test(answer.trim()));
    });
  });
}

function onPath(bin) {
  return (process.env.PATH ?? "").split(delimiter).some((d) => {
    try {
      accessSync(join(d, bin), constants.X_OK);
      return true;
    } catch {
      return false;
    }
  });
}

function knownPlatforms() {
  return Object.keys(PLATFORM_BY_ID);
}

/** User-controlled ids fail clean (exit 2 + known list), never a stack trace. */
function checkPlatforms(platforms) {
  const unknown = (platforms ?? []).filter((p) => !(p in PLATFORM_BY_ID));
  if (unknown.length > 0) {
    console.error(`helix: unknown platform ${unknown.map((p) => `"${p}"`).join(", ")}`);
    console.error(`known platforms: ${knownPlatforms().join(", ")}`);
    process.exitCode = 2;
    return false;
  }
  return true;
}

/** A destination turned unsafe mid-run (e.g. changed after preflight): stop, exit 1. Anything else is a real bug and rethrows. */
function abortUnsafe(error, wrote, dir) {
  if (!(error instanceof UnsafeDestinationError)) throw error;
  console.error(`helix init: refusing ${error.packPath}: ${error.reason}`);
  console.error(`helix init: aborted; ${wrote} file(s) had already been written to ${dir}`);
  process.exitCode = 1;
}

async function cmdInit(opts) {
  const dir = resolve(opts.dir);
  const files = walkFiles(dir);
  const stack = detectDir(dir, files);
  console.log(`stack: ${stack.language} · ${stack.packageManager}`);
  console.log(
    `test: ${stack.testCommand ?? "(none detected)"} · lint: ${stack.lintCommand ?? "(none)"}`,
  );
  let platforms;
  if (opts.platforms) {
    platforms = opts.platforms.flatMap((p) => (p === "all" ? DEFAULT_PLATFORMS : [p]));
    console.log(`platforms: ${platforms.join(", ")} (--platform)`);
  } else {
    const found = detectPlatforms(files.keys(), onPath);
    platforms = found.platforms;
    console.log(
      found.source === "none"
        ? "platforms: no agent config detected, writing the universal pack (AGENTS.md + .helix/); add agents with --platform claude-code,cursor,... or all"
        : `platforms: ${platforms.join(", ")} (detected from ${found.source === "repo" ? "agent config in this repo" : "agent CLIs on PATH"})`,
    );
  }
  const graphifyAvailable =
    spawnSync("graphify", ["--help"], { stdio: "ignore" }).error === undefined;
  if (!graphifyAvailable) {
    console.log(
      "graphify: not on PATH, using the built-in outline map (.helix/map.mjs). Install later: uv tool install graphifyy",
    );
  }
  const config = {
    ...configForStack(platforms, { ...stack, graphifyAvailable }),
    stack: {
      language: stack.language,
      packageManager: stack.packageManager,
      testCommand: stack.testCommand,
      lintCommand: stack.lintCommand,
      formatCommand: stack.formatCommand,
    },
  };
  if (!checkPlatforms(config.platforms)) return;
  // The universal pack is the default: subagents cost tokens on every task and no recorded run
  // has shown them paying for it (docs/DECISIONS.md, F7). Ask for them with --crew.
  if (!opts.crew) config.crew = [];
  if (opts.leanSubagents) {
    if (opts.crew) config.leanSubagents = true;
    else
      console.log("note: --lean-subagents has no effect without --crew (no subagents installed)");
  }
  if (
    opts.ci === true ||
    (opts.ci !== false && [...files.keys()].some((p) => p.startsWith(".github/")))
  ) {
    config.ci = "github";
  }
  // Graph-first is only true once an index exists: build it now (opt out with --no-index) or
  // fall back to the built-in outline, so a fresh pack never tells agents to query a graph
  // that is not there.
  if (config.graphFirst && readText(join(dir, "graphify-out/GRAPH_REPORT.md")) === null) {
    let indexed = false;
    if (opts.index) {
      console.log("graphify: no index yet, running `graphify update .` (skip with --no-index)");
      const r = spawnSync("graphify", ["update", "."], {
        cwd: dir,
        stdio: "ignore",
        timeout: 600_000,
      });
      indexed = r.status === 0 && readText(join(dir, "graphify-out/GRAPH_REPORT.md")) !== null;
    }
    if (!indexed) {
      config.mcps = config.mcps.filter((id) => id !== "graphify");
      config.graphFirst = false;
      console.log(
        "graphify: no usable index, using the built-in outline map. Run `graphify update .` then `helix init --force` to switch.",
      );
    }
  }
  if (opts.claudePlugin) {
    config.claudePlugin = true;
    if (!config.platforms.includes("claude-code")) {
      console.log(
        "note: --claude-plugin only changes the claude-code files; claude-code is not among the selected platforms",
      );
    }
  }
  console.log(
    `mcps: ${config.mcps.join(", ") || "(none)"} · graph-first: ${config.graphFirst ? "on" : "off"} (${stack.fileCount} files${stack.uiPresent ? ", UI detected" : ", no UI"})`,
  );
  let pack;
  try {
    pack = generatePack(config);
  } catch (error) {
    console.error(`helix init: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 2;
    return;
  }
  if (config.ci && !pack.some((f) => f.path === ".github/workflows/helix-gate.yml")) {
    console.log("ci: skipped (the workflow needs a Node stack with npm, pnpm or yarn)");
  }
  // Fail closed: a pack with any unsafe destination (bad path, or a symlink that
  // leaves the target) is rejected whole, before a single byte is written.
  const root = prepareTargetRoot(dir);
  const violations = preflightPack(
    root,
    pack.map((f) => f.path),
  );
  if (violations.length > 0) {
    for (const v of violations) console.error(`helix init: refusing ${v.packPath}: ${v.reason}`);
    console.error("helix init: unsafe destination in the target directory; nothing was written.");
    process.exitCode = 1;
    return;
  }
  let wrote = 0;
  let skipped = 0;
  for (const f of pack) {
    let existing;
    try {
      existing = readContained(root, f.path);
    } catch (error) {
      return abortUnsafe(error, wrote, dir);
    }
    let body = f.body;
    if (f.path === "opencode.json" && existing !== null) {
      try {
        const merged = mergeOpenCodeConfig(existing, f.body);
        body = merged.content;
        if (merged.preservedMcpServers.length > 0) {
          console.warn(
            "preserved existing OpenCode MCP definitions: " + merged.preservedMcpServers.join(", "),
          );
        }
      } catch (error) {
        console.warn(
          "skip opencode.json: could not safely merge existing config (" +
            (error instanceof Error ? error.message : String(error)) +
            ")",
        );
        skipped++;
        continue;
      }
    }
    if (existing !== null && !opts.force) {
      const diff = diffLines(existing, body);
      if (diff === "identical") {
        console.log(`keep  ${f.path} (identical)`);
        skipped++;
        continue;
      }
      console.log(`exists ${f.path}:\n${diff}`);
      if (!(await confirm(`overwrite ${f.path}?`))) {
        skipped++;
        continue;
      }
    }
    try {
      writeContained(root, f.path, body);
    } catch (error) {
      return abortUnsafe(error, wrote, dir);
    }
    console.log(`${existing === null ? "write " : "wrote "} ${f.path}`);
    wrote++;
  }
  console.log(`done: ${wrote} written, ${skipped} skipped in ${dir}`);
}

/** `helix plugin --out <dir>`: a Claude Code plugin marketplace from the same sources as init. */
function cmdPlugin(opts) {
  if (!opts.out) {
    console.error("helix plugin: --out <dir> is required (where to write the marketplace)");
    process.exitCode = 2;
    return;
  }
  const pack = pluginPack(defaultConfig(["claude-code"]));
  const root = prepareTargetRoot(opts.out);
  const violations = preflightPack(
    root,
    pack.map((f) => f.path),
  );
  if (violations.length > 0) {
    for (const v of violations) console.error(`helix plugin: refusing ${v.packPath}: ${v.reason}`);
    console.error("helix plugin: unsafe destination; nothing was written.");
    process.exitCode = 1;
    return;
  }
  let wrote = 0;
  for (const f of pack) {
    try {
      writeContained(root, f.path, f.body);
    } catch (error) {
      return abortUnsafe(error, wrote, opts.out);
    }
    console.log(`write  ${f.path}`);
    wrote++;
  }
  console.log(`done: ${wrote} files in ${root}`);
  console.log(
    `install: claude plugin marketplace add ${root} && claude plugin install helix@helix-harness`,
  );
  console.log("then, in each repo: helix init --claude-plugin  (AGENTS.md, gate, secret denies)");
}

function cmdDoctor(opts) {
  const dir = resolve(opts.dir);
  const files = walkFiles(dir);
  const failures = doctorPack(files);
  // Graph freshness only matters when the pack tells agents to use the graph;
  // a pack on the outline fallback must not fail for lacking Graphify.
  const usesGraph = /query_graph/.test(files.get("AGENTS.md") ?? "");
  if (usesGraph) {
    failures.push(
      ...graphFreshness(
        (p) => readText(join(dir, p)),
        () => {
          try {
            return execFileSync("git", ["rev-parse", "HEAD"], {
              cwd: dir,
              encoding: "utf8",
            }).trim();
          } catch {
            return null;
          }
        },
      ),
    );
  } else if (files.has(".helix/map.mjs")) {
    try {
      execFileSync("node", [join(dir, ".helix/map.mjs"), "--max", "200"], {
        cwd: dir,
        timeout: 30000,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (err) {
      failures.push({ check: "map:.helix/map.mjs", detail: `exits ${err?.status ?? "?"}` });
    }
  }
  // Live hook check: every shipped hook must run clean against empty + wide input.
  const hookSamples = [
    ["prefer-graph", JSON.stringify({ tool_name: "Glob", tool_input: { pattern: "src/**" } })],
    ["format-lint", JSON.stringify({ tool_name: "Edit", tool_input: { file_path: "nope.ts" } })],
    ["test-on-stop", JSON.stringify({ transcript_path: join(dir, "nope.jsonl"), cwd: dir })],
  ];
  for (const [name, stdin] of hookSamples) {
    const rel = `.helix/hooks/${name}.mjs`;
    if (!files.has(rel)) continue;
    try {
      execFileSync("node", [join(dir, rel)], {
        input: stdin,
        timeout: 30000,
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (err) {
      const code = err?.status ?? "?";
      if (code !== 0) {
        failures.push({ check: `hooks:${rel}`, detail: `exits ${code} on sample input` });
      }
    }
  }
  if (files.has(".helix/gate.mjs")) {
    try {
      execFileSync("node", [join(dir, ".helix/gate.mjs"), "--dry"], {
        cwd: dir,
        timeout: 30000,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (err) {
      failures.push({ check: "gate:.helix/gate.mjs", detail: `--dry exits ${err?.status ?? "?"}` });
    }
  }
  const cfg = reconstructConfig(files);
  console.log(`mcp servers: ${cfg.mcps.length}`);
  for (const line of mcpSummary(cfg)) console.log(`  ${line}`);
  if (failures.length === 0) {
    console.log("doctor: healthy");
  } else {
    for (const f of failures) console.log(`FAIL ${f.check}: ${f.detail}`);
    process.exitCode = 1;
  }
}

// Always runs the bundled gate (known-good source) with the target repo's
// .helix/gate.json pins; never executes a gate.mjs the repo supplied itself.
function cmdGate(opts) {
  const tmp = mkdtempSync(join(tmpdir(), "helix-gate-"));
  const file = join(tmp, "gate.mjs");
  try {
    writeFileSync(file, GATE_SOURCE);
    const r = spawnSync(process.execPath, [file, ...opts.gateArgs], {
      cwd: resolve(opts.dir),
      stdio: "inherit",
    });
    process.exitCode = r.status ?? 2;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

function cmdMeasure(opts) {
  const dir = resolve(opts.dir);
  const files = walkFiles(dir);
  const hasPack = files.has("AGENTS.md");
  const cfg = hasPack ? reconstructConfig(files) : defaultConfig([...DEFAULT_PLATFORMS]);
  if (!hasPack) console.log("(no pack in dir — measuring the default config)");
  console.log(measureReport(cfg));
}

/** Claude Code keeps transcripts under ~/.claude/projects/<path with non-alphanumerics as dashes> (observed, not vendor-verified). */
function claudeProjectDir(dir) {
  return join(homedir(), ".claude", "projects", resolve(dir).replace(/[^A-Za-z0-9]/g, "-"));
}

function parseReportArgs(args) {
  const o = { dir: ".", claude: null, opencode: null, limit: 5, json: false, bad: null };
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--json") o.json = true;
    else if (a === "--claude") o.claude = args[++i] ?? null;
    else if (a === "--opencode") o.opencode = args[++i] ?? null;
    else if (a === "--limit") o.limit = Number(args[++i]);
    else if (a.startsWith("-")) o.bad = a;
    else positional.push(a);
  }
  if (positional[0]) o.dir = positional[0];
  if (!Number.isInteger(o.limit) || o.limit < 1) o.bad = "--limit needs a positive integer";
  return o;
}

async function cmdReport(opts) {
  const o = parseReportArgs(opts.reportArgs);
  if (o.bad) {
    console.error(`helix report: bad option ${o.bad}`);
    process.exitCode = 2;
    return;
  }
  const sessions = [];
  const skipped = [];

  const claudePath = o.claude ? resolve(o.claude) : claudeProjectDir(o.dir);
  let jsonl = [];
  try {
    const st = statSync(claudePath);
    jsonl = st.isDirectory()
      ? readdirSync(claudePath)
          .filter((f) => f.endsWith(".jsonl"))
          .map((f) => join(claudePath, f))
      : [claudePath];
  } catch {
    if (o.claude) skipped.push(`claude-code: ${claudePath} not found`);
  }
  jsonl = jsonl
    .map((f) => ({ f, t: statSync(f).mtimeMs }))
    .sort((a, b) => b.t - a.t)
    .slice(0, o.limit)
    .map((x) => x.f);
  for (const f of jsonl) {
    const id = f
      .split("/")
      .pop()
      .replace(/\.jsonl$/, "");
    sessions.push(parseClaudeCodeJsonl(readFileSync(f, "utf8"), id));
  }

  const dbPath = o.opencode
    ? resolve(o.opencode)
    : join(homedir(), ".local", "share", "opencode", "opencode.db");
  let haveDb = true;
  try {
    accessSync(dbPath, constants.R_OK);
  } catch {
    haveDb = false;
    if (o.opencode) skipped.push(`opencode: ${dbPath} not found`);
  }
  if (haveDb) {
    const r = await loadOpenCodeDb(dbPath, { directory: resolve(o.dir), limit: o.limit });
    sessions.push(...r.sessions);
    if (r.skipped) skipped.push(r.skipped);
  }

  if (o.json) process.stdout.write(JSON.stringify({ sessions, skipped }, null, 2) + "\n");
  else process.stdout.write(formatReport(sessions, skipped) + "\n");
}

function cmdExport(opts) {
  if (!opts.platform) {
    console.error("helix export --platform <id>");
    process.exitCode = 2;
    return;
  }
  if (!checkPlatforms([opts.platform])) return;
  try {
    process.stdout.write(packJson(defaultConfig([opts.platform])));
  } catch (error) {
    console.error(`helix export: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 2;
  }
}

const CLI_PATH = fileURLToPath(import.meta.url);

async function cmdLink(opts) {
  if (process.platform === "win32") {
    console.error(
      "helix link: Windows is not supported yet. Use `node cli/helix.mjs`, or `npm link`.",
    );
    process.exitCode = 2;
    return;
  }
  const binDir = resolve(opts.binDir ?? join(homedir(), ".local", "bin"));
  const r = installShim({
    binDir,
    cliPath: CLI_PATH,
    nodePath: process.execPath,
    force: opts.force,
  });
  if (r.action === "refused") {
    console.error(
      `helix link: ${r.path} exists and is not a Helix shim; pass --force to replace it`,
    );
    process.exitCode = 1;
    return;
  }
  console.log(`${r.action === "wrote" ? "write" : "keep "} ${r.path}`);
  if (isOnPath(binDir, process.env.PATH)) {
    console.log("on PATH: run `helix --help` (or `helix ui` for the web view)");
    return;
  }
  const rc = rcFileFor(process.env.SHELL, homedir());
  const line = `export PATH="${binDir}:$PATH"`;
  let modify = opts.modifyRc;
  if (modify === null) {
    modify = rc !== null && (await confirm(`${binDir} is not on your PATH. Add it to ${rc}?`));
  }
  if (modify && rc) {
    const a = addRcBlock(rc, binDir);
    console.log(`${a === "added" ? "write" : "keep "} ${rc} (PATH line)`);
    console.log(`open a new terminal, or run: source ${rc}`);
  } else {
    console.log(`${binDir} is not on your PATH. Add this line to your shell profile:\n  ${line}`);
    if (rc === null) console.log("(fish: fish_add_path " + binDir + ")");
  }
}

function cmdUnlink(opts) {
  const binDir = resolve(opts.binDir ?? join(homedir(), ".local", "bin"));
  const r = removeShim({ binDir });
  if (r.action === "refused") {
    console.error(`helix unlink: ${r.path} is not a Helix shim; left alone`);
    process.exitCode = 1;
  } else console.log(`${r.action === "removed" ? "remove" : "absent"} ${r.path}`);
  const rc = rcFileFor(process.env.SHELL, homedir());
  if (rc && removeRcBlock(rc) === "removed") console.log(`remove PATH line from ${rc}`);
}

async function cmdUi(opts) {
  const requested = opts.port;
  if (
    requested !== null &&
    !(Number.isInteger(requested) && requested >= 0 && requested <= 65535)
  ) {
    console.error("helix ui: --port must be an integer from 0 to 65535");
    process.exitCode = 2;
    return;
  }
  const dir = resolve(opts.dir);
  const ui = await startUi({
    dir,
    port: requested ?? 4317,
    cliPath: CLI_PATH,
    fallbackToRandomPort: requested === null,
  });
  console.log(`helix ui for ${dir}\n  ${ui.url}\nlocal only (127.0.0.1); press Ctrl-C to stop`);
  if (opts.open) {
    const opener = process.platform === "darwin" ? "open" : "xdg-open";
    spawn(opener, [ui.url], { stdio: "ignore", detached: true })
      .on("error", () => console.log(`could not run ${opener}; open the URL above`))
      .unref();
  }
  const stop = () => void ui.close().then(() => process.exit(0));
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}

async function cmdBench(opts) {
  const { RepeatableBenchmarkSuite } = await import("../src/engine/benchmark.ts");
  const suite = new RepeatableBenchmarkSuite();

  let json = false;
  let outPath = null;
  let runs = 1;
  const strategies = [];
  const categories = [];

  const args = opts.benchArgs || [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--json") json = true;
    else if (a === "--help" || a === "-h") {
      process.stdout.write(
        "Usage: helix bench [--strategy s1,s2] [--category c1,c2] [--runs n] [--json] [--out <path>]\n",
      );
      return;
    } else if (a === "--out") outPath = args[++i];
    else if (a.startsWith("--out=")) outPath = a.slice("--out=".length);
    else if (a === "--runs") runs = Number(args[++i]) || 1;
    else if (a.startsWith("--runs=")) runs = Number(a.slice("--runs=".length)) || 1;
    else if (a === "--strategy") strategies.push(...(args[++i] || "").split(","));
    else if (a.startsWith("--strategy="))
      strategies.push(...a.slice("--strategy=".length).split(","));
    else if (a === "--category") categories.push(...(args[++i] || "").split(","));
    else if (a.startsWith("--category="))
      categories.push(...a.slice("--category=".length).split(","));
  }

  const report = await suite.runSuite({
    strategies: strategies.length > 0 ? strategies : undefined,
    categories: categories.length > 0 ? categories : undefined,
    runsPerTask: runs,
  });

  if (outPath) {
    suite.saveReport(report, outPath);
  }

  if (json) {
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  } else {
    process.stdout.write(suite.formatMarkdownReport(report) + "\n");
  }
}

async function main() {
  const { cmd, opts } = parseArgs(process.argv.slice(2));
  if (opts.help || cmd === "--help" || cmd === "-h" || cmd === "help") process.stdout.write(USAGE);
  else if (cmd === "init") await cmdInit(opts);
  else if (cmd === "plugin") cmdPlugin(opts);
  else if (cmd === "doctor") cmdDoctor(opts);
  else if (cmd === "measure") cmdMeasure(opts);
  else if (cmd === "gate") cmdGate(opts);
  else if (cmd === "report") await cmdReport(opts);
  else if (cmd === "export") cmdExport(opts);
  else if (cmd === "learn") await cmdLearn(opts.learnArgs);
  else if (cmd === "run") await cmdRun(opts);
  else if (cmd === "link") await cmdLink(opts);
  else if (cmd === "unlink") cmdUnlink(opts);
  else if (cmd === "ui") await cmdUi(opts);
  else if (cmd === "bench") await cmdBench(opts);
  else if (cmd === "eval") {
    if (opts.evalArgs.includes("--benchmark") || opts.evalArgs.includes("-b")) {
      opts.benchArgs = opts.evalArgs.filter((a) => a !== "--benchmark" && a !== "-b");
      await cmdBench(opts);
    } else {
      const { runEval } = await import("../evals/run.mjs");
      await runEval(opts.evalArgs);
    }
  } else {
    process.stdout.write(USAGE);
    process.exitCode = cmd ? 2 : 0;
  }
}

await main();
