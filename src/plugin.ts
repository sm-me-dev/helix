// Claude Code plugin packaging (F2). Emits a marketplace directory holding one plugin, built
// from the same crew, skills, MCP and hook sources the repo pack uses.
//
// Contract verified against vendor docs on 2026-10-10 (source + date in docs/DECISIONS.md):
//   https://code.claude.com/docs/en/plugins-reference        manifest, layout, path rules
//   https://code.claude.com/docs/en/plugins/components       agents, hooks, MCP, settings.json
//   https://code.claude.com/docs/en/plugin-marketplaces      marketplace.json
//   https://code.claude.com/docs/en/hooks                    hook merge and parallelism
// What a plugin CANNOT carry, so `helix init --claude-plugin` keeps it in the repo:
//   - CLAUDE.md at the plugin root is not loaded as context (repo facts stay in AGENTS.md).
//   - settings.json in a plugin honors only `agent` and `subagentStatusLine`, so the
//     fail-closed `permissions.deny` secret rules must live in the repo's .claude/settings.json.
import { portableMcpJson } from "./mcps.ts";
import { SKILL_BY_ID } from "./skills.ts";
import type { HarnessConfig, PackFile } from "./types.ts";
import {
  agentFile,
  formatHintHook,
  preferGraphHook,
  skillFile,
  testOnStopHook,
} from "./adapters/parts.ts";

export const PLUGIN_NAME = "helix";
export const MARKETPLACE_NAME = "helix-harness";
export const PLUGIN_VERSION = "0.1.0";
const OWNER = "sm-me-dev";
const REPOSITORY = "https://github.com/sm-me-dev/helix";
const DESCRIPTION =
  "Helix harness for Claude Code: lean skills, scoped subagents and deterministic hooks. " +
  "Repo facts and the test gate stay in AGENTS.md (run `helix init --claude-plugin`).";

const ROOT = `plugins/${PLUGIN_NAME}`;
const json = (v: unknown) => JSON.stringify(v, null, 2) + "\n";

/** A plugin-bundled MCP server's tools are named mcp__plugin_<plugin>_<server>__<tool>, not
 * mcp__<server>__<tool> (components docs, "Server names, tool names, and reloads"). */
export function scopeMcpTool(tool: string): string {
  // Any character outside A-Z a-z 0-9 _ - in the server key becomes "_" (mcp docs,
  // "Plugin MCP tool names", verified 2026-10-10).
  return tool.replace(
    /^mcp__(.+?)__/,
    (_m, server: string) =>
      `mcp__plugin_${PLUGIN_NAME}_${server.replace(/[^A-Za-z0-9_-]/g, "_")}__`,
  );
}

function scopeToolNames(agent: string): string {
  return agent.replace(/^tools: (.*)$/m, (_m, list: string) => {
    return `tools: ${list.split(", ").map(scopeMcpTool).join(", ")}`;
  });
}

function hooksFile(config: HarnessConfig): string {
  if (!config.hooksEnabled) return json({ hooks: {} });
  // Exec form: command plus args, no shell, no quoting of ${CLAUDE_PLUGIN_ROOT}.
  const run = (name: string) => ({
    type: "command",
    command: "node",
    args: [`\${CLAUDE_PLUGIN_ROOT}/hooks/${name}.mjs`],
  });
  const hooks: Record<string, unknown[]> = {
    PostToolUse: [{ matcher: "Edit|Write", hooks: [run("format-lint")] }],
    Stop: [{ hooks: [run("test-on-stop")] }],
  };
  if (config.graphFirst) {
    hooks.PreToolUse = [{ matcher: "Read|Grep|Glob", hooks: [run("prefer-graph")] }];
  }
  return json({ hooks });
}

export function pluginPack(config: HarnessConfig, opts: { version?: string } = {}): PackFile[] {
  const files: PackFile[] = [
    {
      path: ".claude-plugin/marketplace.json",
      language: "json",
      body: json({
        name: MARKETPLACE_NAME,
        description: DESCRIPTION,
        owner: { name: OWNER },
        plugins: [{ name: PLUGIN_NAME, source: `./${ROOT}`, description: DESCRIPTION }],
      }),
    },
    {
      path: `${ROOT}/.claude-plugin/plugin.json`,
      language: "json",
      body: json({
        name: PLUGIN_NAME,
        version: opts.version ?? PLUGIN_VERSION,
        description: DESCRIPTION,
        author: { name: OWNER },
        repository: REPOSITORY,
      }),
    },
  ];
  for (const sid of config.skills) {
    files.push({
      path: `${ROOT}/skills/${SKILL_BY_ID[sid].name}/SKILL.md`,
      language: "markdown",
      body: skillFile(sid),
    });
  }
  for (const cid of config.crew) {
    files.push({
      path: `${ROOT}/agents/${cid}.md`,
      language: "markdown",
      body: scopeToolNames(agentFile(cid, config, { plugin: true })),
    });
  }
  files.push({ path: `${ROOT}/hooks/hooks.json`, language: "json", body: hooksFile(config) });
  if (config.hooksEnabled) {
    files.push({
      path: `${ROOT}/hooks/format-lint.mjs`,
      language: "javascript",
      body: formatHintHook(),
    });
    files.push({
      path: `${ROOT}/hooks/test-on-stop.mjs`,
      language: "javascript",
      body: testOnStopHook(),
    });
    if (config.graphFirst) {
      files.push({
        path: `${ROOT}/hooks/prefer-graph.mjs`,
        language: "javascript",
        body: preferGraphHook(),
      });
    }
  }
  files.push({ path: `${ROOT}/.mcp.json`, language: "json", body: portableMcpJson(config.mcps) });
  return files;
}
