import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { CREW } from "./crew.ts";
import { MCPS } from "./mcps.ts";

const here = dirname(fileURLToPath(import.meta.url));
const captureNames = (server: string): Set<string> => {
  const cap = JSON.parse(
    readFileSync(
      join(here, "..", "..", "..", "fixtures", "captures", `${server}.tools.json`),
      "utf8",
    ),
  );
  return new Set(cap.tools.map((t: { name: string }) => t.name));
};

const CAPTURES: Record<string, Set<string>> = {};
for (const f of readdirSync(join(here, "..", "..", "..", "fixtures", "captures"))) {
  const m = f.match(/^(.+)\.tools\.json$/);
  if (m) CAPTURES[m[1]] = captureNames(m[1]);
}

describe("tool surface matches captures", () => {
  it("every catalog tool exists in its server capture", () => {
    for (const m of MCPS) {
      const cap = CAPTURES[m.id];
      if (!cap) continue; // remote/unmeasured servers have no capture
      for (const t of m.tools) {
        assert.ok(
          cap.has(t),
          `${m.id}: catalog tool ${t} missing from fixtures/captures/${m.id}.tools.json`,
        );
      }
    }
  });

  it("every crew MCP tool reference uses mcp__server__tool and exists in the capture", () => {
    for (const c of CREW) {
      for (const t of c.tools) {
        if (t.includes(".")) {
          assert.fail(
            `${c.id}: dot-notation tool ${t} — use mcp__<server>__<tool> per https://code.claude.com/docs/en/subagents`,
          );
        }
        const m = t.match(/^mcp__([^_]+)__(.+)$/);
        if (!m) continue; // built-in tool (Read, Edit, …)
        const [, server, tool] = m;
        assert.ok(CAPTURES[server], `${c.id}: no capture for server ${server}`);
        assert.ok(
          CAPTURES[server].has(tool),
          `${c.id}: mcp__${server}__${tool} missing from fixtures/captures/${server}.tools.json`,
        );
      }
    }
  });

  it("no stale graphify explain reference in the shipped pack sources", () => {
    const sources = ["crew.ts", "mcps.ts", "generate.ts", "hooks.ts", "skills.ts"];
    const stale = /graphify[._\s]explain|query,?\s*path,?\s*explain|explain\s+NAME/i;
    for (const f of sources) {
      const body = readFileSync(join(here, f), "utf8");
      assert.ok(
        !stale.test(body),
        `${f} still references a graphify explain tool (not in tool capture)`,
      );
    }
  });
});
