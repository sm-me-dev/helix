import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { adaptSimEvents, SIM_DURATION, SIM_EVENTS, SAMPLE_ISSUE } from "./simulation.ts";
import { DEFAULT_CREW } from "./crew.ts";
import { DEFAULT_LSPS } from "./lsps.ts";
import { DEFAULT_MCPS } from "./mcps.ts";
import { DEFAULT_PLATFORMS } from "./platforms.ts";
import { DEFAULT_SKILLS } from "./skills.ts";
import type { CrewId, HarnessConfig } from "./types.ts";

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

const FULL: HarnessConfig = {
  crew: ["conductor", "scout", "architect", "builder", "prover", "auditor"],
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
    assert.equal(adapted.summaries, 6);
  });

  it("drops the auditor pass and restates the merge when auditor is off", () => {
    const adapted = adaptSimEvents({
      ...FULL,
      crew: ["conductor", "scout", "architect", "builder", "prover"],
    });
    assert.ok(!adapted.events.some((e) => e.role === "auditor"));
    assert.deepEqual(adapted.dropped, ["auditor"]);
    assert.ok(adapted.events[adapted.events.length - 1].body.includes("Five summaries"));
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

  it("never empties the timeline, even for conductor-only", () => {
    const adapted = adaptSimEvents({ ...FULL, crew: ["conductor"] });
    assert.ok(adapted.events.length >= 2);
    assert.equal(adapted.events[0].role, "conductor");
  });
});
