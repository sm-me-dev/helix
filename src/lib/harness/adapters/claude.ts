import { portableMcpJson } from "../mcps.ts";
import { SKILL_BY_ID } from "../skills.ts";
import type { HarnessConfig } from "../types";
import {
  agentFile,
  formatHintHook,
  hooksJson,
  permissionsOnlyJson,
  pointer,
  preferGraphHook,
  skillFile,
  testOnStopHook,
} from "./parts.ts";
import type { PlatformAdapter } from "./types.ts";

function hookFiles(): { path: string; language: string; body: string }[] {
  return [
    { path: ".helix/hooks/prefer-graph.mjs", language: "javascript", body: preferGraphHook() },
    { path: ".helix/hooks/format-lint.mjs", language: "javascript", body: formatHintHook() },
    { path: ".helix/hooks/test-on-stop.mjs", language: "javascript", body: testOnStopHook() },
  ];
}

export const claudeAdapter: PlatformAdapter = {
  id: "claude-code",
  verifiedAt: "2026-10-10",
  sources: [
    {
      title: "Claude Code plugin manifest",
      url: "https://code.claude.com/docs/en/plugins-reference",
    },
    {
      title: "Claude Code plugin components",
      url: "https://code.claude.com/docs/en/plugins/components",
    },
    {
      title: "Claude Code plugin marketplaces",
      url: "https://code.claude.com/docs/en/plugin-marketplaces",
    },
    { title: "Claude Code MCP", url: "https://code.claude.com/docs/en/mcp" },
    { title: "Claude Code subagents", url: "https://code.claude.com/docs/en/subagents" },
    { title: "Claude Code skills", url: "https://code.claude.com/docs/en/skills" },
    { title: "Claude Code hooks", url: "https://code.claude.com/docs/en/hooks" },
    { title: "Claude Code MCP quickstart", url: "https://code.claude.com/docs/en/mcp-quickstart" },
  ],
  supportsSubagents: true,
  supportsSkills: true,
  capabilities: {
    instructions: "emitted",
    mcp: "emitted",
    skills: "emitted",
    subagents: "emitted",
    hooks: "emitted",
    plugin: "emitted",
    "structured-output": "unverified",
    "session-continuation": "unverified",
    sandboxing: "unverified",
    lsp: "unverified",
  },
  notes:
    "Subagents in .claude/agents with tools allow-list and model tier in frontmatter. " +
    "Skills as .claude/skills/*/SKILL.md. Hooks in .claude/settings.json. Project MCP in " +
    ".mcp.json under mcpServers. CLAUDE.md points at AGENTS.md. No conductor file: the " +
    "main session is the orchestrator. Plugin (`helix plugin`, verified 2026-10-10): agents, " +
    "skills, hooks and .mcp.json ship in the plugin; `helix init --claude-plugin` keeps only " +
    "CLAUDE.md, AGENTS.md, the gate and the secret denies, because a plugin cannot carry " +
    "CLAUDE.md or permissions.",
  files(config: HarnessConfig) {
    const files = [{ path: "CLAUDE.md", language: "markdown", body: pointer("Claude Code") }];
    if (config.claudePlugin) {
      // The plugin supplies agents, skills, hooks and MCP. Only what a plugin cannot ship stays.
      files.push({
        path: ".claude/settings.json",
        language: "json",
        body: permissionsOnlyJson(),
      });
      return files;
    }
    for (const cid of config.crew) {
      files.push({
        path: `.claude/agents/${cid}.md`,
        language: "markdown",
        body: agentFile(cid, config),
      });
    }
    for (const sid of config.skills) {
      files.push({
        path: `.claude/skills/${SKILL_BY_ID[sid].name}/SKILL.md`,
        language: "markdown",
        body: skillFile(sid),
      });
    }
    files.push({ path: ".claude/settings.json", language: "json", body: hooksJson(config) });
    files.push({ path: ".mcp.json", language: "json", body: portableMcpJson(config.mcps) });
    if (config.hooksEnabled) files.push(...hookFiles());
    return files;
  },
};
