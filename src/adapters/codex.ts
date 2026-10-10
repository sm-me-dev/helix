import { CREW_BY_ID } from "../crew.ts";
import { HOOK_SOURCES } from "../hooks.ts";
import { codexToml } from "../mcps.ts";
import { SKILL_BY_ID } from "../skills.ts";
import type { HarnessConfig, PackFile } from "../types";
import { agentBody, skillFile } from "./parts.ts";
import type { PlatformAdapter } from "./types.ts";

/** One custom agent per crew role: `.codex/agents/<id>.toml`. The three required fields are
 * name, description and developer_instructions. `model` is left out on purpose so the agent
 * inherits the parent's model (documented behavior); vendor model slugs change too often to
 * pin. Roles without Edit/Write get `sandbox_mode = "read-only"`; everything else inherits
 * from the parent. Verified 2026-10-09 against
 * https://learn.chatgpt.com/docs/agent-configuration/subagents. */
function codexAgentToml(id: HarnessConfig["crew"][number]): string {
  const c = CREW_BY_ID[id];
  const readOnly = !c.tools.some((t) => t === "Edit" || t === "Write");
  const body = agentBody(id).trimEnd().replaceAll("'''", "' ' '");
  return [
    `name = ${JSON.stringify(c.id)}`,
    `description = ${JSON.stringify(c.oneLiner)}`,
    ...(readOnly ? ['sandbox_mode = "read-only"'] : []),
    "developer_instructions = '''",
    body,
    "'''",
    "",
  ].join("\n");
}

/** `.codex/hooks.json`: one Stop hook. Resolves the script from the git root because Codex may
 * start in a subdirectory. Project hooks run only in trusted projects and only after the user
 * reviews them in /hooks. Verified 2026-10-09 against https://learn.chatgpt.com/docs/hooks. */
function codexHooksJson(): string {
  return (
    JSON.stringify(
      {
        description: "Helix: run the portable gate when a turn ends with uncommitted changes.",
        hooks: {
          Stop: [
            {
              hooks: [
                {
                  type: "command",
                  command: 'node "$(git rev-parse --show-toplevel)/.helix/hooks/codex-stop.mjs"',
                  timeout: 120,
                  statusMessage: "Running Helix gate",
                },
              ],
            },
          ],
        },
      },
      null,
      2,
    ) + "\n"
  );
}

export const codexAdapter: PlatformAdapter = {
  id: "codex",
  verifiedAt: "2026-10-09",
  sources: [
    {
      title: "Codex subagents",
      url: "https://learn.chatgpt.com/docs/agent-configuration/subagents",
    },
    { title: "Codex hooks", url: "https://learn.chatgpt.com/docs/hooks" },
    {
      title: "Codex AGENTS.md",
      url: "https://learn.chatgpt.com/docs/agent-configuration/agents-md",
    },
    { title: "Codex MCP", url: "https://learn.chatgpt.com/docs/extend/mcp" },
    { title: "Codex skills docs", url: "https://developers.openai.com/codex/skills" },
  ],
  supportsSubagents: true,
  supportsSkills: true,
  capabilities: {
    instructions: "emitted",
    mcp: "emitted",
    skills: "emitted",
    subagents: "emitted",
    hooks: "emitted",
    plugin: "unverified",
    "structured-output": "unverified",
    "session-continuation": "unverified",
    sandboxing: "unverified",
    lsp: "unverified",
  },
  notes:
    "Skills in .agents/skills. MCP in .codex/config.toml under [mcp_servers.*] (project scope is " +
    "trusted-projects only), never .mcp.json. Custom agents are .codex/agents/<id>.toml " +
    "(name, description, developer_instructions; model inherited, read-only sandbox for " +
    "roles without edit tools). Hooks: only a Stop hook that runs the gate on uncommitted " +
    "changes; prefer-graph and format-lint are not emitted because Codex has no Read/Grep/" +
    "Glob tools and passes edits as an apply_patch command, not a file path. Codex asks you " +
    "to review new hooks in /hooks before they run. Plugins were not checked.",
  files(config: HarnessConfig) {
    const files: PackFile[] = [];
    for (const cid of config.crew) {
      files.push({
        path: `.codex/agents/${cid}.toml`,
        language: "toml",
        body: codexAgentToml(cid),
      });
    }
    for (const sid of config.skills) {
      files.push({
        path: `.agents/skills/${SKILL_BY_ID[sid].name}/SKILL.md`,
        language: "markdown",
        body: skillFile(sid),
      });
    }
    files.push({ path: ".codex/config.toml", language: "toml", body: codexToml(config.mcps) });
    if (config.hooksEnabled) {
      files.push({ path: ".codex/hooks.json", language: "json", body: codexHooksJson() });
      files.push({
        path: ".helix/hooks/codex-stop.mjs",
        language: "javascript",
        body: HOOK_SOURCES["codex-stop"],
      });
    }
    return files;
  },
};
