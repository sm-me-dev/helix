// Regression tests for the core user workflows (scenarios 1-5):
// install, safe repeat, diagnose, export parity, gate pass/fail.
// Spawn the real CLI in scratch dirs with closed stdin and a hermetic PATH,
// so platform detection and prompts can never depend on the host machine.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execSync, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { nodeOnlyBin } from "./test-env.mjs";
import { fileURLToPath } from "node:url";

const BIN = fileURLToPath(new URL("./helix.mjs", import.meta.url));

function scratch(pkg = { name: "s", scripts: { test: "node --test" } }) {
  const dir = mkdtempSync(join(tmpdir(), "helix-e2e-"));
  writeFileSync(join(dir, "package.json"), JSON.stringify(pkg));
  return dir;
}

function helix(dir, args, extraEnv = {}) {
  const env = { ...process.env, PATH: nodeOnlyBin(), ...extraEnv };
  return spawnSync(process.execPath, [BIN, ...args], {
    cwd: dir,
    input: "",
    encoding: "utf8",
    timeout: 30_000,
    env,
  });
}

function gitInit(dir) {
  try {
    execSync("git init -q && git config user.email t@t.t && git config user.name t", {
      cwd: dir,
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

// Gate shells out to npm/sh/git, so gate tests need a working system PATH.
// Agent-CLI isolation does not matter here: every gate test pins --platform.
const GATE_PATH = `${nodeOnlyBin()}:/usr/bin:/bin:/usr/local/bin`;

describe("helix core workflows", () => {
  it("scenario 1: init writes a valid pack (AGENTS.md + gate + map)", () => {
    const dir = scratch();
    const r = helix(dir, ["init", "--platform", "claude-code"]);
    assert.equal(r.status, 0, r.stderr);
    for (const f of ["AGENTS.md", ".helix/gate.mjs", ".helix/gate.json", ".helix/map.mjs"]) {
      assert.ok(existsSync(join(dir, f)), `missing ${f}`);
    }
    const agents = readFileSync(join(dir, "AGENTS.md"), "utf8");
    assert.match(agents, /^# Helix/);
    assert.ok(agents.split("\n").length < 60, "AGENTS.md exceeds the 60-line budget");
  });

  it("scenario 2: repeat init keeps modified files without --force", () => {
    const dir = scratch();
    assert.equal(helix(dir, ["init", "--platform", "claude-code"]).status, 0);
    writeFileSync(join(dir, "AGENTS.md"), "# mine\n");
    const r = helix(dir, ["init", "--platform", "claude-code"]);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(readFileSync(join(dir, "AGENTS.md"), "utf8"), "# mine\n");
    assert.match(r.stdout, /skipped/);
  });

  it("scenario 3: doctor passes on a valid pack, fails without one", () => {
    const good = scratch();
    helix(good, ["init", "--platform", "claude-code"]);
    const ok = helix(good, ["doctor"]);
    assert.equal(ok.status, 0, ok.stdout);
    assert.match(ok.stdout, /healthy/);

    const empty = scratch();
    const bad = helix(empty, ["doctor"]);
    assert.equal(bad.status, 1);
    assert.match(bad.stdout, /AGENTS\.md missing/);
  });

  it("scenario 3: doctor rejects an oversized AGENTS.md", () => {
    const dir = scratch();
    helix(dir, ["init", "--platform", "claude-code"]);
    writeFileSync(join(dir, "AGENTS.md"), Array(61).fill("line").join("\n") + "\n");
    const r = helix(dir, ["doctor"]);
    assert.equal(r.status, 1);
    assert.match(r.stdout, /agents-budget/);
  });

  it("scenario 4: export is deterministic and matches the installed pack", () => {
    const a = helix(scratch(), ["export", "--platform", "claude-code"]);
    const b = helix(scratch(), ["export", "--platform", "claude-code"]);
    assert.equal(a.status, 0, a.stderr);
    assert.equal(a.stdout, b.stdout, "same config must produce byte-identical output");
    const { files } = JSON.parse(a.stdout);
    assert.ok(Array.isArray(files) && files.length > 5);
    for (const f of files) {
      assert.equal(typeof f.path, "string");
      assert.equal(typeof f.body, "string");
    }
    const paths = files.map((f) => f.path);
    assert.ok(paths.includes("AGENTS.md"));
    assert.ok(paths.includes(".helix/gate.mjs"));
    assert.equal(new Set(paths).size, paths.length, "duplicate paths in export");

    // A repo whose detected facts select the full default config (large enough
    // for graph-first, UI present, graphify on PATH) must install platform and
    // config files byte-identical to export: CLI init, export, and the web
    // configurator all share generatePack, never separate approximations.
    // (AGENTS.md alone differs: init embeds the detected stack commands.)
    const dir = scratch();
    for (let i = 0; i < 25; i++)
      writeFileSync(join(dir, `mod${i}.ts`), `export const v${i} = ${i};\n`);
    writeFileSync(join(dir, "App.tsx"), "export default function App() { return null; }\n");
    const bin = mkdtempSync(join(tmpdir(), "helix-bin-"));
    // The fake builds the index like the real one, so init keeps graph-first (it now falls
    // back to the outline map when `graphify update .` produces no report).
    writeFileSync(
      join(bin, "graphify"),
      '#!/bin/sh\nif [ "$1" = "update" ]; then /bin/mkdir -p graphify-out; echo \'Built from commit: `abc`\' > graphify-out/GRAPH_REPORT.md; fi\nexit 0\n',
      { mode: 0o755 },
    );
    const r = helix(dir, ["init", "--platform", "claude-code"], {
      PATH: `${nodeOnlyBin()}:${bin}`,
    });
    assert.equal(r.status, 0, r.stderr);
    const exported = Object.fromEntries(files.map((f) => [f.path, f.body]));
    for (const p of [".mcp.json", ".claude/settings.json", "CLAUDE.md", ".helix/gate.mjs"]) {
      assert.equal(readFileSync(join(dir, p), "utf8"), exported[p], `${p} differs init vs export`);
    }
  });

  it("scenario 4: unknown platforms fail clean with exit 2, never a stack", () => {
    for (const args of [
      ["init", "--platform", "bogus-platform"],
      ["export", "--platform", "bogus"],
    ]) {
      const r = helix(scratch(), args);
      assert.equal(r.status, 2, JSON.stringify(args));
      const out = r.stdout + r.stderr;
      assert.match(out, /unknown platform "bogus/);
      assert.match(out, /known platforms:/);
      assert.doesNotMatch(out, /^\s+at\s/m, "stack trace leaked into user output");
    }
  });

  it("scenario 5: gate --dry plans and gate rejects a committed secret", () => {
    const dir = scratch();
    helix(dir, ["init", "--platform", "claude-code"]);
    const dry = helix(dir, ["gate", "--dry"]);
    assert.equal(dry.status, 0, dry.stderr);
    assert.match(dry.stdout, /plan secrets/);

    if (!gitInit(dir)) return; // no git in this environment; unit tests cover the scanner
    writeFileSync(
      join(dir, "creds.txt"),
      'api_key = "' + "sk-" + 'abcdefghij1234567890abcdefghij12"\n',
    );
    const fail = helix(dir, ["gate"], { PATH: GATE_PATH });
    assert.equal(fail.status, 1, fail.stdout);
    assert.match(fail.stdout, /FAIL secrets/);
    assert.match(fail.stdout, /sk-api-key/);
  });

  it("scenario 5: gate passes a clean tree and rejects bad flags with exit 2", () => {
    const dir = scratch();
    helix(dir, ["init", "--platform", "claude-code"]);
    if (!gitInit(dir)) return;
    const ok = helix(dir, ["gate"], { PATH: GATE_PATH });
    assert.equal(ok.status, 0, ok.stdout);
    assert.match(ok.stdout, /gate: PASS/);
    assert.equal(helix(dir, ["gate", "--bogus-flag"]).status, 2);
  });

  it("measure prints real token numbers and exits 0", () => {
    const dir = scratch();
    helix(dir, ["init", "--platform", "claude-code"]);
    const r = helix(dir, ["measure"]);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /always-on/);
    assert.match(r.stdout, /method: o200k_base/);
  });

  it("missing export platform exits 2 with usage", () => {
    const r = helix(scratch(), ["export"]);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /--platform/);
  });
});
