import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { adaptSimEvents, pickTier, SIM_DURATION, SIM_EVENTS, SAMPLE_ISSUE } from "./simulation.ts";
import { DEFAULT_CREW } from "./crew.ts";
import { DEFAULT_LSPS } from "./lsps.ts";
import { DEFAULT_MCPS } from "./mcps.ts";
import { DEFAULT_PLATFORMS } from "./platforms.ts";
import { DEFAULT_SKILLS } from "./skills.ts";
import type { CrewId, HarnessConfig } from "./types.ts";

const ROLES: (CrewId | "system")[] = ["scout", "architect", "builder", "reviewer", "system"];

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

  it("uses only known roles and starts/ends with the main session", () => {
    for (const e of SIM_EVENTS) {
      assert.ok(ROLES.includes(e.role), `unknown role: ${e.role}`);
    }
    assert.equal(SIM_EVENTS[0].role, "system");
    assert.equal(SIM_EVENTS[SIM_EVENTS.length - 1].role, "system");
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

describe("pickTier", () => {
  it("sends questions and one-file asks to the main session", () => {
    assert.equal(pickTier({ fileCount: 5, crossesModules: true, isQuestion: true }), "trivial");
    assert.equal(pickTier({ fileCount: 1, crossesModules: false, isQuestion: false }), "trivial");
  });

  it("keeps known single-module work at standard", () => {
    assert.equal(pickTier({ fileCount: 3, crossesModules: false, isQuestion: false }), "standard");
  });

  it("reserves the full chain for unknown or cross-module work", () => {
    assert.equal(pickTier({ fileCount: 4, crossesModules: true, isQuestion: false }), "complex");
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

const FULL: HarnessConfig = {
  crew: ["scout", "architect", "builder", "reviewer"],
  skills: [],
  mcps: [],
  lsps: [],
  platforms: [],
  graphFirst: true,
  progressiveDisclosure: true,
  defaultSingleAgent: true,
  hooksEnabled: true,
};

describe("adaptSimEvents", () => {
  it("keeps every event with scale exactly 1 for the true default config", () => {
    const adapted = adaptSimEvents({
      crew: DEFAULT_CREW,
      skills: DEFAULT_SKILLS,
      mcps: DEFAULT_MCPS,
      lsps: DEFAULT_LSPS,
      platforms: DEFAULT_PLATFORMS,
      graphFirst: true,
      progressiveDisclosure: true,
      defaultSingleAgent: true,
      hooksEnabled: true,
    });
    assert.equal(adapted.events.length, SIM_EVENTS.length);
    assert.deepEqual(adapted.dropped, []);
    assert.equal(adapted.scale, 1);
    assert.equal(adapted.summaries, 4);
  });

  it("drops the reviewer pass and restates the merge when reviewer is off", () => {
    const adapted = adaptSimEvents({
      ...FULL,
      crew: ["scout", "architect", "builder"],
    });
    assert.ok(!adapted.events.some((e) => e.role === "reviewer"));
    assert.deepEqual(adapted.dropped, ["reviewer"]);
    assert.ok(adapted.events[adapted.events.length - 1].body.includes("Three summaries"));
  });

  it("scales helix tokens with the live always-on index", () => {
    const lean = adaptSimEvents(FULL);
    const bloated = adaptSimEvents({ ...FULL, progressiveDisclosure: false });
    assert.ok(bloated.scale > lean.scale);
    const lastLean = lean.events[lean.events.length - 1].tokens;
    const lastBloated = bloated.events[bloated.events.length - 1].tokens;
    assert.ok(lastBloated > lastLean);
    // Naive baseline never moves.
    assert.equal(
      lean.events[lean.events.length - 1].naiveTokens,
      bloated.events[bloated.events.length - 1].naiveTokens,
    );
  });

  it("never empties the timeline, even for an empty crew", () => {
    const adapted = adaptSimEvents({ ...FULL, crew: [] });
    assert.ok(adapted.events.length >= 2);
    assert.equal(adapted.events[0].role, "system");
  });
});
