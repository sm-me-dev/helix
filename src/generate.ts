import { CREW_BY_ID } from "./crew.ts";
import { HOOK_SOURCES } from "./hooks.ts";
import { LSP_BY_ID } from "./lsps.ts";
import { MCP_BY_ID } from "./mcps.ts";
import { PLATFORM_BY_ID } from "./platforms.ts";
import { SKILL_BY_ID } from "./skills.ts";
import type { HarnessConfig, PlatformId } from "./types";

export type PackFile = {
  path: string;
  language: string;
  body: string;
};

/** Fail fast on stale ids (e.g. a persisted config from an older app version). */
function requireKnownIds(config: HarnessConfig): void {
  const tables = [
    ["crew role", CREW_BY_ID, config.crew],
    ["skill", SKILL_BY_ID, config.skills],
    ["MCP", MCP_BY_ID, config.mcps],
    ["LSP", LSP_BY_ID, config.lsps],
    ["platform", PLATFORM_BY_ID, config.platforms],
  ] as const;
  for (const [kind, table, ids] of tables) {
    for (const id of ids) {
      if (!table[id as keyof typeof table]) {
        throw new Error(`[helix] unknown ${kind} id: ${String(id)}`);
      }
    }
  }
}

function agentsMd(config: HarnessConfig): string {
  const crewRows = config.crew
    .filter((id) => id !== "conductor")
    .map((id) => {
      const c = CREW_BY_ID[id];
      return `| ${c.name} | ${c.when} | ${c.output.split(".")[0]}. |`;
    })
    .join("\n");

  const mcpList = config.mcps.map((id) => MCP_BY_ID[id].name).join(", ");

  const graph = config.graphFirst
    ? `Graph first: query, path, explain. Read a file only when the graph cites it.`
    : `Prefer targeted reads over glob. Name files before opening them.`;

  const fanout = config.defaultSingleAgent
    ? `Default to one agent when the change is local and files are in context.`
    : `Dispatch the matching crew role for every non-trivial task.`;

  const hooks = config.hooksEnabled
    ? `Hooks own format, lint, and secret denies. Spend no model tokens on them.`
    : `Run the repo format/lint commands before you return.`;

  return `# Helix

Always-on layer. Skills load on demand; this file stays short.

## Dispatch (you are the orchestrator; no dispatcher subagent)

- trivial (one file, clear ask, or question): main session only.
- standard (known files, one module): build, then a fresh-window reviewer.
- complex (unknown surface or cross-module): scout, architect, builder, reviewer.
- Handoff, 12 lines max: goal, constraints, cited files, done-means, out of scope.

## How to work

1. Classify (bug/feature/refactor/question), pick a tier.
2. ${fanout}
3. ${graph}
4. Return summaries, never transcripts.

## Commands

Read package.json / Makefile / justfile for real scripts. Never invent flags.
- Graph: graphify query ".." / path A B / explain NAME
- MCPs: ${mcpList || "(none)"}

## Crew

| Role | When | Output |
| --- | --- | --- |
${crewRows}

Auditor never shares a window with Builder.

## Budget

- One-sentence subagent descriptions; body loads on run.
- No file over ~400 lines; use graph neighbors or a range.
- ${hooks}
- Every behavior change ships with a failing test first.
`;
}

function pointer(from: string): string {
  return `# ${from}

Follow \`AGENTS.md\` at the repo root. It is the single source of truth for this harness.
Do not fork rules here — edit AGENTS.md, then this pointer stays valid.
`;
}

function skillFile(id: HarnessConfig["skills"][number]): string {
  const s = SKILL_BY_ID[id];
  return `---
name: ${s.name}
description: ${s.description}
---

${s.body}
`;
}

function agentFile(id: HarnessConfig["crew"][number]): string {
  const c = CREW_BY_ID[id];
  const skills = c.skills.join(", ");
  return `---
name: ${c.id}
description: ${c.oneLiner}
tools: ${c.tools.join(", ")}
model: ${c.model}
---

You are the Helix **${c.name}**. ${c.job}

When: ${c.when}
Skip when: ${c.skipWhen}

Input: ${c.input}
Output: ${c.output}

Skills to load if present: ${skills}

Rules:
- Isolated window. Return a summary, not a transcript.
- Do not do another role's job.
- If the contract is wrong, stop and return to the main session.
`;
}

function mcpJson(config: HarnessConfig): string {
  const servers: string[] = [];
  for (const id of config.mcps) {
    const raw = MCP_BY_ID[id].config.trim();
    const inner = raw.replace(/^\{\n/, "").replace(/\n\}$/, "");
    servers.push(inner);
  }
  return `{\n  "mcpServers": {\n${servers.join(",\n")}\n  }\n}\n`;
}

function cursorMcp(config: HarnessConfig): string {
  return mcpJson(config);
}

function hooksJson(config: HarnessConfig): string {
  if (!config.hooksEnabled) {
    return JSON.stringify({ hooks: {} }, null, 2) + "\n";
  }
  const settings: {
    permissions: { deny: string[] };
    hooks: Record<string, { matcher?: string; hooks: { type: string; command: string }[] }[]>;
  } = {
    permissions: {
      // Fail-closed secret protection: denies stay in permissions, not in advice hooks.
      deny: ["Read(.env)", "Read(.env.*)", "Read(**/secrets/**)"],
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

function preferGraphHook(): string {
  return HOOK_SOURCES["prefer-graph"];
}

function formatHintHook(): string {
  return HOOK_SOURCES["format-lint"];
}

function testOnStopHook(): string {
  return HOOK_SOURCES["test-on-stop"];
}

function cursorRule(config: HarnessConfig): string {
  return `---
description: Helix harness pointer
alwaysApply: true
---

${pointer("Cursor")}
Crew: ${config.crew.map((id) => CREW_BY_ID[id].name).join(" → ")}.
Graph-first: ${config.graphFirst ? "yes" : "no"}.
`;
}

function copilotInstructions(): string {
  return pointer("GitHub Copilot");
}

function conventionsMd(): string {
  return `# CONVENTIONS

${pointer("Aider").replace("# Aider\n\n", "")}
`;
}

function clinerules(): string {
  return pointer("Cline").replace("# Cline\n\n", "");
}

function windsurfRule(): string {
  return pointer("Windsurf");
}

function readme(config: HarnessConfig): string {
  const platforms = config.platforms.map((id) => PLATFORM_BY_ID[id].name).join(", ");
  const roles = config.crew
    .filter((id) => id !== "conductor")
    .map((id) => CREW_BY_ID[id].name)
    .join(", ");
  return `# Helix pack

Drop these files at the root of a repo. One harness, many agents.

Enabled for: ${platforms || "AGENTS.md only"}

## Install Graphify (once per machine)

\`\`\`
uv tool install graphifyy
graphify install
\`\`\`

Then inside the assistant: \`/graphify .\` (Codex: \`$graphify\`).

## What you just installed

- \`AGENTS.md\` — always-on, short, vendor-neutral
- Skills — progressive disclosure, Agent Skills format
- Crew roles (main session orchestrates; no dispatcher file) — ${roles || "none"}
- MCP — ${config.mcps.map((id) => MCP_BY_ID[id].name).join(", ") || "none"}
- LSP — ${config.lsps.map((id) => LSP_BY_ID[id].name).join(", ") || "none (editor defaults)"}
- Hooks — ${config.hooksEnabled ? "format/lint + graph-first hint + .env deny" : "off"}

Vendor files (CLAUDE.md, GEMINI.md, CONVENTIONS.md, …) are pointers. Edit AGENTS.md only.

## Default to one agent

Fan-out costs ~15× tokens when the work is coupled. Helix fans out when the Scout cannot name the files, or when Builder and Auditor must not share a window.
`;
}

function filesForPlatform(id: PlatformId, config: HarnessConfig): PackFile[] {
  const files: PackFile[] = [];
  const p = PLATFORM_BY_ID[id];
  switch (p.family) {
    case "claude":
      files.push({ path: "CLAUDE.md", language: "markdown", body: pointer("Claude Code") });
      // No conductor file: the main session is the orchestrator (dispatch rules live in AGENTS.md).
      for (const cid of config.crew.filter((id) => id !== "conductor")) {
        files.push({
          path: `.claude/agents/${cid}.md`,
          language: "markdown",
          body: agentFile(cid),
        });
      }
      for (const sid of config.skills) {
        files.push({
          path: `.claude/skills/${SKILL_BY_ID[sid].name}/SKILL.md`,
          language: "markdown",
          body: skillFile(sid),
        });
      }
      files.push({
        path: ".claude/settings.json",
        language: "json",
        body: hooksJson(config),
      });
      files.push({ path: ".mcp.json", language: "json", body: mcpJson(config) });
      break;
    case "cursor":
      files.push({
        path: ".cursor/rules/helix.mdc",
        language: "markdown",
        body: cursorRule(config),
      });
      files.push({ path: ".cursor/mcp.json", language: "json", body: cursorMcp(config) });
      break;
    case "gemini":
      files.push({
        path: "GEMINI.md",
        language: "markdown",
        body: pointer("Gemini / Antigravity"),
      });
      break;
    case "copilot":
      files.push({
        path: ".github/copilot-instructions.md",
        language: "markdown",
        body: copilotInstructions(),
      });
      files.push({ path: ".vscode/mcp.json", language: "json", body: mcpJson(config) });
      break;
    case "aider":
      files.push({ path: "CONVENTIONS.md", language: "markdown", body: conventionsMd() });
      break;
    case "rules-file":
      if (id === "cline") {
        files.push({ path: ".clinerules", language: "markdown", body: clinerules() });
      } else {
        files.push({
          path: ".windsurf/rules/helix.md",
          language: "markdown",
          body: windsurfRule(),
        });
      }
      break;
    default:
      files.push({ path: ".mcp.json", language: "json", body: mcpJson(config) });
      for (const sid of config.skills) {
        files.push({
          path: `skills/${SKILL_BY_ID[sid].name}/SKILL.md`,
          language: "markdown",
          body: skillFile(sid),
        });
      }
  }
  return files;
}

export function generatePack(config: HarnessConfig): PackFile[] {
  requireKnownIds(config);
  const files: PackFile[] = [
    { path: "README.md", language: "markdown", body: readme(config) },
    { path: "AGENTS.md", language: "markdown", body: agentsMd(config) },
  ];

  if (config.hooksEnabled) {
    files.push({
      path: ".helix/hooks/prefer-graph.mjs",
      language: "javascript",
      body: preferGraphHook(),
    });
    files.push({
      path: ".helix/hooks/format-lint.mjs",
      language: "javascript",
      body: formatHintHook(),
    });
    files.push({
      path: ".helix/hooks/test-on-stop.mjs",
      language: "javascript",
      body: testOnStopHook(),
    });
  }

  const seen = new Set<string>(files.map((f) => f.path));
  // Skills emit only inside filesForPlatform, at the location the enabled
  // platform reads (.claude/skills for Claude, skills/ for the AGENTS.md
  // family). No unconditional root copy: each skill ships once per reader.
  for (const pid of config.platforms) {
    for (const f of filesForPlatform(pid, config)) {
      if (seen.has(f.path)) continue;
      seen.add(f.path);
      files.push(f);
    }
  }

  return files;
}

export function packAsText(files: PackFile[]): string {
  return files.map((f) => `===== ${f.path} =====\n${f.body.trimEnd()}\n`).join("\n");
}

export { agentsMd };
