import { ADAPTER_BY_ID } from "./adapters/index.ts";
import { CREW_BY_ID } from "./crew.ts";
import { LSP_BY_ID } from "./lsps.ts";
import { MCP_BY_ID } from "./mcps.ts";
import { PLATFORM_BY_ID } from "./platforms.ts";
import { SKILL_BY_ID } from "./skills.ts";
import type { HarnessConfig, PackFile } from "./types";

export type { PackFile } from "./types";

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
- Hooks — ${config.hooksEnabled ? "format/lint + graph-first hint + Stop test gate + .env deny" : "off"}

Vendor files (CLAUDE.md, GEMINI.md, CONVENTIONS.md, …) are pointers. Edit AGENTS.md only.

## Default to one agent

Fan-out costs ~15× tokens when the work is coupled. Helix fans out when the Scout cannot name the files, or when Builder and Auditor must not share a window.
`;
}

export function generatePack(config: HarnessConfig): PackFile[] {
  requireKnownIds(config);
  const files: PackFile[] = [
    { path: "README.md", language: "markdown", body: readme(config) },
    { path: "AGENTS.md", language: "markdown", body: agentsMd(config) },
  ];

  const seen = new Set<string>(files.map((f) => f.path));
  // Each adapter emits only at the location its platform reads; the seen-set
  // keeps shared paths (e.g. GEMINI.md for gemini + antigravity) to one copy.
  for (const pid of config.platforms) {
    for (const f of ADAPTER_BY_ID[pid].files(config)) {
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
