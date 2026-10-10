import { portableMcpJson } from "../mcps.ts";
import { SKILL_BY_ID } from "../skills.ts";
import type { HarnessConfig } from "../types";
import { agentBody, cursorRule, skillFile } from "./parts.ts";
import type { PlatformAdapter } from "./types.ts";

function cursorAgent(id: HarnessConfig["crew"][number]): string {
  const descriptions: Record<HarnessConfig["crew"][number], string> = {
    scout: "Scout the codebase and return a graph-cited context brief; do not design or implement.",
    architect: "Plan non-trivial changes and explain tradeoffs; do not edit files.",
    builder: "Implement the accepted plan and run the relevant checks.",
    reviewer: "Independently review the diff and verification evidence; do not edit files.",
  };
  return [
    "---",
    "name: " + id,
    "description: " + descriptions[id],
    "model: inherit",
    "readonly: " + (id !== "builder"),
    "---",
    "",
    agentBody(id),
  ].join("\n");
}

export const cursorAdapter: PlatformAdapter = {
  id: "cursor",
  verifiedAt: "2026-10-09",
  sources: [
    { title: "Cursor MCP docs", url: "https://cursor.com/docs/mcp" },
    { title: "Cursor rules docs", url: "https://cursor.com/docs/rules" },
    { title: "Cursor subagents docs", url: "https://cursor.com/docs/subagents" },
    { title: "Cursor skills docs", url: "https://cursor.com/help/customization/skills" },
  ],
  supportsSubagents: true,
  supportsSkills: true,
  capabilities: {
    instructions: "emitted",
    mcp: "emitted",
    skills: "emitted",
    subagents: "emitted",
    hooks: "unverified",
    plugin: "unverified",
    "structured-output": "unverified",
    "session-continuation": "unverified",
    sandboxing: "unverified",
    lsp: "unverified",
  },
  notes:
    "Project rules in .cursor/rules/*.mdc; custom agents in .cursor/agents/*.md; " +
    "skills in .cursor/skills/<name>/SKILL.md; project MCP in .cursor/mcp.json. " +
    "Role model selection inherits the user's configured model to avoid stale vendor-specific IDs. " +
    "Hooks and plugins are not emitted because their portable project setup was not verified.",
  files(config: HarnessConfig) {
    const files = [
      { path: ".cursor/rules/helix.mdc", language: "markdown", body: cursorRule(config) },
      { path: ".cursor/mcp.json", language: "json", body: portableMcpJson(config.mcps) },
    ];
    for (const cid of config.crew) {
      files.push({
        path: ".cursor/agents/" + cid + ".md",
        language: "markdown",
        body: cursorAgent(cid),
      });
    }
    for (const sid of config.skills) {
      files.push({
        path: ".cursor/skills/" + SKILL_BY_ID[sid].name + "/SKILL.md",
        language: "markdown",
        body: skillFile(sid),
      });
    }
    return files;
  },
};
