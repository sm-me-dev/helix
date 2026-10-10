import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { GATE_SOURCE } from "./gate.ts";
import { generatePack } from "./generate.ts";

// Secrets are assembled at runtime so this file never trips the scanner itself.
const FAKE_AWS = "AK" + "IA" + "ABCDEFGHIJKLMNOP";

function gateFile(): string {
  const dir = mkdtempSync(join(tmpdir(), "helix-gate-src-"));
  const file = join(dir, "gate.mjs");
  writeFileSync(file, GATE_SOURCE);
  return file;
}
const GATE = gateFile();

function repo(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "helix-gate-repo-"));
  const sh = (...a: string[]) => spawnSync("git", a, { cwd: dir, encoding: "utf8" });
  sh("init", "-q");
  sh("config", "user.email", "t@example.com");
  sh("config", "user.name", "t");
  for (const [p, body] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, p)), { recursive: true });
    writeFileSync(join(dir, p), body);
  }
  sh("add", "-A");
  sh("commit", "-qm", "base");
  return dir;
}

function gate(dir: string, ...args: string[]) {
  const r = spawnSync(process.execPath, [GATE, ...args], { cwd: dir, encoding: "utf8" });
  return { code: r.status, out: String(r.stdout), err: String(r.stderr) };
}

const pkg = (scripts: Record<string, string>) => JSON.stringify({ name: "t", scripts });
const OK = 'node -e "process.exit(0)"';

describe("helix gate", () => {
  it("exits 0 and says so when nothing changed", () => {
    const dir = repo({ "package.json": pkg({ test: OK }) });
    const r = gate(dir);
    assert.equal(r.code, 0);
    assert.match(r.out, /nothing changed/);
  });

  it("passes: one line per step, no output dumps", () => {
    const dir = repo({ "package.json": pkg({ test: OK, lint: OK, typecheck: OK }), "a.js": "1" });
    writeFileSync(join(dir, "a.js"), "2");
    const r = gate(dir);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /PASS secrets/);
    assert.match(r.out, /PASS lint/);
    assert.match(r.out, /PASS typecheck/);
    assert.match(r.out, /PASS test/);
    assert.match(r.out, /gate: PASS/);
    assert.ok(r.out.split("\n").length < 10);
  });

  it("fails with exit 1, shows only the failing step's capped tail", () => {
    const noisy = `node -e "for(let i=0;i<500;i++)console.log('line '+i);process.exitCode=3"`;
    const dir = repo({ "package.json": pkg({ test: OK, lint: noisy }), "a.js": "1" });
    writeFileSync(join(dir, "a.js"), "2");
    const r = gate(dir);
    assert.equal(r.code, 1);
    assert.match(r.out, /FAIL lint \(exit 3/);
    assert.match(r.out, /PASS test/);
    assert.match(r.out, /line 499/);
    assert.ok(!r.out.includes("line 400"), "tail must be capped");
    assert.ok(r.out.length < 3500, `output too large: ${r.out.length}`);
    assert.match(r.out, /gate: FAIL \(1 of 4\)/);
  });

  it("flags secrets by file:line and pattern, never echoing the value", () => {
    const dir = repo({ "package.json": pkg({ test: OK }), "a.js": "x" });
    writeFileSync(join(dir, "a.js"), `const k = "${FAKE_AWS}";\n`);
    const r = gate(dir);
    assert.equal(r.code, 1);
    assert.match(r.out, /FAIL secrets/);
    assert.match(r.out, /a\.js:1 aws-access-key/);
    assert.ok(!r.out.includes(FAKE_AWS));
  });

  it("flags a changed .env but not .env.example", () => {
    const dir = repo({ "package.json": pkg({ test: OK }), "a.js": "x" });
    writeFileSync(join(dir, ".env.example"), "KEY=\n");
    let r = gate(dir);
    assert.equal(r.code, 0, r.out);
    writeFileSync(join(dir, ".env"), "KEY=1\n");
    r = gate(dir);
    assert.equal(r.code, 1);
    assert.match(r.out, /\.env env-file/);
  });

  it("skips placeholder values and lockfiles", () => {
    const dir = repo({ "package.json": pkg({ test: OK }), "a.js": "x" });
    writeFileSync(join(dir, "a.js"), 'const apiKey = "your-api-key-goes-here-123456";\n');
    writeFileSync(join(dir, "yarn.lock"), `${FAKE_AWS}\n`);
    const r = gate(dir);
    assert.equal(r.code, 0, r.out);
  });

  it("counts untracked files, including paths with spaces", () => {
    const dir = repo({ "package.json": pkg({ test: OK }) });
    writeFileSync(join(dir, "my file.js"), `const k = "${FAKE_AWS}";\n`);
    const r = gate(dir);
    assert.equal(r.code, 1);
    assert.match(r.out, /my file\.js:1 aws-access-key/);
  });

  it("--dry prints the plan and runs nothing", () => {
    const boom = 'node -e "process.exit(9)"';
    const dir = repo({ "package.json": pkg({ test: boom, lint: boom }) });
    const r = gate(dir, "--dry");
    assert.equal(r.code, 0);
    assert.match(r.out, /plan lint: npm run lint/);
    assert.match(r.out, /plan test: npm test/);
    assert.match(r.out, /plan typecheck: skip/);
  });

  it("--json is machine-readable and --all ignores git status", () => {
    const dir = repo({ "package.json": pkg({ test: OK }), "a.js": "1" });
    const r = gate(dir, "--all", "--json");
    assert.equal(r.code, 0, r.out);
    const j = JSON.parse(r.out);
    assert.equal(j.ok, true);
    assert.ok(j.steps.some((s: { name: string }) => s.name === "test"));
    for (const s of j.steps as { name: string; status: string; command: string | null }[]) {
      assert.ok(["pass", "fail", "skip"].includes(s.status), s.name);
      if (s.status !== "skip")
        assert.ok(typeof s.command === "string" && s.command.length > 0, s.name);
    }
  });

  it("uses .helix/gate.json pins over detection", () => {
    const dir = repo({
      "package.json": pkg({ test: 'node -e "process.exit(9)"' }),
      ".helix/gate.json": JSON.stringify({ test: OK }),
      "a.js": "1",
    });
    writeFileSync(join(dir, "a.js"), "2");
    const r = gate(dir);
    assert.equal(r.code, 0, r.out);
  });

  it("uses a verified related-test mode for vitest/jest, full suite otherwise", () => {
    const vit = repo({
      "package.json": JSON.stringify({ scripts: { test: OK }, devDependencies: { vitest: "1" } }),
      "a.ts": "1",
    });
    writeFileSync(join(vit, "a.ts"), "2");
    assert.match(gate(vit, "--dry").out, /vitest related a\.ts --run --passWithNoTests/);
    const jst = repo({
      "package.json": JSON.stringify({ scripts: { test: OK }, devDependencies: { jest: "1" } }),
      "a.ts": "1",
    });
    writeFileSync(join(jst, "a.ts"), "2");
    assert.match(gate(jst, "--dry").out, /jest --passWithNoTests --findRelatedTests a\.ts/);
    const plain = repo({ "package.json": pkg({ test: OK }), "a.ts": "1" });
    writeFileSync(join(plain, "a.ts"), "2");
    assert.match(gate(plain, "--dry").out, /full suite/);
  });

  it("rejects unknown options with exit 2", () => {
    const dir = repo({ "package.json": pkg({ test: OK }) });
    const r = gate(dir, "--nope");
    assert.equal(r.code, 2);
    assert.match(r.err, /unknown option/);
  });

  it("is dependency-free and ships in every pack, pinned by gate.json when stack is known", () => {
    assert.ok(!GATE_SOURCE.includes("require("));
    assert.equal(GATE_SOURCE.match(/from ["'](?!node:)[^"']*["']/), null);
    const base = {
      crew: [],
      skills: [],
      mcps: [],
      platforms: ["claude-code"],
      graphFirst: false,
      progressiveDisclosure: true,
      defaultSingleAgent: true,
      hooksEnabled: true,
    } as const;
    const plain = generatePack({
      ...base,
      crew: [],
      skills: [],
      mcps: [],
      platforms: ["claude-code"],
    });
    assert.ok(plain.some((f) => f.path === ".helix/gate.mjs"));
    assert.ok(!plain.some((f) => f.path === ".helix/gate.json"));
    const pinned = generatePack({
      ...base,
      crew: [],
      skills: [],
      mcps: [],
      platforms: ["claude-code"],
      stack: {
        language: "typescript",
        packageManager: "pnpm",
        testCommand: "pnpm run test",
        lintCommand: null,
        formatCommand: null,
      },
    });
    const pins = JSON.parse(pinned.find((f) => f.path === ".helix/gate.json")?.body ?? "{}");
    assert.deepEqual(pins, { packageManager: "pnpm", test: "pnpm run test" });
    const agents = plain.find((f) => f.path === "AGENTS.md")?.body ?? "";
    assert.match(agents, /node \.helix\/gate\.mjs/);
  });
});
