// MCP schema cost per platform. The static schema size is measured (tools/list
// captures); whether a client loads it into every request is a platform fact
// and follows the verification rule: only Claude Code's deferral is verified.
import { mcpSchemaTokens } from "./mcps.ts";
import { PLATFORM_BY_ID } from "./platforms.ts";
import type { HarnessConfig, PlatformId } from "./types";

export type DeferralStatus = "deferred" | "unverified";

type Deferral = {
  status: DeferralStatus;
  verifiedAt: string | null;
  source: string | null;
  note: string;
};

const UNVERIFIED: Deferral = {
  status: "unverified",
  verifiedAt: null,
  source: null,
  note: "deferral not verified: treat the full schema as loaded on every request",
};

export const MCP_DEFERRAL: Partial<Record<PlatformId, Deferral>> = {
  "claude-code": {
    status: "deferred",
    verifiedAt: "2026-10-09",
    source: "https://code.claude.com/docs/en/agent-sdk/tool-search.md",
    note:
      "tool search: definitions withheld from context by default (ENABLE_TOOL_SEARCH unset = on; " +
      "auto = only above 10% of the window; false = always loaded); one extra search round-trip " +
      "the first time a tool is discovered; Haiku models do not support it, so there the full " +
      "schema is loaded",
  },
};

export type McpCostRow = {
  platform: PlatformId;
  name: string;
  /** Measured/estimated schema tokens if the client loads everything. */
  schemaTokens: number;
  deferral: DeferralStatus;
  note: string;
  verifiedAt: string | null;
  source: string | null;
};

export function mcpCostByPlatform(config: HarnessConfig): McpCostRow[] {
  const schemaTokens = config.mcps.reduce((n, id) => n + mcpSchemaTokens(id).tokens, 0);
  return config.platforms.map((platform) => {
    const d = MCP_DEFERRAL[platform] ?? UNVERIFIED;
    return {
      platform,
      name: PLATFORM_BY_ID[platform].name,
      schemaTokens,
      deferral: d.status,
      note: d.note,
      verifiedAt: d.verifiedAt,
      source: d.source,
    };
  });
}
