// Pointer/instructions-only adapters for platforms whose native subagent,
// skill, or MCP paths were NOT verified on 2026-10-07. Each emits at most
// one pointer file; the crew runs as sequential prompts there.
import type { HarnessConfig, PackFile, PlatformId } from "../types";
import { clinerules, conventionsMd, pointer, windsurfRule } from "./parts.ts";
import type { PlatformAdapter } from "./types.ts";

const UNVERIFIED_NOTE =
  "Not re-verified against vendor docs on 2026-10-07: the crew runs as sequential " +
  "prompts here, and no MCP/skill paths are emitted until verified.";

function pointerAdapter(
  id: PlatformId,
  path: string,
  language: string,
  body: () => string,
  extraNotes: string,
): PlatformAdapter {
  return {
    id,
    verifiedAt: null,
    sources: [],
    supportsSubagents: false,
    supportsSkills: false,
    capabilities: {
      instructions: "unverified",
      mcp: "unverified",
      skills: "unverified",
      subagents: "unverified",
      hooks: "unverified",
      plugin: "unverified",
    },
    notes: `${extraNotes} ${UNVERIFIED_NOTE}`,
    files(_config: HarnessConfig): PackFile[] {
      return [{ path, language, body: body() }];
    },
  };
}

function instructionsOnly(id: PlatformId, extraNotes: string): PlatformAdapter {
  return {
    id,
    verifiedAt: null,
    sources: [],
    supportsSubagents: false,
    supportsSkills: false,
    capabilities: {
      instructions: "unverified",
      mcp: "unverified",
      skills: "unverified",
      subagents: "unverified",
      hooks: "unverified",
      plugin: "unverified",
    },
    notes: `${extraNotes} Root AGENTS.md is the instructions file. ${UNVERIFIED_NOTE}`,
    files(_config: HarnessConfig): PackFile[] {
      return [];
    },
  };
}

export const geminiAdapter = pointerAdapter(
  "gemini",
  "GEMINI.md",
  "markdown",
  () => pointer("Gemini"),
  "GEMINI.md points at AGENTS.md.",
);

export const windsurfAdapter = pointerAdapter(
  "windsurf",
  ".windsurf/rules/helix.md",
  "markdown",
  windsurfRule,
  "Pointer rule file; kept short so it cannot drift from AGENTS.md.",
);

export const clineAdapter = pointerAdapter(
  "cline",
  ".clinerules",
  "markdown",
  clinerules,
  "Pointer file; the two files cannot drift by construction.",
);

export const aiderAdapter = pointerAdapter(
  "aider",
  "CONVENTIONS.md",
  "markdown",
  conventionsMd,
  "Pointer file defers to AGENTS.md.",
);

export const devinAdapter = instructionsOnly(
  "devin",
  "Repo-root AGENTS.md is picked up; MCP/skill paths not verified.",
);

export const factoryAdapter = instructionsOnly(
  "factory",
  "Agent Skills format assumed but install path not verified.",
);

export const kiroAdapter = instructionsOnly(
  "kiro",
  "AGENTS.md family; MCP/skill paths not verified.",
);

export const ampAdapter = instructionsOnly("amp", "Reads AGENTS.md; MCP/skill paths not verified.");

export const kiloAdapter = instructionsOnly(
  "kilo",
  "Skill layout assumed identical to Claude but not verified.",
);
