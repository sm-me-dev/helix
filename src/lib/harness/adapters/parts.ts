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

/** The role prompt, without any platform frontmatter. Shared by every platform's agent file. */
export function agentBody(id: HarnessConfig["crew"][number]): string {
  const c = CREW_BY_ID[id];
  const skills = c.skills.join(", ");
  return `You are the Helix **${c.name}**. ${c.job}

When: ${c.when}
Skip when: ${c.skipWhen}

Input: ${c.input}
Output: ${c.output}

${skills ? `Skills to load if present: ${skills}\n\n` : ""}Rules:
- Isolated window. Return a summary, not a transcript.
- Do not do another role's job.
- If the contract is wrong, stop and return to the main session.
`;
}

export function agentFile(id: HarnessConfig["crew"][number]): string {
  const c = CREW_BY_ID[id];
  return `---
name: ${c.id}
description: ${c.oneLiner}
tools: ${c.tools.join(", ")}
model: ${c.model}
---

${agentBody(id)}`;
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
      deny: [
        "Read(.env)",
        "Read(.env.*)",
        "Read(**/secrets/**)",
        "Edit(.env)",
        "Edit(.env.*)",
        "Edit(**/secrets/**)",
      ],
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
