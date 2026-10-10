import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { CREW_BY_ID } from "./crew.ts";
import { generatePack } from "./generate.ts";
import { pickTier } from "./simulation.ts";
import {
  HANDOFF_MAX_LINES,
  SECURITY_POLICY,
  canTransition,
  dispatchRules,
  handoffLineCount,
  selectWorkflow,
  serializeHandoff,
  validateHandoff,
} from "./workflow.ts";
import type { Handoff } from "./workflow.ts";
import type { HarnessConfig } from "./types.ts";

describe("workflow selection", () => {
  it("keeps trivial work on the main session", () => {
    const sel = selectWorkflow({ fileCount: 1, crossesModules: false, isQuestion: false });
    assert.equal(sel.tier, "trivial");
    assert.deepEqual(sel.roles, []);
    assert.ok(sel.states.includes("completed"));
  });

  it("treats questions as trivial even with no files", () => {
    const sel = selectWorkflow({ fileCount: 0, crossesModules: false, isQuestion: true });
    assert.equal(sel.tier, "trivial");
  });

  it("picks build-plus-review for a known single module", () => {
    const sel = selectWorkflow({ fileCount: 4, crossesModules: false, isQuestion: false });
    assert.equal(sel.tier, "standard");
    assert.deepEqual(sel.roles, ["builder", "reviewer"]);
  });

  it("picks the full chain for cross-module work", () => {
    const sel = selectWorkflow({ fileCount: 9, crossesModules: true, isQuestion: false });
    assert.equal(sel.tier, "complex");
    assert.deepEqual(sel.roles, ["scout", "architect", "builder", "reviewer"]);
  });

  it("blocks ambiguous work before any files change", () => {
    const sel = selectWorkflow({
      fileCount: 5,
      crossesModules: true,
      isQuestion: false,
      ambiguous: true,
    });
    assert.deepEqual(sel.states, ["classified", "blocked"]);
    assert.deepEqual(sel.roles, []);
  });

  it("forces verification on security-sensitive work", () => {
    const sel = selectWorkflow({
      fileCount: 3,
      crossesModules: false,
      isQuestion: false,
      securitySensitive: true,
    });
    assert.ok(sel.roles.includes("reviewer"));
    assert.ok(sel.states.includes("verifying"));
  });
});

describe("workflow transitions", () => {
  it("allows legitimate skips and blocks nonsense", () => {
    assert.ok(canTransition("classified", "completed"));
    assert.ok(canTransition("classified", "implemented"));
    assert.ok(canTransition("implemented", "verifying"));
    assert.ok(canTransition("verifying", "completed"));
    assert.ok(!canTransition("completed", "implemented"));
    assert.ok(!canTransition("planned", "completed"));
  });

  it("lets verifying loop back to implemented on failure", () => {
    assert.ok(canTransition("verifying", "implemented"));
  });
});

describe("handoff contract", () => {
  it("accepts a compact cited card", () => {
    const problems = validateHandoff({
      goal: "Restore auth bypass",
      constraints: "No anonymous loosening",
      files: ["src/http/rate-limit.ts:1-120"],
      doneMeans: "New API-key test green",
      outOfScope: "Redis layout",
    });
    assert.deepEqual(problems, []);
  });

  it("rejects empty goals and missing files", () => {
    const problems = validateHandoff({
      goal: "",
      constraints: "",
      files: [],
      doneMeans: "",
      outOfScope: "",
    });
    assert.ok(problems.length >= 2);
  });
});

const change = (over: Partial<Parameters<typeof selectWorkflow>[0]> = {}) => ({
  fileCount: 1,
  crossesModules: false,
  isQuestion: false,
  ...over,
});

describe("security invariant: no bypass of independent verification", () => {
  const assertVerified = (sel: ReturnType<typeof selectWorkflow>) => {
    assert.notEqual(sel.tier, "trivial");
    assert.ok(sel.roles.includes("reviewer"), "reviewer required");
    assert.ok(
      sel.roles.indexOf("builder") < sel.roles.indexOf("reviewer"),
      "builder before reviewer",
    );
    assert.equal(sel.independentReview, true);
    const i = sel.states.indexOf("implemented");
    assert.ok(i >= 0 && sel.states.indexOf("verifying") > i, "verifying after implemented");
    assert.equal(sel.states.at(-1), "completed");
    // Reviewer role is defined as an isolated, fresh-window role.
    assert.equal(CREW_BY_ID.reviewer.isolated, true);
  };

  it("one-file authentication change", () => {
    const sel = selectWorkflow(change({ securitySensitive: true }));
    assertVerified(sel);
    assert.deepEqual(sel.roles, ["builder", "reviewer"]);
    assert.deepEqual(sel.states, SECURITY_POLICY.states);
  });

  it("one-file authorization/permissions change", () => {
    assertVerified(selectWorkflow(change({ fileCount: 1, securitySensitive: true })));
  });

  it("zero-file-count change still cannot be trivial when security-sensitive", () => {
    assertVerified(selectWorkflow(change({ fileCount: 0, securitySensitive: true })));
  });

  it("multi-file security change keeps the full chain", () => {
    const sel = selectWorkflow(
      change({ fileCount: 6, crossesModules: true, securitySensitive: true }),
    );
    assertVerified(sel);
    assert.deepEqual(sel.roles, ["scout", "architect", "builder", "reviewer"]);
  });

  it("trivial non-security task stays lightweight", () => {
    const sel = selectWorkflow(change());
    assert.equal(sel.tier, "trivial");
    assert.deepEqual(sel.roles, []);
    assert.equal(sel.independentReview, false);
    assert.deepEqual(sel.states, ["classified", "verifying", "completed"]);
  });

  it("security-related question stays an informational answer", () => {
    const sel = selectWorkflow({
      fileCount: 0,
      crossesModules: false,
      isQuestion: true,
      securitySensitive: true,
    });
    assert.equal(sel.tier, "trivial");
    assert.deepEqual(sel.roles, []);
    assert.equal(sel.independentReview, false);
    assert.match(sel.reason, /answer only/);
  });

  it("ambiguous security work blocks before any change", () => {
    const sel = selectWorkflow(change({ securitySensitive: true, ambiguous: true }));
    assert.deepEqual(sel.states, ["classified", "blocked"]);
    assert.equal(sel.independentReview, false);
  });
});

describe("missing or malformed task facts", () => {
  it("omitted securitySensitive means not flagged (caller owns the judgement)", () => {
    assert.equal(selectWorkflow(change()).tier, "trivial");
  });

  it("invalid fileCount blocks instead of guessing", () => {
    for (const fileCount of [NaN, -1, 1.5, undefined, "3", Infinity]) {
      const sel = selectWorkflow(change({ fileCount: fileCount as never }));
      assert.deepEqual(sel.states, ["classified", "blocked"], String(fileCount));
    }
  });

  it("missing facts object blocks", () => {
    assert.deepEqual(selectWorkflow(undefined as never).states, ["classified", "blocked"]);
  });

  it("missing crossesModules fails closed to the heavier tier", () => {
    const sel = selectWorkflow({ fileCount: 3, isQuestion: false } as never);
    assert.equal(sel.tier, "complex");
  });

  it("only a literal true counts as a question", () => {
    const sel = selectWorkflow(change({ isQuestion: "yes" as never, securitySensitive: true }));
    assert.equal(sel.tier, "standard");
  });
});

describe("policy drift: runtime decisions vs generated instructions", () => {
  const cfg = (crew: HarnessConfig["crew"]): HarnessConfig => ({
    crew,
    skills: ["graph-first"],
    mcps: ["graphify"],
    platforms: ["codex"],
    graphFirst: true,
    progressiveDisclosure: true,
    defaultSingleAgent: true,
    hooksEnabled: true,
  });
  const body = (c: HarnessConfig) =>
    generatePack(c).find((f) => f.path === "AGENTS.md")?.body ?? "";

  it("AGENTS.md embeds exactly the derived dispatch rules", () => {
    const b = body(cfg(["scout", "architect", "builder", "reviewer"]));
    for (const rule of dispatchRules()) assert.ok(b.includes(rule), rule);
  });

  it("each tier line names the roles selectWorkflow returns for that tier", () => {
    const facts = {
      trivial: change(),
      standard: change({ fileCount: 4 }),
      complex: change({ fileCount: 9, crossesModules: true }),
    } as const;
    const rules = dispatchRules();
    for (const tier of ["trivial", "standard", "complex"] as const) {
      const sel = selectWorkflow(facts[tier]);
      assert.equal(sel.tier, tier);
      const line = rules.find((r) => r.startsWith(`- ${tier} (`));
      assert.ok(line, tier);
      const named = line.split("): ")[1].replace(/\.$/, "");
      const expected = sel.roles.length
        ? sel.roles.map((r) => (r === "reviewer" ? "fresh-window reviewer" : r)).join(", ")
        : "main session only";
      assert.equal(named, expected);
    }
  });

  it("security rule and limits in the text match the runtime policy", () => {
    const sec = dispatchRules().find((r) => r.startsWith("- Security-sensitive"));
    assert.ok(sec?.includes(SECURITY_POLICY.scope));
    assert.ok(sec?.includes(`min ${SECURITY_POLICY.minTier}`));
    assert.equal(selectWorkflow(change({ securitySensitive: true })).tier, SECURITY_POLICY.minTier);
    assert.ok(dispatchRules().some((r) => r.includes(`${HANDOFF_MAX_LINES} lines max`)));
  });

  it("security rule survives a trimmed crew and the single-agent default", () => {
    const b = body(cfg(["builder"]));
    assert.match(b, /Security-sensitive/);
    assert.match(b, /not security-sensitive/);
  });

  it("generation is deterministic and the legacy tier thresholds agree", () => {
    const c = cfg(["scout", "builder", "reviewer"]);
    assert.equal(JSON.stringify(generatePack(c)), JSON.stringify(generatePack({ ...c })));
    for (const f of [
      { fileCount: 0, crossesModules: false, isQuestion: true },
      { fileCount: 1, crossesModules: false, isQuestion: false },
      { fileCount: 3, crossesModules: false, isQuestion: false },
      { fileCount: 3, crossesModules: true, isQuestion: false },
    ]) {
      assert.equal(pickTier(f), selectWorkflow(f).tier);
    }
  });
});

describe("handoff size limit covers the whole serialized card", () => {
  const card = (files: number, extra: Partial<Handoff> = {}): Handoff => ({
    goal: "g",
    constraints: "c",
    files: Array.from({ length: files }, (_, i) => `src/f${i}.ts:1-9`),
    doneMeans: "d",
    outOfScope: "o",
    ...extra,
  });

  it("boundary: 11, 12 valid; 13 rejected (files drive the count)", () => {
    assert.equal(handoffLineCount(card(7)), 11);
    assert.deepEqual(validateHandoff(card(7)), []);
    assert.equal(handoffLineCount(card(8)), 12);
    assert.deepEqual(validateHandoff(card(8)), []);
    assert.equal(handoffLineCount(card(9)), 13);
    const p = validateHandoff(card(9));
    assert.equal(p.length, 1);
    assert.match(p[0], /13 lines \(max 12\)/);
  });

  it("the old blind spot: short fields plus many files no longer pass", () => {
    assert.ok(validateHandoff(card(30)).some((x) => /lines \(max 12\)/.test(x)));
  });

  it("multi-line content counts, including blank lines", () => {
    assert.deepEqual(validateHandoff(card(1, { goal: "a\nb\nc\nd\ne\nf" })), []);
    assert.equal(handoffLineCount(card(1, { goal: "a\nb\nc\nd\ne\nf\ng\nh\ni" })), 13);
    assert.ok(validateHandoff(card(1, { goal: "a\nb\nc\nd\ne\nf\ng\nh\ni" })).length > 0);
    assert.equal(handoffLineCount(card(1, { goal: "a\n\n\n\nb" })), 9);
  });

  it("newline normalization: CRLF, CR and Unicode separators all count", () => {
    for (const sep of ["\r\n", "\r", "\u2028", "\u2029", "\u0085", "\v", "\f"]) {
      assert.equal(handoffLineCount(card(1, { goal: `a${sep}b${sep}c` })), 7, JSON.stringify(sep));
    }
    assert.equal(handoffLineCount(card(1, { goal: "\n\n a \n\n" })), 5);
  });

  it("Unicode normalization form does not change the count", () => {
    const nfc = "caf\u00e9",
      nfd = "cafe\u0301";
    assert.equal(
      handoffLineCount(card(1, { goal: nfc })),
      handoffLineCount(card(1, { goal: nfd })),
    );
  });

  it("empty and malformed values are reported, never thrown", () => {
    assert.ok(validateHandoff(card(1, { goal: "  \n " })).includes("goal is empty"));
    assert.ok(validateHandoff(card(1, { doneMeans: "" })).includes("doneMeans is empty"));
    assert.ok(validateHandoff(card(0)).some((x) => /files is empty/.test(x)));
    assert.ok(validateHandoff(card(1, { files: [""] })).includes("file entry is empty"));
    assert.ok(validateHandoff({ ...card(1), goal: 5 as never }).includes("goal must be a string"));
    assert.ok(validateHandoff({ ...card(1), files: "x" as never }).some((x) => /array/.test(x)));
    assert.ok(
      validateHandoff({ ...card(1), files: [7 as never] }).includes("file entry must be a string"),
    );
    assert.deepEqual(validateHandoff(null as never), ["handoff must be an object"]);
  });

  it("pasted file entries are rejected and counted", () => {
    const p = validateHandoff(card(1, { files: ["a.ts\nb.ts\nc.ts"] }));
    assert.ok(p.some((x) => /looks pasted/.test(x)));
    assert.ok(
      validateHandoff(card(1, { files: ["x".repeat(161)] })).some((x) => /looks pasted/.test(x)),
    );
  });

  it("serialization is the single counting source", () => {
    const h = card(2);
    assert.equal(serializeHandoff(h).split("\n").length, handoffLineCount(h));
    assert.match(serializeHandoff(h), /^goal: g\nconstraints: c\nfile: /);
  });
});
