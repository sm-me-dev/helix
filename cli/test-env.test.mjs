// A "hermetic PATH" must contain node and nothing else. dirname(process.execPath)
// is NOT hermetic: with nvm/volta/fnm, global npm installs (codex, claude, ...)
// live next to node, so platform detection saw agents the test never installed.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { nodeOnlyBin } from "./test-env.mjs";

describe("nodeOnlyBin", () => {
  it("contains exactly one entry: node", () => {
    assert.deepEqual(readdirSync(nodeOnlyBin()), ["node"]);
  });
  it("is stable within a process", () => {
    assert.equal(nodeOnlyBin(), nodeOnlyBin());
  });
});
