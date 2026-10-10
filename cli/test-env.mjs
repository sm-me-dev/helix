// Shared test helper: a PATH directory holding only `node`.
import { mkdtempSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let bin;

/** Temp dir containing only a `node` symlink; use as (the start of) a hermetic PATH. */
export function nodeOnlyBin() {
  if (!bin) {
    bin = mkdtempSync(join(tmpdir(), "helix-nodebin-"));
    symlinkSync(process.execPath, join(bin, "node"));
  }
  return bin;
}
