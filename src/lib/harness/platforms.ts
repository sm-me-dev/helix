import { ADAPTER_BY_ID } from "./adapters/index.ts";
import { CAPABILITIES } from "./adapters/types.ts";
import type { AdapterSource, CapabilityMatrix } from "./adapters/types.ts";
import type { PlatformId } from "./types";

export type Platform = {
  id: PlatformId;
  name: string;
  family: "agents-md" | "claude" | "cursor" | "copilot" | "gemini" | "aider" | "rules-file";
  files: string[];
  notes: string;
  verifiedAt: string | null;
  sources: AdapterSource[];
  capabilities: CapabilityMatrix;
};

function entry(
  id: PlatformId,
  name: string,
  family: Platform["family"],
  files: string[],
  notes: string,
): Platform {
  const adapter = ADAPTER_BY_ID[id];
  return {
    id,
    name,
    family,
    files,
    notes: `${notes} ${adapter.notes}`,
    verifiedAt: adapter.verifiedAt,
    sources: adapter.sources,
    capabilities: adapter.capabilities,
  };
}

export const PLATFORMS: Platform[] = [
  entry(
    "claude-code",
    "Claude Code",
    "claude",
    [
      "AGENTS.md",
      "CLAUDE.md",
      ".claude/agents/*.md",
      ".claude/skills/*/SKILL.md",
      ".mcp.json",
      ".claude/settings.json",
      ".helix/hooks/*.mjs",
    ],
    "Full native support: subagents, skills, hooks, project MCP.",
  ),
  entry(
    "cursor",
    "Cursor",
    "cursor",
    ["AGENTS.md", ".cursor/rules/helix.mdc", ".cursor/mcp.json"],
    "Rules plus project MCP. Agent reads AGENTS.md natively.",
  ),
  entry(
    "codex",
    "Codex",
    "agents-md",
    [
      "AGENTS.md",
      ".agents/skills/*/SKILL.md",
      ".codex/config.toml",
      ".codex/agents/*.toml",
      ".codex/hooks.json",
      ".helix/hooks/codex-stop.mjs",
    ],
    "AGENTS.md is the entry. MCP lives in config.toml, skills in .agents/skills.",
  ),
  entry(
    "gemini",
    "Gemini CLI",
    "gemini",
    ["AGENTS.md", "GEMINI.md"],
    "Pointer only. Press reports (9to5google, 2026-06-17) say Gemini CLI was shut down for consumer tiers on 2026-06-18 in favor of Antigravity CLI; not checked against a Google primary page.",
  ),
  entry(
    "copilot",
    "GitHub Copilot",
    "copilot",
    ["AGENTS.md", ".github/copilot-instructions.md", ".vscode/mcp.json"],
    "Short pointer plus VS Code MCP (servers key).",
  ),
  entry(
    "windsurf",
    "Windsurf",
    "rules-file",
    ["AGENTS.md", ".windsurf/rules/helix.md"],
    "Pointer only.",
  ),
  entry("cline", "Cline", "rules-file", ["AGENTS.md", ".clinerules"], "Pointer only."),
  entry("aider", "Aider", "aider", ["AGENTS.md", "CONVENTIONS.md"], "Pointer only."),
  entry("opencode", "OpenCode", "agents-md", ["AGENTS.md"], "Instructions file only."),
  entry(
    "antigravity",
    "Google Antigravity",
    "gemini",
    ["AGENTS.md", ".agents/skills/*/SKILL.md", ".agents/mcp_config.json", ".agents/agents/*.md"],
    "AGENTS.md is read natively. Skills, MCP and subagents verified 2026-10-09; hooks verified but not emitted (no Stop loop guard).",
  ),
  entry("devin", "Devin CLI", "agents-md", ["AGENTS.md"], "Instructions file only."),
  entry("factory", "Factory Droid", "agents-md", ["AGENTS.md"], "Instructions file only."),
  entry("kiro", "Kiro", "agents-md", ["AGENTS.md"], "Instructions file only."),
  entry("amp", "Amp", "agents-md", ["AGENTS.md"], "Instructions file only."),
  entry("kilo", "Kilo Code", "agents-md", ["AGENTS.md"], "Instructions file only."),
];

export const PLATFORM_BY_ID = Object.fromEntries(PLATFORMS.map((p) => [p.id, p])) as Record<
  PlatformId,
  Platform
>;

export const DEFAULT_PLATFORMS: PlatformId[] = [
  "claude-code",
  "cursor",
  "codex",
  "gemini",
  "copilot",
];

const CELL = {
  emitted: "emitted",
  supported: "supported, not emitted",
  unverified: "unverified",
} as const;

/** The README's platform matrix. Generated, never hand-edited: a test fails
 * when README.md drifts from this output. */
export function platformMatrixMarkdown(): string {
  const head = `| Platform | verified | ${CAPABILITIES.join(" | ")} |`;
  const sep = `| --- | --- | ${CAPABILITIES.map(() => "---").join(" | ")} |`;
  const rows = PLATFORMS.map(
    (p) =>
      `| ${p.name} | ${p.verifiedAt ?? "no"} | ${CAPABILITIES.map((c) => CELL[p.capabilities[c]]).join(" | ")} |`,
  );
  return [head, sep, ...rows].join("\n");
}
