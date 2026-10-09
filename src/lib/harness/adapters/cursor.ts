import { portableMcpJson } from "../mcps.ts";
import type { HarnessConfig } from "../types";
import { cursorRule } from "./parts.ts";
import type { PlatformAdapter } from "./types.ts";

export const cursorAdapter: PlatformAdapter = {
  id: "cursor",
  verifiedAt: "2026-10-07",
  sources: [
    { title: "Cursor MCP docs", url: "https://cursor.com/docs/mcp" },
    { title: "Cursor rules docs", url: "https://cursor.com/docs/rules" },
  ],
  supportsSubagents: false,
  supportsSkills: false,
  capabilities: {
    instructions: "emitted",
    mcp: "emitted",
    skills: "unverified",
    subagents: "unverified",
    hooks: "unverified",
    plugin: "unverified",
  },
  notes:
    "Project rules in .cursor/rules (*.mdc with frontmatter). Project MCP in .cursor/mcp.json " +
    "under mcpServers. Cursor reads AGENTS.md natively. Custom-agent and project-skill paths " +
    "were not verified, so the crew runs as sequential prompts here and no skills are emitted.",
  files(config: HarnessConfig) {
    return [
      { path: ".cursor/rules/helix.mdc", language: "markdown", body: cursorRule(config) },
      { path: ".cursor/mcp.json", language: "json", body: portableMcpJson(config.mcps) },
    ];
  },
};
