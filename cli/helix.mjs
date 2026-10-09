#!/usr/bin/env -S node --experimental-strip-types
// helix — init, doctor, measure, export, eval for the Helix harness pack.
// Requires Node 22.6+ (type stripping). No dependencies beyond the repo.
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { GATE_SOURCE } from "../src/lib/harness/gate.ts";
import { generatePack } from "../src/lib/harness/generate.ts";
import { DEFAULT_PLATFORMS } from "../src/lib/harness/platforms.ts";
import {
  configForStack,
  defaultConfig,
  detectStack,
  diffLines,
  doctorPack,
  graphFreshness,
  mcpSummary,
  measureReport,
  packJson,
  reconstructConfig,
} from "./lib.ts";

const USAGE = `helix — AI coding harness pack manager

  helix init [dir] [--platform a,b] [--force]   detect the stack, write the pack
  helix doctor [dir]                            check the installed harness
  helix measure [dir]                           print the real token breakdown
  helix gate [dir] [--all] [--dry] [--json]     secrets, lint, typecheck, affected tests
                                                (exit 0 pass · 1 check failed · 2 usage)
  helix export --platform <id>                  print the pack as JSON (scripted use)
  helix eval [options]                          run the eval harness (see evals/README.md)
`;

function parseArgs(argv) {
  const [cmd, ...rest] = argv;
  const opts = { dir: ".", platforms: null, force: false, platform: null, evalArgs: [], gateArgs: [] };
  const positional = [];
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (cmd === "gate" && a.startsWith("--")) opts.gateArgs.push(a);
    else if (a === "--force") opts.force = true;
    else if (a === "--platform" && cmd === "export") opts.platform = rest[++i];
    else if (a.startsWith("--platform=")) opts.platforms = a.slice("--platform=".length).split(",");
    else if (a === "--platform") opts.platforms = (rest[++i] ?? "").split(",");
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

function detectDir(dir) {
  const files = walkFiles(dir);
  const names = new Set(files.keys());
  const pkgRaw = files.get("package.json");
  return detectStack({
    names,
    packageJson: pkgRaw ? JSON.parse(pkgRaw) : null,
    makefile: files.get("Makefile") ?? files.get("makefile") ?? null,
    justfile: files.get("justfile") ?? files.get("Justfile") ?? null,
  });
}

async function confirm(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(`${question} [y/N] `, (answer) => {
      rl.close();
      resolve(/^y(es)?$/i.test(answer.trim()));
    });
  });
}

async function cmdInit(opts) {
  const dir = resolve(opts.dir);
  const stack = detectDir(dir);
  console.log(`stack: ${stack.language} · ${stack.packageManager}`);
  console.log(`test: ${stack.testCommand ?? "(none detected)"} · lint: ${stack.lintCommand ?? "(none)"}`);
  const platforms = opts.platforms ?? [...DEFAULT_PLATFORMS];
  const config = {
    ...configForStack(platforms, stack),
    stack: {
      language: stack.language,
      packageManager: stack.packageManager,
      testCommand: stack.testCommand,
      lintCommand: stack.lintCommand,
      formatCommand: stack.formatCommand,
    },
  };
  console.log(
    `mcps: ${config.mcps.join(", ") || "(none)"} · graph-first: ${config.graphFirst ? "on" : "off"} (${stack.fileCount} files${stack.uiPresent ? ", UI detected" : ", no UI"})`,
  );
  const pack = generatePack(config);
  let wrote = 0;
  let skipped = 0;
  for (const f of pack) {
    const full = join(dir, f.path);
    const existing = readText(full);
    if (existing !== null && !opts.force) {
      const diff = diffLines(existing, f.body);
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
    const parts = f.path.split("/");
    parts.pop();
    mkdirSync(parts.length > 0 ? join(dir, ...parts) : dir, { recursive: true });
    writeFileSync(full, f.body);
    console.log(`${existing === null ? "write " : "wrote "} ${f.path}`);
    wrote++;
  }
  console.log(`done: ${wrote} written, ${skipped} skipped in ${dir}`);
}

function cmdDoctor(opts) {
  const dir = resolve(opts.dir);
  const files = walkFiles(dir);
  const failures = doctorPack(files);
  failures.push(...graphFreshness(
    (p) => readText(join(dir, p)),
    () => {
      try {
        return execFileSync("git", ["rev-parse", "HEAD"], { cwd: dir, encoding: "utf8" }).trim();
      } catch {
        return null;
      }
    },
  ));
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
      execFileSync("node", [join(dir, rel)], { input: stdin, timeout: 30000, stdio: ["pipe", "pipe", "pipe"] });
    } catch (err) {
      const code = err?.status ?? "?";
      if (code !== 0) {
        failures.push({ check: `hooks:${rel}`, detail: `exits ${code} on sample input` });
      }
    }
  }
  if (files.has(".helix/gate.mjs")) {
    try {
      execFileSync("node", [join(dir, ".helix/gate.mjs"), "--dry"], { cwd: dir, timeout: 30000, stdio: ["ignore", "pipe", "pipe"] });
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

function cmdExport(opts) {
  if (!opts.platform) {
    console.error("helix export --platform <id>");
    process.exitCode = 2;
    return;
  }
  process.stdout.write(packJson(defaultConfig([opts.platform])));
}

async function main() {
  const { cmd, opts } = parseArgs(process.argv.slice(2));
  if (cmd === "init") await cmdInit(opts);
  else if (cmd === "doctor") cmdDoctor(opts);
  else if (cmd === "measure") cmdMeasure(opts);
  else if (cmd === "gate") cmdGate(opts);
  else if (cmd === "export") cmdExport(opts);
  else if (cmd === "eval") {
    const { runEval } = await import("../evals/run.mjs");
    await runEval(opts.evalArgs);
  } else {
    process.stdout.write(USAGE);
    process.exitCode = cmd ? 2 : 0;
  }
}

await main();
