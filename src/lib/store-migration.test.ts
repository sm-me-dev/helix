import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { migratePersisted } from "./store.ts";

describe("migratePersisted (store v1 -> v2 tiered crew)", () => {
  it("renames auditor to reviewer and drops conductor and prover", () => {
    const out = migratePersisted(
      { crew: ["conductor", "scout", "architect", "builder", "prover", "auditor"] },
      1,
    );
    assert.deepEqual(out.crew, ["scout", "architect", "builder", "reviewer"]);
  });

  it("drops unknown ids so requireKnownIds never crashes on old storage", () => {
    const out = migratePersisted({ crew: ["scout", "nope", "auditor"] }, 1);
    assert.deepEqual(out.crew, ["scout", "reviewer"]);
  });

  it("leaves a current-version state untouched", () => {
    const out = migratePersisted({ crew: ["scout", "reviewer"], graphFirst: false }, 2);
    assert.deepEqual(out.crew, ["scout", "reviewer"]);
    assert.equal(out.graphFirst, false);
  });
});
