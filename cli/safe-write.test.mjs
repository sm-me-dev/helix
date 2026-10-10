// Filesystem containment for the pack writer. Every test works in temp dirs;
// "outside" is a sibling of the target root and must never change.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import {
  UnsafeDestinationError,
  isInside,
  prepareTargetRoot,
  preflightPack,
  readContained,
  resolveContained,
  writeContained,
} from "./safe-write.ts";
import { SYMLINK_SKIP, linkDir, linkFile } from "./symlink-helper.mjs";

/** root = target dir (realpath'd); outside = sibling holding a secret that must stay untouched. */
function fixture() {
  const base = mkdtempSync(join(tmpdir(), "helix-safe-"));
  const target = join(base, "target");
  const outside = join(base, "outside");
  mkdirSync(outside);
  writeFileSync(join(outside, "secret.txt"), "SECRET");
  return { root: prepareTargetRoot(target), outside, base };
}

/** Every file under dir with its content, never following symlinks. */
function snapshot(dir) {
  const out = {};
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, e.name);
      const rel = relative(dir, full).split(sep).join("/");
      if (e.isSymbolicLink()) out[rel] = `-> ${lstatSync(full).isSymbolicLink()}`;
      else if (e.isDirectory()) {
        out[rel + "/"] = "dir";
        walk(full);
      } else out[rel] = readFileSync(full, "utf8");
    }
  };
  walk(dir);
  return out;
}

const unsafe = (re) => (e) => e instanceof UnsafeDestinationError && re.test(e.reason);

describe("isInside", () => {
  it("is a path-boundary check, not a string prefix", () => {
    const { base } = fixture();
    const root = join(base, "target");
    assert.equal(isInside(root, root), true);
    assert.equal(isInside(root, join(root, "a", "b")), true);
    assert.equal(isInside(root, join(base, "target-evil")), false, "sibling sharing a prefix");
    assert.equal(isInside(root, join(root, "..", "outside")), false);
    assert.equal(isInside(root, base), false);
    assert.equal(isInside(root, join(root, "..foo")), true, "a name that merely starts with ..");
  });
});

describe("resolveContained", () => {
  it("resolves plain, nested and not-yet-existing pack paths under the root", () => {
    const { root } = fixture();
    assert.equal(resolveContained(root, "AGENTS.md"), join(root, "AGENTS.md"));
    assert.equal(
      resolveContained(root, ".claude/skills/x/SKILL.md"),
      join(root, ".claude", "skills", "x", "SKILL.md"),
    );
  });

  it("rejects lexically unsafe paths with UnsafeDestinationError", () => {
    const { root } = fixture();
    for (const p of ["../x", "/etc/passwd", "C:\\x", "\\\\srv\\share\\x", "C:x", "a\0b", ""]) {
      assert.throws(() => resolveContained(root, p), UnsafeDestinationError, JSON.stringify(p));
    }
  });

  it("fails when a path component is a file, not a directory", () => {
    const { root } = fixture();
    writeFileSync(join(root, ".claude"), "i am a file");
    assert.throws(() => resolveContained(root, ".claude/x.md"), unsafe(/not a directory/));
  });

  it("refuses a symlinked directory that points outside the root", { skip: SYMLINK_SKIP }, () => {
    const { root, outside } = fixture();
    linkDir(outside, join(root, ".claude"));
    assert.throws(() => resolveContained(root, ".claude/x.md"), unsafe(/outside the target/));
  });

  it("refuses a destination symlinked to a file outside the root", { skip: SYMLINK_SKIP }, () => {
    const { root, outside } = fixture();
    linkFile(join(outside, "secret.txt"), join(root, "AGENTS.md"));
    assert.throws(() => resolveContained(root, "AGENTS.md"), unsafe(/outside the target/));
  });

  it(
    "refuses a dangling symlink (its target would be created elsewhere)",
    { skip: SYMLINK_SKIP },
    () => {
      const { root, outside } = fixture();
      linkFile(join(outside, "does-not-exist.txt"), join(root, "AGENTS.md"));
      assert.throws(() => resolveContained(root, "AGENTS.md"), unsafe(/dangling/));
    },
  );

  it(
    "allows a symlink that stays inside the root and returns its real path",
    { skip: SYMLINK_SKIP },
    () => {
      const { root } = fixture();
      mkdirSync(join(root, ".agents"));
      linkDir(join(root, ".agents"), join(root, ".claude"));
      assert.equal(resolveContained(root, ".claude/x.md"), join(root, ".agents", "x.md"));
    },
  );
});

describe("preflightPack", () => {
  it("reports every violation and touches nothing", { skip: SYMLINK_SKIP }, () => {
    const { root, outside } = fixture();
    linkDir(outside, join(root, ".claude"));
    const before = { outside: snapshot(outside), root: snapshot(root) };
    const v = preflightPack(root, ["AGENTS.md", ".claude/a.md", "../b.md", ".claude/c/d.md"]);
    assert.deepEqual(
      v.map((e) => e.packPath),
      [".claude/a.md", "../b.md", ".claude/c/d.md"],
    );
    assert.deepEqual(snapshot(outside), before.outside);
    assert.deepEqual(snapshot(root), before.root);
  });

  it("returns no violations for a clean target", () => {
    const { root } = fixture();
    assert.deepEqual(preflightPack(root, ["AGENTS.md", ".helix/gate.mjs"]), []);
  });
});

describe("writeContained", () => {
  it("rejects traversal and absolute paths without creating or modifying anything outside", () => {
    const { root, outside, base } = fixture();
    const before = snapshot(base);
    const abs = join(outside, "abs-target.txt");
    for (const p of [
      "../outside/evil.md",
      "..\\outside\\evil.md",
      "a/../../outside/secret.txt",
      abs,
      "C:\\Windows\\evil.md",
      "\\\\server\\share\\evil.md",
    ]) {
      assert.throws(() => writeContained(root, p, "pwned"), UnsafeDestinationError, p);
    }
    assert.deepEqual(snapshot(base), before, "target and outside are byte-for-byte unchanged");
    assert.equal(readFileSync(join(outside, "secret.txt"), "utf8"), "SECRET");
  });

  it("creates parents, writes, and overwrites an existing file in place", () => {
    const { root } = fixture();
    writeContained(root, ".helix/deep/er/file.md", "one");
    assert.equal(readFileSync(join(root, ".helix/deep/er/file.md"), "utf8"), "one");
    writeContained(root, ".helix/deep/er/file.md", "two-longer-than-one");
    writeContained(root, ".helix/deep/er/file.md", "2");
    assert.equal(readFileSync(join(root, ".helix/deep/er/file.md"), "utf8"), "2", "no stale tail");
  });

  it("never writes through a symlinked directory pointing outside", { skip: SYMLINK_SKIP }, () => {
    const { root, outside } = fixture();
    linkDir(outside, join(root, ".claude"));
    const before = snapshot(outside);
    assert.throws(
      () => writeContained(root, ".claude/pwned.md", "x"),
      unsafe(/outside the target/),
    );
    assert.throws(
      () => writeContained(root, ".claude/new/dir/pwned.md", "x"),
      UnsafeDestinationError,
    );
    assert.deepEqual(snapshot(outside), before, "nothing created or modified outside");
  });

  it(
    "never overwrites an outside file reached through a symlinked destination",
    { skip: SYMLINK_SKIP },
    () => {
      const { root, outside } = fixture();
      linkFile(join(outside, "secret.txt"), join(root, "AGENTS.md"));
      assert.throws(
        () => writeContained(root, "AGENTS.md", "overwritten"),
        unsafe(/outside the target/),
      );
      assert.equal(readFileSync(join(outside, "secret.txt"), "utf8"), "SECRET");
    },
  );

  it("does not create parent directories before refusing", { skip: SYMLINK_SKIP }, () => {
    const { root, outside } = fixture();
    linkDir(outside, join(root, "link"));
    assert.throws(() => writeContained(root, "link/a/b/c.md", "x"), UnsafeDestinationError);
    assert.deepEqual(readdirSync(outside), ["secret.txt"]);
  });

  it("writes through an inside-the-root symlink to its real target", { skip: SYMLINK_SKIP }, () => {
    const { root } = fixture();
    writeFileSync(join(root, "CLAUDE.md"), "old");
    linkFile(join(root, "CLAUDE.md"), join(root, "AGENTS.md"));
    writeContained(root, "AGENTS.md", "new");
    assert.equal(readFileSync(join(root, "CLAUDE.md"), "utf8"), "new");
    assert.ok(lstatSync(join(root, "AGENTS.md")).isSymbolicLink(), "link itself is preserved");
  });
});

describe("readContained", () => {
  it("returns null for a missing file and the content for an existing one", () => {
    const { root } = fixture();
    assert.equal(readContained(root, "AGENTS.md"), null);
    assert.equal(readContained(root, ".claude/missing/x.md"), null);
    writeFileSync(join(root, "AGENTS.md"), "mine");
    assert.equal(readContained(root, "AGENTS.md"), "mine");
  });

  it(
    "never reads an outside file through a symlinked destination or directory",
    { skip: SYMLINK_SKIP },
    () => {
      const { root, outside } = fixture();
      linkFile(join(outside, "secret.txt"), join(root, "opencode.json"));
      linkDir(outside, join(root, ".claude"));
      assert.throws(() => readContained(root, "opencode.json"), unsafe(/outside the target/));
      assert.throws(() => readContained(root, ".claude/secret.txt"), unsafe(/outside the target/));
    },
  );
});
