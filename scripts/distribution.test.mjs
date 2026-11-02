// scripts/distribution.test.mjs — Automated verification of cross-platform distribution & packaging
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { detectInstallMethod } from "../cli/update.ts";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const PKG = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));

describe("Phase 10.1: Cross-Platform Distribution & Installation", () => {
  describe("npm packaging configuration", () => {
    it("declares scoped public package identity", () => {
      assert.equal(PKG.name, "@sm-me-dev/helix");
      assert.equal(PKG.publishConfig?.access, "public");
      assert.equal(PKG.private, undefined);
    });

    it("maps binary executable entry point to bin/helix.mjs", () => {
      assert.equal(PKG.bin?.helix, "bin/helix.mjs");
      assert.ok(existsSync(join(ROOT, "bin", "helix.mjs")));
    });

    it("declares Node engine floor >= 22.6", () => {
      assert.ok(PKG.engines?.node);
      assert.match(PKG.engines.node, />=\s*22\.6/);
    });

    it("prepack script triggers ES module build", () => {
      assert.equal(PKG.scripts?.prepack, "node scripts/build.mjs");
      assert.equal(PKG.scripts?.build, "node scripts/build.mjs");
    });
  });

  describe("Installation method detection", () => {
    it("identifies git-link from repository checkout", () => {
      const res = detectInstallMethod(`file://${ROOT}/cli/update.ts`);
      assert.equal(res.method, "git-link");
      assert.equal(res.version, PKG.version);
    });

    it("identifies npm installation when in node_modules", () => {
      const res = detectInstallMethod(
        "file:///usr/local/lib/node_modules/@sm-me-dev/helix/dist/cli/update.js",
      );
      assert.equal(res.method, "npm");
    });

    it("identifies Homebrew installation when in Cellar", () => {
      const res = detectInstallMethod(
        "file:///opt/homebrew/Cellar/helix/0.9.0/libexec/app/dist/cli/update.js",
      );
      assert.equal(res.method, "homebrew");
    });

    it("identifies APT installation when in /usr/lib/helix", () => {
      const res = detectInstallMethod("file:///usr/lib/helix/app/dist/cli/update.js");
      assert.equal(res.method, "apt");
    });

    it("identifies standalone installation when in ~/.local/lib/helix", () => {
      const home = process.env.HOME || "/home/user";
      const res = detectInstallMethod(`file://${home}/.local/lib/helix/app/dist/cli/update.js`);
      assert.equal(res.method, "standalone");
    });

    it("identifies WinGet when in Programs/helix", () => {
      const res = detectInstallMethod(
        "file:///C:/Users/User/AppData/Local/Programs/helix/app/dist/cli/update.js",
      );
      assert.equal(res.method, "winget");
    });

    it("identifies Scoop when in scoop/apps/helix", () => {
      const res = detectInstallMethod(
        "file:///C:/Users/User/scoop/apps/helix/0.9.0/app/dist/cli/update.js",
      );
      assert.equal(res.method, "scoop");
    });
  });

  describe("Shell script syntax & validation", () => {
    const scripts = [
      "scripts/install.sh",
      "scripts/uninstall.sh",
      "scripts/verify-release.sh",
      "scripts/apt/install-apt.sh",
    ];

    for (const s of scripts) {
      it(`${s} passes sh syntax check`, () => {
        const full = join(ROOT, s);
        assert.ok(existsSync(full), `${s} must exist`);
        execFileSync("sh", ["-n", full]);
      });
    }

    const bashScripts = ["scripts/build-deb.sh", "scripts/build-rpm.sh"];

    for (const s of bashScripts) {
      it(`${s} passes bash syntax check`, () => {
        const full = join(ROOT, s);
        assert.ok(existsSync(full), `${s} must exist`);
        execFileSync("bash", ["-n", full]);
      });
    }
  });

  describe("Package manager manifests", () => {
    it("Homebrew Formula defines valid class and URLs", () => {
      const formulaPath = join(ROOT, "Formula", "helix.rb");
      assert.ok(existsSync(formulaPath));
      const content = readFileSync(formulaPath, "utf8");
      assert.match(content, /class Helix < Formula/);
      assert.match(content, new RegExp(`version "#{0,1}${PKG.version}`));
      assert.match(content, /bin\.install_symlink libexec\/"bin\/helix"/);
    });

    it("WinGet manifest declares sm-me-dev.Helix singleton", () => {
      const wingetPath = join(ROOT, "manifests", "winget", "sm-me-dev.Helix.yaml");
      assert.ok(existsSync(wingetPath));
      const content = readFileSync(wingetPath, "utf8");
      assert.match(content, /PackageIdentifier:\s*sm-me-dev\.Helix/);
      assert.match(content, new RegExp(`PackageVersion:\\s*${PKG.version}`));
    });

    it("Scoop manifest specifies bin/helix.cmd and 64bit archive", () => {
      const scoopPath = join(ROOT, "manifests", "scoop", "helix.json");
      assert.ok(existsSync(scoopPath));
      const json = JSON.parse(readFileSync(scoopPath, "utf8"));
      assert.equal(json.version, PKG.version);
      assert.equal(json.bin, "bin/helix.cmd");
      assert.ok(json.architecture?.["64bit"]?.url);
    });

    it("APT distributions defines stable codename and amd64/arm64", () => {
      const distPath = join(ROOT, "scripts", "apt", "distributions");
      assert.ok(existsSync(distPath));
      const content = readFileSync(distPath, "utf8");
      assert.match(content, /Origin:\s*Helix/);
      assert.match(content, /Architectures:\s*amd64 arm64/);
    });
  });
});
