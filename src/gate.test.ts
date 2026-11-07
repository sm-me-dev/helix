import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { GATE_SOURCE } from "./gate.ts";
import { generatePack } from "./generate.ts";
import { resolveOrthogonalAuditor } from "./engine/provider.ts";
import {
  buildFirewalledAuditPayload,
  parseAdversarialAuditVerdict,
  validateThenAudit,
} from "./engine/validator.ts";

// Secrets are assembled at runtime so this file never trips the scanner itself.
const FAKE_AWS = "AK" + "IA" + "ABCDEFGHIJKLMNOP";

function gateFile(): string {
  const dir = mkdtempSync(join(tmpdir(), "helix-gate-src-"));
  const file = join(dir, "gate.mjs");
  writeFileSync(file, GATE_SOURCE);
  return file;
}
const GATE = gateFile();

// Hermetic git: ignore the developer's global/system git config (commit signing, hooks,
// global excludes, default branch). Both fixture setup and the gate itself shell out to git.
// See hermetic.test.ts, which runs this file under a hostile global config.
const GIT_HOME = mkdtempSync(join(tmpdir(), "helix-gate-home-"));
const HERMETIC_ENV: NodeJS.ProcessEnv = {
  ...process.env,
  HOME: GIT_HOME,
  XDG_CONFIG_HOME: GIT_HOME,
  GIT_CONFIG_GLOBAL: join(GIT_HOME, "gitconfig"),
  GIT_CONFIG_NOSYSTEM: "1",
};

function repo(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "helix-gate-repo-"));
  const sh = (...a: string[]) =>
    spawnSync("git", a, { cwd: dir, encoding: "utf8", env: HERMETIC_ENV });
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
  const r = spawnSync(process.execPath, [GATE, ...args], {
    cwd: dir,
    encoding: "utf8",
    env: HERMETIC_ENV,
  });
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
    assert.match(r.out, /gate: FAIL \(1 of 5\)/);
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
    // Not "yarn.lock": that name makes the gate pick yarn, so the test would
    // fail on any machine without yarn. Any *.lock is skipped by the scanner.
    writeFileSync(join(dir, "deps.lock"), `${FAKE_AWS}\n`);
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

describe("Phase 3 adversarial verification", () => {
  it("routes Claude and Codex generators to distinct model families", () => {
    const claudeAuditor = resolveOrthogonalAuditor("claude");
    const codexAuditor = resolveOrthogonalAuditor({
      harness: "codex",
      modelId: "gpt-6.1-sol",
      baseUrl: "https://openai-compatible.example/v1",
      token: "not-used-by-routing",
    });
    assert.equal(claudeAuditor.harness, "codex");
    assert.equal(claudeAuditor.modelId, "gpt-6.1-sol");
    assert.equal(codexAuditor.harness, "claude");
    assert.equal(codexAuditor.modelId, "claude-fable-5-1");
    const customOpenAiModel = resolveOrthogonalAuditor({
      harness: "claude",
      modelId: "gpt-6.1-sol",
      baseUrl: "https://compat.example/v1",
    });
    assert.equal(customOpenAiModel.harness, "claude");
    assert.equal(customOpenAiModel.modelId, "claude-fable-5-1");
  });

  it("rejects any extra context on the auditor payload and forces blocking verdicts to REJECTED", () => {
    const payload = {
      taskSpec: "Fix the path check",
      gitDiff: "diff --git a/a.ts b/a.ts",
      domainInvariants: ["Writes stay in the worktree"],
      deterministicGateSummary: "PASS typecheck",
    };
    assert.deepEqual(Object.keys(buildFirewalledAuditPayload(payload)).sort(), [
      "deterministicGateSummary",
      "domainInvariants",
      "gitDiff",
      "taskSpec",
    ]);
    assert.throws(
      () =>
        buildFirewalledAuditPayload({
          ...payload,
          conversationMessages: [{ role: "assistant", content: "reasoning" }],
        }),
      /only taskSpec, gitDiff, domainInvariants, and deterministicGateSummary/,
    );
    const verdict = parseAdversarialAuditVerdict({
      status: "VERIFIED",
      reviewerHarness: "codex",
      reviewerModelId: "gpt-6.1-sol",
      findings: [
        {
          severity: "BLOCKING_FAULT",
          file: "a.ts",
          lineOrAstNode: "line 1",
          proof: "broken",
          requiredFix: "repair",
        },
      ],
    });
    assert.equal(verdict.status, "REJECTED");
  });

  it("never invokes Stage B when deterministic Stage A fails", async () => {
    let auditorCalls = 0;
    const failedStageA = {
      passed: false,
      durationMs: 3,
      checks: [
        {
          stage: "tests" as const,
          passed: false,
          command: "npm test",
          exitCode: 1,
          durationMs: 3,
          stdout: "test failure",
          stderr: "",
          failuresOnly: "test failure",
        },
      ],
      failingStage: "tests" as const,
    };
    const result = await validateThenAudit({
      worktreePath: "/unused",
      taskSpec: "Fix a failure",
      domainInvariants: [],
      generatorProvider: "claude",
      validator: {
        validate: async () => failedStageA,
        extractDiagnostics: () => "tests failed",
      },
      invokeAuditor: async () => {
        auditorCalls++;
        return { output: "{}" };
      },
    });
    assert.equal(result.status, "DETERMINISTIC_FAILED");
    assert.equal(result.deterministicFailureDigest, "tests failed");
    assert.equal(auditorCalls, 0);
  });

  it("runs scoped Tier 1 scripts during Stage A and checks changed path containment", () => {
    const dir = repo({
      "package.json": pkg({ test: OK }),
      ".helix/knowledge/domains/execution-engine/domain.md":
        "---\nsource_paths:\n  - src/engine.ts\n---\n# Execution\n",
      ".helix/knowledge/domains/execution-engine/scripts/verify.mjs": "process.exit(0);\n",
      "src/engine.ts": "export const value = 1;\n",
    });
    writeFileSync(join(dir, "src/engine.ts"), "export const value = 2;\n");
    const passing = gate(dir);
    assert.equal(passing.code, 0, passing.out);
    assert.match(passing.out, /PASS path-containment/);
    assert.match(passing.out, /PASS domain-script:execution-engine\/verify\.mjs/);

    const outside = join(tmpdir(), `helix-outside-${Date.now()}.ts`);
    writeFileSync(outside, "export const outside = true;\n");
    symlinkSync(outside, join(dir, "escape.ts"));
    const contained = gate(dir);
    assert.equal(contained.code, 1);
    assert.match(contained.out, /FAIL path-containment/);
  });
});
