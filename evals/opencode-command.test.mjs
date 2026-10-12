// The opencode CLI removed `--dir` in v2: a stale flag fails every eval cell in
// <1s with `Unrecognized flag: --dir` (0.2s wall, 0 tokens, pass=false).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { opencodeCommand } from "./run.mjs";

describe("opencode invocation", () => {
  it("passes no --dir flag (v2 takes the working directory from the process cwd)", () => {
    const cmd = opencodeCommand("opencode/muse-spark-1.3-contributor-free", "do the thing");
    assert.doesNotMatch(cmd, /(^|\s)--dir([\s=]|$)/, "stale --dir flag fails every cell");
    assert.match(cmd, /--format json/);
    assert.match(cmd, /--auto/);
    assert.match(
      cmd,
      /(^|\s)--standalone([\s]|$)/,
      "without --standalone the run shares the user's background service port and dies",
    );
    assert.match(cmd, /do the thing/);
  });
});
