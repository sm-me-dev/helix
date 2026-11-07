// Filesystem containment for `helix init`: every read, mkdir and write of a
// generated pack file must stay inside the target root, even when the target
// already contains symlinks. Syntax checks live in lib.ts (assertSafePackPath).
//
// Guarantee: no destination that resolves outside the root at check time is
// ever read, created or written, and an unsafe pack is rejected before the
// first byte is written.
// NOT guaranteed: protection against a local attacker who can modify the
// target tree *while helix runs* (symlink TOCTOU). Portable Node.js has no
// openat()/O_PATH, so the check and the open cannot be one atomic step. We
// narrow the window (write via the resolved real path, O_NOFOLLOW on the leaf
// where the OS has it, no truncation until the opened inode is re-verified)
// but do not close it. Hard links to outside files are also not detected.
import {
  closeSync,
  constants,
  fstatSync,
  fchmodSync,
  ftruncateSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  assertCanonicalKnowledgeWriteAllowed,
  type CanonicalPromotionGrant,
} from "../src/engine/security.ts";
import { assertSafePackPath, packPathSegments } from "./lib.ts";

export class UnsafeDestinationError extends Error {
  readonly packPath: string;
  readonly reason: string;
  constructor(packPath: string, reason: string) {
    super(`unsafe destination ${packPath}: ${reason}`);
    this.name = "UnsafeDestinationError";
    this.packPath = packPath;
    this.reason = reason;
  }
}

/** Acquire a cross-process exclusive lock. The lock records enough ownership
 * data to diagnose abandoned claims and is released only by its creator. */
export function acquireAtomicLock(lockPath: string): () => void {
  mkdirSync(dirname(lockPath), { recursive: true });
  const token = randomUUID();
  let fd: number;
  try {
    fd = openSync(lockPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
  } catch (error) {
    if (errCode(error) === "EEXIST") throw new Error(`Team lock is already held: ${lockPath}`);
    throw error;
  }
  try {
    writeFileSync(
      fd,
      JSON.stringify({ pid: process.pid, timestamp: new Date().toISOString(), token }),
    );
  } catch (error) {
    closeSync(fd);
    try {
      unlinkSync(lockPath);
    } catch {
      /* Preserve the original write error. */
    }
    throw error;
  }
  closeSync(fd);
  return () => {
    try {
      const lock = JSON.parse(readFileSync(lockPath, "utf8")) as { token?: unknown };
      if (lock.token === token) unlinkSync(lockPath);
    } catch (error) {
      if (errCode(error) !== "ENOENT") throw error;
    }
  };
}

// Undefined on Windows, where Node does not expose O_NOFOLLOW.
const O_NOFOLLOW: number = constants.O_NOFOLLOW ?? 0;

const errCode = (e: unknown): string | undefined => (e as NodeJS.ErrnoException)?.code;

/** Boundary-correct containment: `child` is `root` itself or strictly below it. */
export function isInside(root: string, child: string): boolean {
  const rel = relative(root, child);
  if (rel === "") return true;
  return rel !== ".." && !rel.startsWith(".." + sep) && !isAbsolute(rel);
}

/** Create the target root if needed and return its fully resolved real path. */
export function prepareTargetRoot(dir: string): string {
  const abs = resolve(dir);
  mkdirSync(abs, { recursive: true });
  return realpathSync(abs);
}

/**
 * Resolve `packPath` under `rootReal` (a realpath), checking every existing
 * component. Symlinks are allowed only when they resolve inside the root; a
 * dangling symlink is refused (writing would create its target elsewhere).
 * Returns an absolute path made of the real, already-resolved prefix plus any
 * not-yet-existing names. Creates nothing.
 */
export function resolveContained(rootReal: string, packPath: string): string {
  const problem = assertSafePackPath(packPath);
  if (problem) throw new UnsafeDestinationError(packPath, problem);
  const segments = packPathSegments(packPath);
  let current = rootReal;
  for (let i = 0; i < segments.length; i++) {
    const next = join(current, segments[i]);
    const shown = segments.slice(0, i + 1).join("/");
    let st;
    try {
      st = lstatSync(next);
    } catch (e) {
      if (errCode(e) === "ENOENT") return join(next, ...segments.slice(i + 1));
      throw e;
    }
    if (st.isSymbolicLink()) {
      let real: string;
      try {
        real = realpathSync(next);
      } catch {
        throw new UnsafeDestinationError(packPath, `dangling or unresolvable symlink at ${shown}`);
      }
      if (!isInside(rootReal, real)) {
        throw new UnsafeDestinationError(
          packPath,
          `symlink at ${shown} resolves outside the target directory`,
        );
      }
      current = real;
      st = statSync(real);
    } else {
      current = next;
    }
    if (i < segments.length - 1 && !st.isDirectory()) {
      throw new UnsafeDestinationError(packPath, `${shown} exists and is not a directory`);
    }
  }
  return current;
}

/** Validate every destination up front; returns all violations (empty = safe). */
export function preflightPack(rootReal: string, packPaths: string[]): UnsafeDestinationError[] {
  const out: UnsafeDestinationError[] = [];
  for (const p of packPaths) {
    try {
      resolveContained(rootReal, p);
    } catch (e) {
      if (e instanceof UnsafeDestinationError) out.push(e);
      else throw e;
    }
  }
  return out;
}

/** Create missing directories one level at a time, refusing symlinks and escapes. */
function ensureDirs(rootReal: string, dirPath: string, packPath: string): void {
  const rel = relative(rootReal, dirPath);
  if (rel === "") return;
  let cur = rootReal;
  for (const name of rel.split(sep)) {
    cur = join(cur, name);
    try {
      mkdirSync(cur);
    } catch (e) {
      if (errCode(e) !== "EEXIST") throw e;
    }
    const st = lstatSync(cur);
    if (st.isSymbolicLink() || !st.isDirectory()) {
      throw new UnsafeDestinationError(packPath, `${cur} is not a plain directory`);
    }
  }
}

/** After opening, confirm the parent still resolves inside the root and the fd is the file at `full`. */
function verifyOpened(rootReal: string, full: string, fd: number, packPath: string): void {
  let parentReal: string;
  try {
    parentReal = realpathSync(dirname(full));
  } catch {
    throw new UnsafeDestinationError(packPath, "parent directory changed during the operation");
  }
  if (!isInside(rootReal, parentReal)) {
    throw new UnsafeDestinationError(packPath, "parent directory changed during the operation");
  }
  const opened = fstatSync(fd);
  if (!opened.isFile()) throw new UnsafeDestinationError(packPath, "not a regular file");
  const onDisk = lstatSync(full);
  if (onDisk.isSymbolicLink()) {
    throw new UnsafeDestinationError(packPath, "file was replaced by a symlink");
  }
  if (
    opened.ino !== 0 &&
    onDisk.ino !== 0 &&
    (opened.ino !== onDisk.ino || opened.dev !== onDisk.dev)
  ) {
    throw new UnsafeDestinationError(packPath, "file was replaced during the operation");
  }
}

/**
 * Read an existing pack destination, or null when it does not exist.
 * Throws UnsafeDestinationError if it (or a parent) would escape the root.
 */
export function readContained(rootReal: string, packPath: string): string | null {
  const full = resolveContained(rootReal, packPath);
  let fd: number;
  try {
    fd = openSync(full, constants.O_RDONLY | O_NOFOLLOW);
  } catch (e) {
    if (errCode(e) === "ELOOP") throw new UnsafeDestinationError(packPath, "file is a symlink");
    return null; // missing or unreadable: same as before, the write step reports real errors
  }
  try {
    verifyOpened(rootReal, full, fd, packPath);
    return readFileSync(fd, "utf8");
  } finally {
    closeSync(fd);
  }
}

/**
 * Write a pack file inside the root: resolve and check, create parents without
 * following symlinks, open without truncating, re-verify the opened inode, then
 * truncate and write. A race lost between check and open can still leave an
 * empty file at an attacker-chosen spot (see the header); it can no longer
 * clobber existing outside content that was swapped in after the check.
 */
export function writeContained(
  rootReal: string,
  packPath: string,
  body: string,
  grant?: CanonicalPromotionGrant,
  mode?: number,
): void {
  assertCanonicalKnowledgeWriteAllowed(resolve(rootReal, packPath), grant);
  const full = resolveContained(rootReal, packPath);
  assertCanonicalKnowledgeWriteAllowed(full, grant);
  ensureDirs(rootReal, dirname(full), packPath);
  let fd: number;
  try {
    fd = openSync(full, constants.O_WRONLY | constants.O_CREAT | O_NOFOLLOW, 0o666);
  } catch (e) {
    if (errCode(e) === "ELOOP") throw new UnsafeDestinationError(packPath, "file is a symlink");
    throw e;
  }
  try {
    verifyOpened(rootReal, full, fd, packPath);
    ftruncateSync(fd, 0);
    writeFileSync(fd, body);
    if (mode !== undefined) fchmodSync(fd, mode);
  } finally {
    closeSync(fd);
  }
}
