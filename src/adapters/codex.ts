import { codexToml } from "../mcps.ts";
import { SKILL_BY_ID } from "../skills.ts";
import type { HarnessConfig } from "../types";
import { skillFile } from "./parts.ts";
import type { PlatformAdapter } from "./types.ts";

export const codexAdapter: PlatformAdapter = {
  id: "codex",
  verifiedAt: "2026-10-07",
  sources: [
    { title: "Codex MCP docs", url: "https://developers.openai.com/codex/mcp" },
    { title: "Codex skills docs", url: "https://developers.openai.com/codex/skills" },
    {
      title: "Codex customization",
      url: "https://developers.openai.com/codex/concepts/customization",
    },
  ],
  supportsSubagents: true,
  supportsSkills: true,
  capabilities: {
    instructions: "emitted",
    mcp: "emitted",
    skills: "emitted",
    subagents: "supported",
    hooks: "unverified",
    plugin: "unverified",
  },
  notes:
    "Repo skills live in .agents/skills (not skills/). MCP goes in .codex/config.toml under " +
    "[mcp_servers.*] (project scope is trusted-projects only) — never .mcp.json. " +
    "Subagent support confirmed; Helix roles map onto sequential prompts until a " +
    "subagent layout is verified.",
  files(config: HarnessConfig) {
    const files = [];
    for (const sid of config.skills) {
      files.push({
        path: `.agents/skills/${SKILL_BY_ID[sid].name}/SKILL.md`,
        language: "markdown",
        body: skillFile(sid),
      });
    }
    files.push({ path: ".codex/config.toml", language: "toml", body: codexToml(config.mcps) });
    return files;
  },
};
