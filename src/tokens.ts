import { CREW_BY_ID } from "./crew.ts";
import { MCP_BY_ID } from "./mcps.ts";
import { SKILL_BY_ID } from "./skills.ts";
import { LSP_BY_ID } from "./lsps.ts";
import type { HarnessConfig, TokenBreakdown } from "./types";

const AGENTS_MD_LEAN = 780;
const AGENTS_MD_BLOATED = 6400;
const NAIVE_MCP = 8600;
const NAIVE_SKILLS = 4200;
const NAIVE_CREW = 2400;

export function breakdown(config: HarnessConfig): TokenBreakdown {
  const skillIndex = config.skills.reduce((n, id) => n + SKILL_BY_ID[id].alwaysOnTokens, 0);
  const mcpSchemas = config.mcps.reduce((n, id) => n + MCP_BY_ID[id].schemaTokens, 0);
  const lspSchemas = config.lsps.reduce((n, id) => n + LSP_BY_ID[id].schemaTokens, 0);
  const crewIndex = config.crew.reduce((n, id) => n + CREW_BY_ID[id].alwaysOnTokens, 0);
  const agentsMd = config.progressiveDisclosure ? AGENTS_MD_LEAN : AGENTS_MD_BLOATED;
  const alwaysOn = agentsMd + skillIndex + mcpSchemas + lspSchemas + crewIndex;
  const naiveAlwaysOn = AGENTS_MD_BLOATED + NAIVE_MCP + NAIVE_SKILLS + NAIVE_CREW + lspSchemas;

  const mcpPenalty = Math.max(0, config.mcps.length - 4) * 8;
  const skillPenalty = Math.max(0, config.skills.length - 8) * 4;
  const graphBonus = config.graphFirst ? 18 : 0;
  const discloseBonus = config.progressiveDisclosure ? 16 : 0;
  const singleBonus = config.defaultSingleAgent ? 10 : 0;
  const hookBonus = config.hooksEnabled ? 8 : 0;
  const crewBonus = config.crew.includes("auditor") && config.crew.includes("scout") ? 8 : 0;
  const leanScore = Math.max(
    12,
    Math.min(
      99,
      48 +
        graphBonus +
        discloseBonus +
        singleBonus +
        hookBonus +
        crewBonus -
        mcpPenalty -
        skillPenalty,
    ),
  );

  return {
    agentsMd,
    skillIndex,
    mcpSchemas,
    lspSchemas,
    crewIndex,
    alwaysOn,
    naiveAlwaysOn,
    leanScore,
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
