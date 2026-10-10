import { ADAPTER_BY_ID } from "./adapters/index.ts";
import { agentFile, skillFile } from "./adapters/parts.ts";
import { CREW_BY_ID } from "./crew.ts";
import { GATE_SOURCE } from "./gate.ts";
import { MAP_SOURCE, REPO_MAP_PROVIDERS } from "./repomap.ts";
import { MCP_BY_ID } from "./mcps.ts";
import { PLATFORM_BY_ID } from "./platforms.ts";
import { SKILL_BY_ID } from "./skills.ts";
import type { HarnessConfig, PackFile, PlatformId } from "./types";
import { dispatchRules } from "./workflow.ts";

export type { PackFile } from "./types";

/** Fail fast on stale ids (e.g. a persisted config from an older app version). */
function requireKnownIds(config: HarnessConfig): void {
  const tables = [
    ["crew role", CREW_BY_ID, config.crew],
    ["skill", SKILL_BY_ID, config.skills],
    ["MCP", MCP_BY_ID, config.mcps],
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

const AGENT_FILE_PLATFORMS = new Set<PlatformId>([
  "claude-code",
  "codex",
  "opencode",
  "cursor",
  "antigravity",
]);

function agentsMd(config: HarnessConfig): string {
  const crewRows = config.crew
    .map((id) => {
      const c = CREW_BY_ID[id];
      return `| ${c.name} | ${c.when} | ${c.output.split(".")[0]}. |`;
    })
    .join("\n");

  // Platforms that write agent files load each role's description themselves, so the
  // table would only repeat it. Keep it where some selected platform has no agent files.
  const crewSection =
    config.platforms.length > 0 && config.platforms.every((p) => AGENT_FILE_PLATFORMS.has(p))
      ? ""
      : `## Crew

| Role | When | Output |
| --- | --- | --- |
${crewRows}

`;

  const mcpList = config.mcps.map((id) => MCP_BY_ID[id].name).join(", ");

  const graph = REPO_MAP_PROVIDERS[config.graphFirst ? "graphify" : "outline"].instruction;

  const fanout = config.defaultSingleAgent
    ? `Default to one agent when local, files in context, not security-sensitive.`
    : `Dispatch the matching crew role for every non-trivial task.`;

  const hooks = config.hooksEnabled
    ? `Hooks own format, lint, and secret denies. Spend no model tokens on them.`
    : `Run the repo format/lint commands before you return.`;

  // Detected facts beat generic advice: exact commands, no re-detection.
  const repoFacts = config.stack
    ? `Repo facts, detected by \`helix init\` — do not re-detect, never invent flags:
- stack: ${config.stack.language} · ${config.stack.packageManager}${[
        ["test", config.stack.testCommand],
        ["lint", config.stack.lintCommand],
        ["format", config.stack.formatCommand],
      ]
        .filter(([, cmd]) => cmd)
        .map(([name, cmd]) => `; ${name}: \`${cmd}\``)
        .join("")}.`
    : `Read package.json / Makefile / justfile for real scripts. Never invent flags.`;

  // Disclosure off means the old way: everything inlined in the always-on file.
  const inlined = config.progressiveDisclosure
    ? ""
    : `\n## Reference (inlined: disclosure off)\n\n${config.skills.map((id) => skillFile(id)).join("\n")}\n${config.crew
        .map((id) => agentFile(id, config))
        .join("\n")}`;

  return `# Helix
## Dispatch (you are the orchestrator; no dispatcher subagent)

${dispatchRules().join("\n")}
- Two product readings: ask.

## How to work

1. Classify (bug/feature/refactor/question), pick a tier.
2. ${fanout}
3. ${graph}
4. Return summaries, never transcripts.

## Commands

${repoFacts}
${config.graphFirst ? `- Graph: query_graph ".." / get_neighbors NAME / shortest_path A B\n` : ""}- MCPs: ${mcpList || "(none)"}

${crewSection}## Budget

- Subagent bodies load on run; no file over ~400 lines, cite ranges.
- ${hooks}
- Every behavior change ships with a failing test first.
- Before you finish: \`node .helix/gate.mjs\` (secrets, lint, typecheck, affected tests; failures only; exit 0 = pass).${
    config.learnOptIn === true
      ? "\n- Learn (opt-in ledger): read `.helix/learn/COMPILED.md` when present; at most its 3 listed lines apply."
      : ""
  }
${inlined}`;
}

function readme(config: HarnessConfig): string {
  const platforms = config.platforms.map((id) => PLATFORM_BY_ID[id].name).join(", ");
  const roles = config.crew.map((id) => CREW_BY_ID[id].name).join(", ");
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
- \`.helix/gate.mjs\` — one command for every agent, git hook and CI job: \`node .helix/gate.mjs\` (exit 0 pass, 1 a check failed, 2 usage error; \`--all\`, \`--dry\`, \`--json\`)
- Skills — progressive disclosure, Agent Skills format
- Crew roles (main session orchestrates; no dispatcher file) — ${roles || "none"}
- MCP — ${config.mcps.map((id) => MCP_BY_ID[id].name).join(", ") || "none"}
- Hooks — ${config.hooksEnabled ? "format/lint + graph-first hint + Stop test gate + .env deny" : "off"}

Secret denies block Read/Edit/Write/Glob and recognized shell readers (cat,
head, …) on .env and secrets/ — not subprocess reads (a script opening files
itself). OS sandbox is the only enforcement there.

Vendor files (CLAUDE.md, GEMINI.md, CONVENTIONS.md, …) are pointers. Edit AGENTS.md only.

## Default to one agent

Fan-out costs ~15× tokens when the work is coupled. Helix fans out when the Scout cannot name the files, or when Builder and Reviewer must not share a window.
`;
}

export function generatePack(config: HarnessConfig): PackFile[] {
  requireKnownIds(config);
  const files: PackFile[] = [
    { path: ".helix/README.md", language: "markdown", body: readme(config) },
    { path: "AGENTS.md", language: "markdown", body: agentsMd(config) },
  ];

  // The gate is platform-neutral: every agent, git hook and CI job runs the
  // same file. gate.json pins the detected commands so the gate never re-detects.
  files.push({ path: ".helix/gate.mjs", language: "javascript", body: GATE_SOURCE });
  if (!config.graphFirst) {
    files.push({ path: ".helix/map.mjs", language: "javascript", body: MAP_SOURCE });
  }
  if (config.stack) {
    const pins: Record<string, string> = { packageManager: config.stack.packageManager };
    if (config.stack.testCommand) pins.test = config.stack.testCommand;
    if (config.stack.lintCommand) pins.lint = config.stack.lintCommand;
    files.push({
      path: ".helix/gate.json",
      language: "json",
      body: JSON.stringify(pins, null, 2) + "\n",
    });
  }

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
