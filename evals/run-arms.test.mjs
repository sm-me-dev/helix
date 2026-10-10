// F6 three-arm eval: the helix-nosub arm ships everything the helix arm ships
// except model-subagent definitions, so a with/without-subagents comparison is real.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { packFilesForArm } from "./run.mjs";

const AGENT_DEF = /(^|\/)agents\//;

describe("eval arms", () => {
  for (const agent of ["opencode", "claude-code", "codex"]) {
    it(`${agent}: helix-nosub matches helix except agent definition files`, () => {
      const full = packFilesForArm(agent, "helix").map((f) => f.path);
      const nosub = packFilesForArm(agent, "helix-nosub").map((f) => f.path);
      assert.ok(
        full.some((p) => AGENT_DEF.test(p)),
        `${agent} helix arm must define subagents`,
      );
      assert.ok(
        !nosub.some((p) => AGENT_DEF.test(p)),
        `${agent} nosub arm must not define subagents`,
      );
      assert.deepEqual(nosub, full.filter((p) => !AGENT_DEF.test(p)));
      assert.ok(nosub.includes("AGENTS.md"), "nosub keeps the repo instruction file");
      assert.ok(
        nosub.some((p) => p.endsWith("gate.mjs")),
        "nosub keeps the deterministic gate",
      );
    });
  }
});
