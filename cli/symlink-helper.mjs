// Shared by the symlink regression tests. Not a test file itself (no .test.).
import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Probe once: can this OS/user create a directory symlink here? Returns null
 * when yes, otherwise the reason, which node:test prints as the skip message.
 * (Windows needs Developer Mode or elevation; some sandboxes forbid symlinks.)
 */
function probe() {
  const d = mkdtempSync(join(tmpdir(), "helix-symprobe-"));
  try {
    symlinkSync(d, join(d, "probe"), "dir");
    return null;
  } catch (e) {
    return `cannot create symlinks in this environment (${e?.code ?? e?.message})`;
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
}

// `false`, not null: node:test treats any non-false `skip` value as "skip".
export const SYMLINK_SKIP = probe() ?? false;

/** Directory symlink; "dir" type matters on Windows and is ignored elsewhere. */
export const linkDir = (target, path) => symlinkSync(target, path, "dir");
export const linkFile = (target, path) => symlinkSync(target, path, "file");
