import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { canTransition, selectWorkflow, validateHandoff } from "./workflow.ts";

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
