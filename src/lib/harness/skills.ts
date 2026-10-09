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
    id: "hook-guards",
    name: "hook-guards",
    description:
      "Put mechanical checks in hooks, not in prompts. Use when lint, format, or secret scans are being done by the model.",
    loadsWhen: "Configuring the harness, or the model is running prettier by hand.",
    body: `If a rule is deterministic, it is a hook:
- format / lint on write
- deny .env and secret paths
- PreToolUse: large Read → suggest mcp__graphify__query_graph
- Stop: run the test command if a source file changed

Prompts rot. Hooks do not.`,
  },
];

export const SKILL_BY_ID = Object.fromEntries(SKILLS.map((s) => [s.id, s])) as Record<
  SkillId,
  Skill
>;

export const DEFAULT_SKILLS: SkillId[] = SKILLS.map((s) => s.id);
