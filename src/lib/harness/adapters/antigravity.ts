// Antigravity adapter. Vendor facts verified 2026-10-09:
//  Skills: https://antigravity.google/docs/skills (.agents/skills/<skill>/SKILL.md,
//    name/description frontmatter, progressive disclosure).
//  MCP: https://antigravity.google/docs/mcp (workspace .agents/mcp_config.json,
//    mcpServers key, serverUrl for remote — url/httpUrl not supported).
//  Subagents: https://antigravity.google/docs/subagents (.agents/agents/<name>.md,
//    required name + description, tools e.g. view_file/replace_file_content/grep_search/
//    run_command, subagent/mainAgent booleans, model inherit|flash|pro).
//  Rules: https://antigravity.google/docs/rules (AGENTS.md and GEMINI.md read natively,
//    no frontmatter, always_on — so no GEMINI.md pointer is emitted).
//  Hooks: https://antigravity.google/docs/hooks (.agents/hooks.json with PreToolUse/
//    PostToolUse/PreInvocation/PostInvocation/Stop; Stop returns {decision: continue}
//    with no stop_hook_active-style loop guard, so Helix emits no hooks file).
import { CREW_BY_ID } from "../crew.ts";
import { antigravityMcpJson } from "../mcps.ts";
import { SKILL_BY_ID } from "../skills.ts";
import type { HarnessConfig, PackFile } from "../types";
import { agentBody, skillFile } from "./parts.ts";
import type { PlatformAdapter } from "./types.ts";

/** Tool names documented on https://antigravity.google/docs/hooks (Supported tools). */
export const ANTIGRAVITY_TOOLS = [
  "view_file",
  "write_to_file",
  "replace_file_content",
  "multi_replace_file_content",
  "list_dir",
  "find_by_name",
  "grep_search",
  "search_web",
  "read_url_content",
  "run_command",
  "manage_task",
  "schedule",
  "list_permissions",
  "ask_permission",
  "invoke_subagent",
  "define_subagent",
  "send_message",
  "manage_subagents",
  "ask_question",
  "generate_image",
] as const;

type AntigravityTool = (typeof ANTIGRAVITY_TOOLS)[number];

const READ_ONLY: AntigravityTool[] = ["view_file", "grep_search", "find_by_name", "list_dir"];

/** Per-role tool allow-lists using only documented names. Builder alone writes or runs. */
function toolsFor(id: HarnessConfig["crew"][number]): AntigravityTool[] {
  switch (id) {
    case "builder":
      return [
        "view_file",
        "write_to_file",
        "replace_file_content",
        "multi_replace_file_content",
        "list_dir",
        "find_by_name",
        "grep_search",
        "run_command",
      ];
    case "architect":
      return ["view_file", "grep_search"];
    case "scout":
    case "reviewer":
      return [...READ_ONLY];
  }
}

/** Model tier per role, using only documented values. Crew tiers map haiku->flash,
 * opus->pro, sonnet->inherit (use the parent's model for the main build role). */
function modelFor(id: HarnessConfig["crew"][number]): string {
  const m = CREW_BY_ID[id].model;
  if (m === "haiku") return "flash";
  if (m === "opus") return "pro";
  return "inherit";
}

function agentMd(id: HarnessConfig["crew"][number]): string {
  const c = CREW_BY_ID[id];
  const tools = toolsFor(id);
  const lines = [
    "---",
    `name: ${c.id}`,
    `description: ${c.oneLiner}`,
    "subagent: true",
    "mainAgent: false",
    `model: ${modelFor(id)}`,
    "tools:",
    ...tools.map((t) => `  - ${t}`),
    "---",
    "",
    agentBody(id),
  ];
  return lines.join("\n");
}

export const antigravityAdapter: PlatformAdapter = {
  id: "antigravity",
  verifiedAt: "2026-10-09",
  sources: [
    { title: "Antigravity skills", url: "https://antigravity.google/docs/skills" },
    { title: "Antigravity MCP", url: "https://antigravity.google/docs/mcp" },
    { title: "Antigravity subagents", url: "https://antigravity.google/docs/subagents" },
    { title: "Antigravity rules", url: "https://antigravity.google/docs/rules" },
    { title: "Antigravity hooks", url: "https://antigravity.google/docs/hooks" },
  ],
  supportsSubagents: true,
  supportsSkills: true,
  capabilities: {
    instructions: "emitted",
    mcp: "emitted",
    skills: "emitted",
    subagents: "emitted",
    hooks: "supported",
    plugin: "unverified",
  },
  notes:
    "AGENTS.md is read natively (no GEMINI.md pointer). Skills in .agents/skills, MCP in " +
    ".agents/mcp_config.json (serverUrl for remote). Subagents are .agents/agents/<id>.md " +
    "(name, description, tools, subagent/mainAgent, model inherit|flash|pro; builder alone " +
    "writes and runs). Hooks verified but not emitted: the Stop protocol has no loop guard " +
    "to rely on. Plugins were not checked.",
  files(config: HarnessConfig) {
    const files: PackFile[] = [];
    for (const cid of config.crew) {
      files.push({ path: `.agents/agents/${cid}.md`, language: "markdown", body: agentMd(cid) });
    }
    for (const sid of config.skills) {
      files.push({
        path: `.agents/skills/${SKILL_BY_ID[sid].name}/SKILL.md`,
        language: "markdown",
        body: skillFile(sid),
      });
    }
    files.push({
      path: ".agents/mcp_config.json",
      language: "json",
      body: antigravityMcpJson(config.mcps),
    });
    return files;
  },
};
