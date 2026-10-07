import type { PlatformId } from "./types";

export type Platform = {
  id: PlatformId;
  name: string;
  family: "agents-md" | "claude" | "cursor" | "copilot" | "gemini" | "aider" | "rules-file";
  files: string[];
  notes: string;
};

export const PLATFORMS: Platform[] = [
  {
    id: "claude-code",
    name: "Claude Code",
    family: "claude",
    files: ["AGENTS.md", "CLAUDE.md", ".claude/agents/*.md", ".claude/skills/*/SKILL.md", ".mcp.json", ".claude/settings.json"],
    notes: "Subagents in .claude/agents. Skills as SKILL.md. Hooks in settings.json. CLAUDE.md is a one-liner that points at AGENTS.md.",
  },
  {
    id: "cursor",
    name: "Cursor",
    family: "cursor",
    files: ["AGENTS.md", ".cursor/rules/helix.mdc", ".cursor/mcp.json"],
    notes: "Project rules in .cursor/rules. MCP from .cursor/mcp.json. Agent reads AGENTS.md natively.",
  },
  {
    id: "codex",
    name: "Codex",
    family: "agents-md",
    files: ["AGENTS.md", ".mcp.json", "skills/*/SKILL.md"],
    notes: "AGENTS.md is the entry. Graphify skill is invoked as $graphify rather than /graphify.",
  },
  {
    id: "gemini",
    name: "Gemini CLI",
    family: "gemini",
    files: ["AGENTS.md", "GEMINI.md", ".gemini/settings.json"],
    notes: "GEMINI.md points at AGENTS.md. Skills from the Google skills repo load on demand.",
  },
  {
    id: "copilot",
    name: "GitHub Copilot",
    family: "copilot",
    files: ["AGENTS.md", ".github/copilot-instructions.md", ".vscode/mcp.json"],
    notes: "copilot-instructions.md is a short pointer. MCP via VS Code mcp.json. Graphify has an official VS Code plugin.",
  },
  {
    id: "windsurf",
    name: "Windsurf",
    family: "rules-file",
    files: ["AGENTS.md", ".windsurf/rules/helix.md"],
    notes: "Cascade reads AGENTS.md plus .windsurf rules. Keep the rule file a pointer, not a second manual.",
  },
  {
    id: "cline",
    name: "Cline",
    family: "rules-file",
    files: ["AGENTS.md", ".clinerules"],
    notes: ".clinerules is the always-on layer. Helix writes a short pointer there so the two files cannot drift.",
  },
  {
    id: "aider",
    name: "Aider",
    family: "aider",
    files: ["AGENTS.md", "CONVENTIONS.md"],
    notes: "CONVENTIONS.md is Aider's always-on file. Helix keeps it under 80 lines and defers to AGENTS.md.",
  },
  {
    id: "opencode",
    name: "OpenCode",
    family: "agents-md",
    files: ["AGENTS.md", ".mcp.json", "skills/*/SKILL.md"],
    notes: "AGENTS.md + MCP. Same pack as Codex.",
  },
  {
    id: "antigravity",
    name: "Google Antigravity",
    family: "gemini",
    files: ["AGENTS.md", "GEMINI.md"],
    notes: "/boost is the native orchestrator. Helix's Conductor maps onto it; do not run two orchestrators.",
  },
  {
    id: "devin",
    name: "Devin CLI",
    family: "agents-md",
    files: ["AGENTS.md", ".mcp.json"],
    notes: "Repo-root AGENTS.md is picked up. Keep the crew descriptions to one sentence each.",
  },
  {
    id: "factory",
    name: "Factory Droid",
    family: "agents-md",
    files: ["AGENTS.md", "skills/*/SKILL.md"],
    notes: "Skills in Agent Skills format. Graphify install --platform factory.",
  },
  {
    id: "kiro",
    name: "Kiro",
    family: "agents-md",
    files: ["AGENTS.md", ".mcp.json"],
    notes: "AGENTS.md family. Enable Graphify MCP for graph queries.",
  },
  {
    id: "amp",
    name: "Amp",
    family: "agents-md",
    files: ["AGENTS.md", ".mcp.json"],
    notes: "Sourcegraph Amp reads AGENTS.md. Pair with Graphify rather than extra search MCPs.",
  },
  {
    id: "kilo",
    name: "Kilo Code",
    family: "agents-md",
    files: ["AGENTS.md", "skills/*/SKILL.md", ".mcp.json"],
    notes: "Graphify install --platform kilo. Same skill layout as Claude.",
  },
];

export const PLATFORM_BY_ID = Object.fromEntries(
  PLATFORMS.map((p) => [p.id, p]),
) as Record<PlatformId, Platform>;

export const DEFAULT_PLATFORMS: PlatformId[] = [
  "claude-code",
  "cursor",
  "codex",
  "gemini",
  "copilot",
];
