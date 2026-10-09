import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

describe("repo hygiene (Phase 0 #9)", () => {
  it("engines.node covers the CLI's type-stripping floor (22.6)", () => {
    const m = String(pkg.engines?.node ?? "").match(/>=\s*(\d+)\.(\d+)/);
    assert.ok(m, "engines.node must declare a >= floor");
    const floor = Number(m[1]) * 100 + Number(m[2]);
    assert.ok(floor >= 2206, `engines.node ${pkg.engines.node} below CLI floor 22.6`);
  });

  it("typescript is a devDependency, not a runtime dependency", () => {
    assert.ok(!((pkg.dependencies ?? {}).typescript), "typescript must not ship as a runtime dependency");
    assert.ok((pkg.devDependencies ?? {}).typescript, "typescript must stay in devDependencies");
  });

  it("CI pins every third-party action to a SHA", () => {
    const dir = join(root, ".github", "workflows");
    for (const f of readdirSync(dir)) {
      if (!f.endsWith(".yml") && !f.endsWith(".yaml")) continue;
      const body = readFileSync(join(dir, f), "utf8");
      for (const m of body.matchAll(/uses:\s*([^\s#]+)/g)) {
        const ref = m[1];
        if (ref.startsWith("./") || ref.startsWith("docker://")) continue;
        assert.ok(
          /@[0-9a-f]{40}/.test(ref),
          `${f}: ${ref} floats on a tag — pin to a SHA (Dependabot keeps it fresh)`,
        );
      }
    }
  });
});
