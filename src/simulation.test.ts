import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SIM_DURATION, SIM_EVENTS, SAMPLE_ISSUE } from "./simulation.ts";
import type { CrewId } from "./types.ts";

const ROLES: (CrewId | "system")[] = [
  "conductor",
  "scout",
  "architect",
  "builder",
  "prover",
  "auditor",
  "system",
];

describe("SIM_EVENTS consistency", () => {
  it("is ordered in time within the simulation window", () => {
    assert.ok(SIM_EVENTS.length > 0);
    for (const e of SIM_EVENTS) {
      assert.ok(e.t >= 0 && e.t <= SIM_DURATION, `event out of window: ${e.title}`);
    }
    const times = SIM_EVENTS.map((e) => e.t);
    assert.deepEqual(
      [...times].sort((a, b) => a - b),
      times,
    );
  });

  it("uses only known roles and starts/ends with the conductor", () => {
    for (const e of SIM_EVENTS) {
      assert.ok(ROLES.includes(e.role), `unknown role: ${e.role}`);
    }
    assert.equal(SIM_EVENTS[0].role, "conductor");
    assert.equal(SIM_EVENTS[SIM_EVENTS.length - 1].role, "conductor");
  });

  it("keeps token counters monotonic with naive at or above helix", () => {
    for (let i = 1; i < SIM_EVENTS.length; i++) {
      assert.ok(
        SIM_EVENTS[i].tokens >= SIM_EVENTS[i - 1].tokens,
        `helix tokens regress at: ${SIM_EVENTS[i].title}`,
      );
      assert.ok(
        SIM_EVENTS[i].naiveTokens >= SIM_EVENTS[i - 1].naiveTokens,
        `naive tokens regress at: ${SIM_EVENTS[i].title}`,
      );
    }
    for (const e of SIM_EVENTS) {
      assert.ok(e.naiveTokens >= e.tokens, `naive below helix at: ${e.title}`);
    }
  });

  it("ends with a merge event stating the savings ratio", () => {
    const last = SIM_EVENTS[SIM_EVENTS.length - 1];
    assert.equal(last.title, "Merge");
    assert.match(last.body, /× less/);
  });
});

describe("SAMPLE_ISSUE", () => {
  it("carries the fields the /run header renders", () => {
    assert.ok(SAMPLE_ISSUE.id);
    assert.ok(SAMPLE_ISSUE.title);
    assert.ok(SAMPLE_ISSUE.body);
    assert.ok(SAMPLE_ISSUE.repo);
  });
});
