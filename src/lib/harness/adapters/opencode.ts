import { openCodeMcpJson } from "../mcps.ts";
import { SKILL_BY_ID } from "../skills.ts";
import type { HarnessConfig, PackFile } from "../types";
import { agentBody, skillFile } from "./parts.ts";
import type { PlatformAdapter } from "./types.ts";

function agentFile(id: HarnessConfig["crew"][number]): string {
  const definitions = {
    scout: {
      description: "Use when the change surface is unknown; return cited context, not a design.",
      permissions: ["  edit: deny", "  bash: deny"],
    },
    architect: {
      description: "Compare implementation options and write a file-level plan; do not edit files.",
      permissions: ["  edit: deny", "  bash: deny"],
    },
    builder: {
      description: "Implement an accepted plan, write focused tests, and run the repository checks.",
      permissions: [],
    },
    reviewer: {
      description: "Independently review the diff and test evidence; never repair the patch.",
      permissions: ["  edit: deny", "  bash: ask"],
    },
  } as const;
  const definition = definitions[id];
  return [
    "---",
    "description: " + definition.description,
    "mode: subagent",
    ...(definition.permissions.length ? ["permission:", ...definition.permissions] : []),
    "---",
    "",
    agentBody(id),
  ].join("\n") + "\n";
}

export const opencodeAdapter: PlatformAdapter = {
  id: "opencode",
  verifiedAt: "2026-10-09",
  sources: [
    { title: "OpenCode agents", url: "https://opencode.ai/docs/agents/" },
    { title: "OpenCode skills", url: "https://opencode.ai/docs/skills/" },
    { title: "OpenCode MCP servers", url: "https://opencode.ai/docs/mcp-servers/" },
    { title: "OpenCode rules", url: "https://opencode.ai/docs/rules/" },
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
  },
  notes:
    "Repo instructions use AGENTS.md; custom subagents live in .opencode/agents/<name>.md, " +
    "skills in .opencode/skills/<name>/SKILL.md, and MCP servers in opencode.json under mcp. " +
    "The CLI merges Helix MCP entries into an existing opencode.json, preserves unrelated " +
    "settings, and keeps same-name user server definitions. A downloaded pack's opencode.json " +
    "is a fragment that must be merged manually. Hooks/plugins are not emitted.",
  files(config: HarnessConfig): PackFile[] {
    const files: PackFile[] = [];
    for (const cid of config.crew) {
      files.push({
        path: ".opencode/agents/" + cid + ".md",
        language: "markdown",
        body: agentFile(cid),
      });
    }
    for (const sid of config.skills) {
      files.push({
        path: ".opencode/skills/" + SKILL_BY_ID[sid].name + "/SKILL.md",
        language: "markdown",
        body: skillFile(sid),
      });
    }
    if (config.mcps.length > 0) {
      files.push({
        path: "opencode.json",
        language: "json",
        body: openCodeMcpJson(config.mcps),
      });
    }
    return files;
  },
};
