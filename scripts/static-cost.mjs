// Static (agent-free) cost report: what the Helix pack adds to every request,
// and what real MCP schemas would add if loaded unmanaged.
//
// Usage:
//   node scripts/static-cost.mjs            # print the report
//   node scripts/static-cost.mjs --write    # write evals/results/static-cost.json
//   node scripts/static-cost.mjs --check    # exit 1 if the committed JSON is stale
//
// Method: o200k_base BPE via gpt-tokenizer over the actually generated pack
// (src/generate.ts) and the committed real tools/list captures
// (fixtures/captures/*.json). The synthetic "bloated baseline" fixtures under
// fixtures/baseline/ are deliberately NOT used: a straw-man baseline proves
// nothing. A plain agent adds 0 tokens, so this report states Helix's cost, not
// a win; per-task savings need real runs (evals/).
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { agentTokens, breakdown } from "../src/tokens.ts";
import { countTokens, TOKENIZER_METHOD } from "../src/measure.ts";
import { DEFAULT_CREW } from "../src/crew.ts";
import { DEFAULT_HARNESS_CONFIG } from "../src/defaults.ts";
import { mcpSchemaTokens } from "../src/mcps.ts";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const OUT = `${ROOT}evals/results/static-cost.json`;

const CAPTURE_DIR = `${ROOT}fixtures/captures/`;
const captures = readdirSync(CAPTURE_DIR)
  .filter((f) => f.endsWith(".tools.json"))
  .sort()
  .map((f) => {
    const c = JSON.parse(readFileSync(CAPTURE_DIR + f, "utf8"));
    return {
      server: c.server,
      capturedAt: c.capturedAt,
      toolCount: c.toolCount,
      schemaTokens: countTokens(JSON.stringify(c.tools)),
    };
  });

function pack(label, config) {
  const b = breakdown(config);
  return {
    label,
    agentsMd: b.agentsMd,
    skillIndex: b.skillIndex,
    mcpSchemas: b.mcpSchemas,
    crewIndex: b.crewIndex,
    alwaysOn: b.alwaysOn,
    mcps: config.mcps.map((id) => {
      const m = mcpSchemaTokens(id);
      return { id, tokens: m.tokens, measured: m.measured };
    }),
  };
}

// Scenarios follow what `helix init` emits per repo shape (graph-first only on
// larger repos, Playwright only for UI repos); the library default config is not
// a real repo shape, so it is not used.
const SCENARIOS = [
  ["small repo (context7)", ["context7"]],
  ["large repo (graphify + context7)", ["graphify", "context7"]],
  ["large UI repo (graphify + context7 + playwright)", ["graphify", "context7", "playwright"]],
];
const withCrew = (mcps, crew) => ({ ...DEFAULT_HARNESS_CONFIG, mcps, crew });
const crewConfig = withCrew(["graphify", "context7"], [...DEFAULT_CREW]);

const report = {
  schema: 1,
  method: TOKENIZER_METHOD,
  note: "Static sizes only. A plain agent adds 0 tokens, so this is Helix's cost, not a saving. Per-task tokens come from evals/results/*.json. Claude Code defers MCP schemas (verified 2026-10-10); other platforms are assumed to load them.",
  packs: SCENARIOS.flatMap(([label, mcps]) => [
    pack(label, withCrew(mcps, [])),
    pack(`${label} + --crew`, withCrew(mcps, [...DEFAULT_CREW])),
  ]),
  crewRoles: DEFAULT_CREW.map((id) => ({ id, ...agentTokens(id, crewConfig) })),
  mcpCaptures: captures,
  mcpAllCapturedLoaded: captures.reduce((n, c) => n + c.schemaTokens, 0),
  gate: {
    modelTokens: 0,
    basis: "src/gate.ts is a deterministic script (secrets, lint, typecheck, tests)",
  },
};

const text = JSON.stringify(report, null, 2) + "\n";
const arg = process.argv[2];
if (arg === "--write") {
  writeFileSync(OUT, text);
  console.log(`wrote ${OUT}`);
} else if (arg === "--check") {
  let committed = "";
  try {
    committed = readFileSync(OUT, "utf8");
  } catch {
    // missing file counts as stale
  }
  if (committed !== text) {
    console.error("static-cost.json is stale: run node scripts/static-cost.mjs --write");
    process.exit(1);
  }
  console.log("static-cost.json is current");
} else {
  process.stdout.write(text);
}
