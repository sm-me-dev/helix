// Shared pack builders used by the per-platform adapters.
// generate.ts owns the pack assembly; adapters own the per-platform files.
import { CREW_BY_ID } from "../crew.ts";
import { HOOK_SOURCES } from "../hooks.ts";
import { SKILL_BY_ID } from "../skills.ts";
import type { HarnessConfig } from "../types";

export function pointer(from: string): string {
  return `# ${from}

Follow \`AGENTS.md\` at the repo root. It is the single source of truth for this harness.
Do not fork rules here — edit AGENTS.md, then this pointer stays valid.
`;
}

export function skillFile(id: HarnessConfig["skills"][number]): string {
  const s = SKILL_BY_ID[id];
  return `---
name: ${s.name}
description: ${s.description}
---

${s.body}
`;
}

/** Scout's working instruction when the graphify MCP is absent: the graphify-absent pack
 * ships `.helix/map.mjs` instead, and the allow-list is Grep/Glob/Read (see toolsFor).
 * Kept next to the crew table so the two cannot drift silently. */
const SCOUT_MAP_JOB =
  "Start from the repo map (`node .helix/map.mjs [subdir]` lists files and top-level symbols), then Grep, Glob and Read only what the map or a search names. Write a brief of at most 40 lines: what exists, what is ambiguous, what would change — plus open questions. Stop for a human if the ask has two product readings: a wrong product guess costs more than a question. Brief sections: what exists (map-cited), what was asked, what is ambiguous (max 3 questions), files you would touch and why.";
const SCOUT_MAP_INPUT =
  "Handoff card (goal, constraints, cited files, done-means, out of scope). Repo map.";

/** The role prompt, without any platform frontmatter. Shared by every platform's agent file. */
export function agentBody(
  id: HarnessConfig["crew"][number],
  config: HarnessConfig,
): string {
  const c = CREW_BY_ID[id];
  const graph = config.mcps.includes("graphify");
  const job = id === "scout" && !graph ? SCOUT_MAP_JOB : c.job;
  const input = id === "scout" && !graph ? SCOUT_MAP_INPUT : c.input;
  const skills = c.skills.join(", ");
  return `You are the Helix **${c.name}**. ${job}

When: ${c.when}
Skip when: ${c.skipWhen}

Input: ${input}
Output: ${c.output}

${skills ? `Skills to load if present: ${skills}\n\n` : ""}Rules:
- Isolated window. Return a summary, not a transcript.
- Do not do another role's job.
- If the contract is wrong, stop and return to the main session.
`;
}

/** Allow-list for a role. Graphify tools are named only when the graphify MCP is configured;
 * otherwise a read-only role gets Grep and Glob so it can still search (Read alone cannot).
 * Tool names verified 2026-10-09/10 against https://code.claude.com/docs/en/sub-agents.md. */
export function toolsFor(id: HarnessConfig["crew"][number], config: HarnessConfig): string[] {
  const tools = CREW_BY_ID[id].tools;
  if (config.mcps.includes("graphify")) return tools;
  const rest = tools.filter((t) => !t.startsWith("mcp__graphify__"));
  if (rest.length === tools.length || rest.some((t) => t === "Edit" || t === "Write")) return rest;
  return [...new Set(["Grep", "Glob", ...rest])];
}

export function agentFile(id: HarnessConfig["crew"][number], config: HarnessConfig): string {
  const c = CREW_BY_ID[id];
  return `---
name: ${c.id}
description: ${c.oneLiner}
tools: ${toolsFor(id, config).join(", ")}
model: ${c.model}
---

 ${agentBody(id, config)}`;
}

/** Fail-closed secret protection. Lives in repo permissions, never in a plugin: a plugin's
 * settings.json honors only `agent` and `subagentStatusLine` (verified 2026-10-10,
 * https://code.claude.com/docs/en/plugins/components#default-settings). */
const SECRET_DENY = [
  "Read(.env)",
  "Read(.env.*)",
  "Read(**/secrets/**)",
  "Edit(.env)",
  "Edit(.env.*)",
  "Edit(**/secrets/**)",
];

/** Repo-side settings for plugin mode: the denies, and no hooks (the plugin owns them; plugin
 * and settings hooks both run, in parallel, and are not deduplicated against each other). */
export function permissionsOnlyJson(): string {
  return JSON.stringify({ permissions: { deny: SECRET_DENY }, hooks: {} }, null, 2) + "\n";
}

export function hooksJson(config: HarnessConfig): string {
  if (!config.hooksEnabled) {
    return JSON.stringify({ hooks: {} }, null, 2) + "\n";
  }
  const settings: {
    permissions: { deny: string[] };
    hooks: Record<string, { matcher?: string; hooks: { type: string; command: string }[] }[]>;
  } = {
    permissions: {
      // Fail-closed secret protection: denies stay in permissions, not in advice hooks.
      // Read denies also block Edit/Write on the same path and best-effort cover
      // Grep/Glob plus recognized Bash file commands (cat, head, …). Edit denies
      // close the NotebookEdit gap. Uncoverable by rule syntax: subprocess reads
      // (python/node opening files, `grep -r .` from the dir) — documented in
      // the pack README, OS sandbox is the only enforcement there.
      // Verified 2026-10-09 against https://code.claude.com/docs/en/permissions.
      deny: SECRET_DENY,
    },
    hooks: {
      PostToolUse: [
        {
          matcher: "Edit|Write",
          hooks: [{ type: "command", command: "node .helix/hooks/format-lint.mjs" }],
        },
      ],
      Stop: [{ hooks: [{ type: "command", command: "node .helix/hooks/test-on-stop.mjs" }] }],
    },
  };
  if (config.graphFirst) {
    settings.hooks.PreToolUse = [
      {
        matcher: "Read|Grep|Glob",
        hooks: [{ type: "command", command: "node .helix/hooks/prefer-graph.mjs" }],
      },
    ];
  }
  return JSON.stringify(settings, null, 2) + "\n";
}

export function preferGraphHook(): string {
  return HOOK_SOURCES["prefer-graph"];
}

export function formatHintHook(): string {
  return HOOK_SOURCES["format-lint"];
}

export function testOnStopHook(): string {
  return HOOK_SOURCES["test-on-stop"];
}

export function cursorRule(config: HarnessConfig): string {
  return `---
description: Helix harness pointer
alwaysApply: true
---

${pointer("Cursor")}
Crew: ${config.crew.map((id) => CREW_BY_ID[id].name).join(" → ")}.
Graph-first: ${config.graphFirst ? "yes" : "no"}.
`;
}

export function copilotInstructions(): string {
  return pointer("GitHub Copilot");
}

export function conventionsMd(): string {
  return `# CONVENTIONS

${pointer("Aider").replace("# Aider\n\n", "")}
`;
}

export function clinerules(): string {
  return pointer("Cline").replace("# Cline\n\n", "");
}

export function windsurfRule(): string {
  return pointer("Windsurf");
}
