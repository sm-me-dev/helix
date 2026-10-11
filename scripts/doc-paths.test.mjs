// Doc rot guard: every repo path named in backticks in the living docs (the ones
// an agent or a new contributor reads first) must exist. Born from the Step B
// split, which left AGENTS.md pointing at src/lib/harness/ and README describing
// a website that no longer lives here. Historical logs (DECISIONS.md, the F1
// plan, NEXT-PROMPT.md) are append-only records and are excluded on purpose.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

const LIVING_DOCS = [
  "AGENTS.md",
  "README.md",
  "CONTRIBUTING.md",
  "SECURITY.md",
  "docs/ARCHITECTURE.md",
  "docs/CLI.md",
  "docs/INSTALL.md",
  "evals/README.md",
];

// `.helix/` is deliberately absent: it names files in the *target* repo's pack.
const TOP_DIRS = ["src/", "cli/", "scripts/", "evals/", "docs/", "fixtures/"];

/** `a/{b,c}.ts` -> [`a/b.ts`, `a/c.ts`] (one level is all the docs use). */
function expandBraces(p) {
  const m = p.match(/^(.*)\{([^{}]+)\}(.*)$/);
  if (!m) return [p];
  return m[2].split(",").flatMap((alt) => expandBraces(m[1] + alt.trim() + m[3]));
}

function pathsIn(markdown) {
  const out = new Set();
  for (const m of markdown.matchAll(/`([^`\n]+)`/g)) {
    const raw = m[1].trim();
    if (/[\s*<>$|]/.test(raw.replace(/\{[^}]*\}/g, ""))) continue; // commands, globs, placeholders
    if (!TOP_DIRS.some((d) => raw.startsWith(d))) continue;
    for (const p of expandBraces(raw)) out.add(p.replace(/[.,:;)]+$/, ""));
  }
  return [...out];
}

describe("living docs only name paths that exist", () => {
  for (const doc of LIVING_DOCS) {
    it(doc, () => {
      const file = join(ROOT, doc);
      if (!existsSync(file)) return; // a doc that is gone cannot rot
      const missing = pathsIn(readFileSync(file, "utf8")).filter((p) => !existsSync(join(ROOT, p)));
      assert.deepEqual(missing, [], `${doc} references missing paths`);
    });
  }

  it("the website is gone: living docs must not describe routes or a dev server", () => {
    const offenders = [];
    for (const doc of LIVING_DOCS) {
      const file = join(ROOT, doc);
      if (!existsSync(file)) continue;
      const body = readFileSync(file, "utf8");
      if (
        /npm run dev|localhost:8080|`\/(crew|stack|playbook|run|export)`|configurator/i.test(body)
      ) {
        offenders.push(doc);
      }
    }
    assert.deepEqual(offenders, [], "these docs still describe the removed website");
  });
});
