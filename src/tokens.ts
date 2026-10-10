// Token accounting for the harness pack.
//
// Every number here is COMPUTED: helix-side counts come from countTokens over
// the actually generated output, the naive side from committed fixtures under
// fixtures/baseline/. The only catalog numbers left are MCP schema weights
// (flagged in `estimates`) and MCP schemas without a fresh tools/list
// measurement (flagged per server — run scripts/measure-mcp.mjs).
import { BLOATED_AGENTS_MD } from "../fixtures/baseline/bloated-agents-md.ts";
import { TYPICAL_MCP_SCHEMAS } from "../fixtures/baseline/fifteen-mcp-schemas.ts";
import { agentFile, skillFile } from "./adapters/parts.ts";
import { CREW } from "./crew.ts";
import { agentsMd, generatePack } from "./generate.ts";
import { mcpSchemaTokens } from "./mcps.ts";
import { countTokens, TOKENIZER_METHOD } from "./measure.ts";
import { SKILLS } from "./skills.ts";
import type { HarnessConfig, TokenBreakdown, TokenCheck } from "./types";

function frontmatter(text: string): string {
  const m = text.match(/^---\n[\s\S]*?\n---/);
  return m ? m[0] : text;
}

/** Config whose roles carry their full tool lists (graphify MCP present): the naive/UI view. */
const ALL_TOOLS_CONFIG: HarnessConfig = {
  crew: [],
  skills: [],
  mcps: ["graphify"],
  platforms: [],
  graphFirst: true,
  progressiveDisclosure: true,
  defaultSingleAgent: true,
  hooksEnabled: true,
};

/** Measured display numbers for one skill: always-on frontmatter vs full body. */
export function skillTokens(id: HarnessConfig["skills"][number]): { index: number; body: number } {
  const full = skillFile(id);
  return { index: countTokens(frontmatter(full)), body: countTokens(full) };
}

/** Measured display numbers for one crew role: parent-side description vs full file. */
export function agentTokens(
  id: HarnessConfig["crew"][number],
  config: HarnessConfig = ALL_TOOLS_CONFIG,
): { index: number; body: number } {
  const full = agentFile(id, config);
  return { index: countTokens(frontmatter(full)), body: countTokens(full) };
}

/** Roles emitted as agent files. The main session orchestrates and needs no file. */
function emittedCrew(config: HarnessConfig) {
  return [...config.crew];
}

// Unmeasured MCP schemas are NOT a check: they are reported as labeled estimates
// (see `estimates` in breakdown) so measure and doctor agree and neither fails on a disclosure.
function buildChecks(config: HarnessConfig, parts: { agentsMd: number }): TokenCheck[] {
  const pack = generatePack(config);
  const paths = pack.map((f) => f.path);
  const settings = pack.find((f) => f.path === ".claude/settings.json");
  const hookFiles = [
    ".helix/hooks/prefer-graph.mjs",
    ".helix/hooks/format-lint.mjs",
    ".helix/hooks/test-on-stop.mjs",
  ].every((p) => paths.includes(p));
  let settingsWired = false;
  if (settings) {
    try {
      const s = JSON.parse(settings.body) as {
        hooks?: Record<string, unknown[]>;
      };
      settingsWired = Array.isArray(s.hooks?.Stop) && Array.isArray(s.hooks?.PostToolUse);
    } catch {
      settingsWired = false;
    }
  }
  return [
    {
      id: "agents-budget",
      label: `AGENTS.md under 500 tokens (now ${parts.agentsMd})`,
      pass: parts.agentsMd <= 500,
    },
    {
      id: "no-duplicates",
      label: "no duplicate file paths in the pack",
      pass: new Set(paths).size === paths.length,
    },
    {
      id: "hooks",
      label: config.hooksEnabled
        ? `hooks wired (settings + 3 scripts: ${settingsWired && hookFiles ? "yes" : "no"})`
        : "hooks off (nothing to wire)",
      pass: !config.hooksEnabled || (settingsWired && hookFiles),
    },
    {
      id: "mcp-count",
      label: `at most 5 MCP servers (now ${config.mcps.length})`,
      pass: config.mcps.length <= 5,
    },
  ];
}

export function breakdown(config: HarnessConfig): TokenBreakdown {
  const agentsMdTokens = countTokens(agentsMd(config));
  const skillIndex = config.skills.reduce(
    (n, id) => n + countTokens(frontmatter(skillFile(id))),
    0,
  );
  const crewIndex = emittedCrew(config).reduce(
    (n, id) => n + countTokens(frontmatter(agentFile(id, config))),
    0,
  );
  const mcpParts = config.mcps.map((id) => ({ id, ...mcpSchemaTokens(id) }));
  const mcpSchemas = mcpParts.reduce((n, p) => n + p.tokens, 0);
  const alwaysOn = agentsMdTokens + skillIndex + mcpSchemas + crewIndex;

  // Naive side: fixtures for the bloated file and the overweight 15-server MCP
  // schemas; skills and crew fully inlined (frontmatter-only is the helix
  // optimization).
  const naiveSkills = SKILLS.reduce((n, s) => n + countTokens(skillFile(s.id)), 0);
  const naiveCrew = CREW.reduce((n, c) => n + countTokens(agentFile(c.id, ALL_TOOLS_CONFIG)), 0);
  const naiveAlwaysOn =
    countTokens(BLOATED_AGENTS_MD) + countTokens(TYPICAL_MCP_SCHEMAS) + naiveSkills + naiveCrew;

  const unmeasured = mcpParts.filter((p) => !p.measured).map((p) => p.id);
  const estimates: string[] = [];
  if (unmeasured.length > 0) {
    estimates.push(
      `MCP schemas (${unmeasured.join(", ")}): catalog estimates — run scripts/measure-mcp.mjs`,
    );
  }
  estimates.push("naive baseline: representative fixtures (fixtures/baseline/*), not a live host");

  const checks = buildChecks(config, { agentsMd: agentsMdTokens });
  const passed = checks.filter((c) => c.pass).length;
  const leanScore = Math.round((100 * passed) / checks.length);

  return {
    agentsMd: agentsMdTokens,
    skillIndex,
    mcpSchemas,
    crewIndex,
    alwaysOn,
    naiveAlwaysOn,
    checks,
    leanScore,
    estimates,
    method: TOKENIZER_METHOD,
  };
}

export function formatTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

export function savingsRatio(config: HarnessConfig): number {
  const b = breakdown(config);
  return b.naiveAlwaysOn / Math.max(b.alwaysOn, 1);
}

export { TOKENIZER_METHOD } from "./measure.ts";
