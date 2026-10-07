import type { SkillId } from "./types";

export type Skill = {
  id: SkillId;
  name: string;
  description: string;
  loadsWhen: string;
  body: string;
};

export const SKILLS: Skill[] = [
  {
    id: "graph-first",
    name: "graph-first",
    description:
      "Query the knowledge graph before glob, grep, or wide file reads. Use when locating code, assessing blast radius, or deciding what to open.",
    loadsWhen: "Any search, 'where is', impact, or architecture question.",
    body: `Use Graphify (skill or MCP) as the map. Do not start with glob/grep "to be sure".

1. query_graph with the user's words.
2. shortest_path between the two symbols you care about.
3. get_neighbors on the node you will change.
4. Read a file only when the graph cites it, and prefer a line range.

If the graph is stale, rebuild once (\`/graphify .\` or \`graphify index\`) then continue. Never dump graph.json into context.`,
  },
  {
    id: "clarify-brief",
    name: "clarify-brief",
    description:
      "Turn an unclear ask into a brief with open questions. Use when product intent is ambiguous or the surface is unknown.",
    loadsWhen: "Scout runs, or the ask has two readings.",
    body: `Write a brief, not a novel.

- What exists (graph-cited)
- What the user asked
- What is ambiguous (max 3 questions)
- Files you would touch and why

If two product readings both fit, stop. Do not pick one. A wrong product guess is more expensive than a question.`,
  },
  {
    id: "decision-table",
    name: "decision-table",
    description:
      "Force a named choice between real options before code. Use when more than one valid approach exists.",
    loadsWhen: "Architect runs, or Builder is about to invent an approach.",
    body: `| Option | Fits repo? | Blast radius | Reversible | Pick? |
| --- | --- | --- | --- | --- |

Pick one. The reason must cite an existing file, test, or invariant — not taste. If the table has one row, you did not need this skill.`,
  },
  {
    id: "scoped-diff",
    name: "scoped-diff",
    description: "Implement only the plan's files. Use whenever code is written.",
    loadsWhen: "Builder runs.",
    body: `- Touch only files named in the plan.
- Match local naming, error handling, and import style.
- No drive-by refactors, no new helpers for a one-time operation.
- If the plan is wrong, stop and return to Architect. Do not silently expand scope.`,
  },
  {
    id: "prove-behavior",
    name: "prove-behavior",
    description:
      "A failing test first, then the command the repo already uses. Use on any behavior change.",
    loadsWhen: "Prover runs, or Builder claims done.",
    body: `Find the test command from package.json / Makefile / AGENTS.md — do not invent pytest flags.

Prefer one focused test that would have caught this bug over a new suite. Paste the command and the tail of the output. A green typecheck is not a behavior proof.`,
  },
  {
    id: "independent-audit",
    name: "independent-audit",
    description:
      "Fresh-window check of plan vs diff vs tests. Use after Builder and Prover. Must not share context with Builder.",
    loadsWhen: "Auditor runs.",
    body: `You did not write this patch. Treat it as untrusted.

PASS only if:
1. Diff matches the plan's file list
2. Success criteria were actually run
3. No secrets, no unrelated rewrites, no skipped tests

FAIL with file:line. Do not suggest extra features.`,
  },
  {
    id: "lean-handoff",
    name: "lean-handoff",
    description:
      "Compact handoff cards between roles. Use whenever a subagent is spawned or a role returns.",
    loadsWhen: "Conductor dispatches or a role finishes.",
    body: `Handoff card (hard cap 12 lines):
- Goal
- Constraints
- Cited files
- Done means
- Out of scope

Never paste transcripts, raw tool dumps, or "in case it's useful" files. The receiving role has its own window.`,
  },
  {
    id: "hook-guards",
    name: "hook-guards",
    description:
      "Put mechanical checks in hooks, not in prompts. Use when lint, format, or secret scans are being done by the model.",
    loadsWhen: "Configuring the harness, or the model is running prettier by hand.",
    body: `If a rule is deterministic, it is a hook:
- format / lint on write
- deny .env and secret paths
- PreToolUse: large Read → suggest graphify.query_graph
- Stop: run the test command if a source file changed

Prompts rot. Hooks do not.`,
  },
];

export const SKILL_BY_ID = Object.fromEntries(SKILLS.map((s) => [s.id, s])) as Record<
  SkillId,
  Skill
>;

export const DEFAULT_SKILLS: SkillId[] = SKILLS.map((s) => s.id);
