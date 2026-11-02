// `helix link` / `helix unlink`: a shim on the user's PATH so `helix` works from anywhere.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, statSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { nodeOnlyBin } from "./test-env.mjs";
import {
  addRcBlock,
  installShim,
  isOnPath,
  rcFileFor,
  removeRcBlock,
  removeShim,
  shimScript,
} from "./link.ts";

const CLI = fileURLToPath(new URL("./helix.mjs", import.meta.url));
const tmp = (p) => mkdtempSync(join(tmpdir(), p));

describe("shim", () => {
  it("is a POSIX script that execs the CLI with type stripping and forwards args", () => {
    const s = shimScript({ cliPath: "/opt/helix/cli/helix.mjs", nodePath: "/usr/bin/node" });
    assert.match(s, /^#!\/bin\/sh\n/);
    assert.match(s, /helix-shim/);
    assert.match(s, /--experimental-strip-types/);
    assert.match(s, /"\/opt\/helix\/cli\/helix\.mjs" "\$@"/);
  });

  it("quotes paths with spaces and quotes safely", () => {
    const s = shimScript({ cliPath: `/o p/it's/helix.mjs`, nodePath: "/n" });
    assert.ok(s.includes(`'/o p/it'\\''s/helix.mjs'`), s);
  });

  it("installs an executable shim that really runs the CLI", () => {
    const bin = tmp("helix-bin-");
    const r = installShim({ binDir: bin, cliPath: CLI, nodePath: process.execPath });
    assert.equal(r.action, "wrote");
    assert.ok(statSync(r.path).mode & 0o111, "shim must be executable");
    const run = spawnSync(r.path, ["--help"], {
      encoding: "utf8",
      env: { PATH: nodeOnlyBin() },
      timeout: 20_000,
    });
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, /helix — AI coding harness pack manager/);
  });

  it("falls back to the recorded node when node is not on PATH", () => {
    const bin = tmp("helix-bin-");
    const r = installShim({ binDir: bin, cliPath: CLI, nodePath: process.execPath });
    const run = spawnSync(r.path, ["--help"], {
      encoding: "utf8",
      env: { PATH: "" },
      timeout: 20_000,
    });
    assert.equal(run.status, 0, run.stderr);
  });

  it("is idempotent, and refuses to clobber a foreign file without force", () => {
    const bin = tmp("helix-bin-");
    const opts = { binDir: bin, cliPath: CLI, nodePath: process.execPath };
    assert.equal(installShim(opts).action, "wrote");
    assert.equal(installShim(opts).action, "kept");
    writeFileSync(join(bin, "helix"), "#!/bin/sh\necho mine\n");
    assert.equal(installShim(opts).action, "refused");
    assert.equal(readFileSync(join(bin, "helix"), "utf8"), "#!/bin/sh\necho mine\n");
    assert.equal(installShim({ ...opts, force: true }).action, "wrote");
  });

  it("removes only its own shim", () => {
    const bin = tmp("helix-bin-");
    installShim({ binDir: bin, cliPath: CLI, nodePath: process.execPath });
    assert.equal(removeShim({ binDir: bin }).action, "removed");
    assert.equal(existsSync(join(bin, "helix")), false);
    assert.equal(removeShim({ binDir: bin }).action, "absent");
    writeFileSync(join(bin, "helix"), "#!/bin/sh\necho mine\n");
    assert.equal(removeShim({ binDir: bin }).action, "refused");
    assert.ok(existsSync(join(bin, "helix")));
  });
});

describe("PATH", () => {
  it("detects whether a dir is on PATH", () => {
    assert.equal(isOnPath("/a/b", "/x:/a/b:/y"), true);
    assert.equal(isOnPath("/a/b/", "/x:/a/b"), true);
    assert.equal(isOnPath("/a/c", "/x:/a/b"), false);
  });

  it("maps shells to rc files; unknown shells get none", () => {
    assert.equal(rcFileFor("/usr/bin/zsh", "/h"), "/h/.zshrc");
    assert.equal(rcFileFor("/bin/bash", "/h"), "/h/.bashrc");
    assert.equal(rcFileFor("/usr/bin/fish", "/h"), null);
    assert.equal(rcFileFor(undefined, "/h"), null);
  });

  it("adds one marked PATH block to an rc file and removes exactly it", () => {
    const home = tmp("helix-home-");
    const rc = join(home, ".zshrc");
    writeFileSync(rc, "export A=1\n");
    assert.equal(addRcBlock(rc, "/h/.local/bin"), "added");
    assert.equal(addRcBlock(rc, "/h/.local/bin"), "kept");
    const text = readFileSync(rc, "utf8");
    assert.match(text, /^export A=1\n/);
    assert.equal((text.match(/>>> helix >>>/g) ?? []).length, 1);
    assert.match(text, /export PATH="\/h\/\.local\/bin:\$PATH"/);
    assert.equal(removeRcBlock(rc), "removed");
    assert.equal(readFileSync(rc, "utf8"), "export A=1\n");
    assert.equal(removeRcBlock(rc), "absent");
  });
});
