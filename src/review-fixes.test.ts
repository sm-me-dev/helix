// Findings from the 2026-10-12 code review / tech-debt / harness review. Each test failed first.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { generatePack } from "./generate.ts";
import { ADAPTER_BY_ID } from "./adapters/index.ts";
import { CREW } from "./crew.ts";
import type { HarnessConfig, PlatformId } from "./types.ts";

const BASE: HarnessConfig = {
  crew: ["scout", "architect", "builder", "reviewer"],
  skills: [],
  mcps: ["graphify"],
  platforms: ["claude-code"],
  graphFirst: true,
  progressiveDisclosure: true,
  defaultSingleAgent: true,
  hooksEnabled: true,
};

const file = (cfg: HarnessConfig, path: string) => generatePack(cfg).find((f) => f.path === path);
const denies = (cfg: HarnessConfig): string[] => {
  const s = file(cfg, ".claude/settings.json");
  assert.ok(s, "settings.json is emitted");
  return (JSON.parse(s.body) as { permissions?: { deny?: string[] } }).permissions?.deny ?? [];
};

describe("secret denies survive every configuration", () => {
  it("keeps the denies when hooks are off", () => {
    const d = denies({ ...BASE, hooksEnabled: false });
    assert.ok(d.includes("Read(.env)"), "Read(.env) denied with hooks off");
    assert.ok(d.includes("Edit(.env)"));
  });
  it("keeps the denies in plugin mode", () => {
    assert.ok(denies({ ...BASE, claudePlugin: true }).includes("Read(.env)"));
  });
});

describe("agents cannot edit the files that police them", () => {
  const PROTECTED = [
    "Edit(.helix/gate.mjs)",
    "Edit(.helix/gate.json)",
    "Edit(.helix/hooks/**)",
    "Edit(.claude/settings.json)",
  ];
  for (const [name, cfg] of [
    ["hooks on", BASE],
    ["hooks off", { ...BASE, hooksEnabled: false }],
    ["plugin", { ...BASE, claudePlugin: true }],
  ] as const) {
    it(`denies edits to the gate, hooks and settings (${name})`, () => {
      const d = denies(cfg);
      for (const rule of PROTECTED) assert.ok(d.includes(rule), `${rule} missing`);
    });
  }
});

describe("pack content matches the configuration", () => {
  it("ships prefer-graph.mjs only when graph-first is on", () => {
    const on = generatePack(BASE).map((f) => f.path);
    assert.ok(on.includes(".helix/hooks/prefer-graph.mjs"));
    const off = generatePack({ ...BASE, graphFirst: false, mcps: [] }).map((f) => f.path);
    assert.ok(!off.includes(".helix/hooks/prefer-graph.mjs"), "an unwired hook is dead weight");
    assert.ok(off.includes(".helix/hooks/test-on-stop.mjs"));
  });

  it("README promises only what is installed", () => {
    const off = file({ ...BASE, graphFirst: false, mcps: [] }, ".helix/README.md")!.body;
    assert.doesNotMatch(off, /Install Graphify/);
    assert.doesNotMatch(off, /graph-first hint/);
    const on = file(BASE, ".helix/README.md")!.body;
    assert.match(on, /Install Graphify/);
    assert.match(on, /graph-first hint/);
  });

  it("README states no unmeasured token multiplier", () => {
    assert.doesNotMatch(file(BASE, ".helix/README.md")!.body, /~?\d+\s*[×x] tokens/);
  });

  it("agent bodies start flush left", () => {
    for (const c of CREW) {
      const body = file(BASE, `.claude/agents/${c.id}.md`)!.body;
      assert.doesNotMatch(body, /\n\n [A-Za-z]/, `${c.id}: stray leading space before the body`);
    }
  });

  it("the CI workflow does not persist checkout credentials", () => {
    const wf = file(
      {
        ...BASE,
        ci: "github",
        stack: {
          language: "typescript",
          packageManager: "npm",
          testCommand: "npm test",
          lintCommand: "npm run lint",
          formatCommand: null,
        },
      },
      ".github/workflows/helix-gate.yml",
    );
    assert.ok(wf, "workflow emitted");
    assert.match(wf.body, /persist-credentials: false/);
  });
});

describe("the crew table follows the capability matrix", () => {
  const ids = Object.keys(ADAPTER_BY_ID) as PlatformId[];
  for (const id of ids) {
    it(`${id}: table dropped iff the adapter emits agent files`, () => {
      const emitsAgents = ADAPTER_BY_ID[id].capabilities.subagents === "emitted";
      const agentsMd = file({ ...BASE, platforms: [id] }, "AGENTS.md")!.body;
      assert.equal(!agentsMd.includes("## Crew"), emitsAgents);
    });
  }
});

describe("graph tools fit the role", () => {
  it("no role depends on a GitHub PR number it will not have", () => {
    for (const c of CREW) {
      assert.ok(!c.tools.includes("mcp__graphify__get_pr_impact"), `${c.id} lists get_pr_impact`);
    }
  });
});
