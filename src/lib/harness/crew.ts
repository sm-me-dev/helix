import type { CrewId, SkillId } from "./types";

export type CrewRole = {
  id: CrewId;
  name: string;
  step: string;
  verb: string;
  oneLiner: string;
  job: string;
  when: string;
  skipWhen: string;
  input: string;
  output: string;
  tools: string[];
  /** Model tier, configurable here — never hardcoded in templates. */
  model: "haiku" | "sonnet" | "opus" | "inherit";
  skills: SkillId[];
  alwaysOnTokens: number;
  isolated: boolean;
  required: boolean;
};

export const CREW: CrewRole[] = [
  {
    id: "conductor",
    name: "Conductor",
    step: "00",
    verb: "Dispatch",
    oneLiner: "Classifies the work and holds the contract. Never writes the patch.",
    job: "Read the ask, decide single-agent vs fan-out, name the files and invariants that later roles must not invent, then dispatch. Merge summaries at the end. The parent window stays small on purpose.",
    when: "Every non-trivial task. Always first.",
    skipWhen: "A one-file typo or a question you can answer from the graph in one hop.",
    input: "User ask. Repo map from Graphify if the surface is unknown.",
    output: "A 8–12 line contract: goal, constraints, roles to run, success checks. No plan yet.",
    tools: ["graphify.query_graph", "Task"],
    model: "inherit",
    skills: ["lean-handoff"],
    alwaysOnTokens: 70,
    isolated: false,
    required: true,
  },
  {
    id: "scout",
    name: "Scout",
    step: "01",
    verb: "See",
    oneLiner:
      "Use proactively when the change surface is unknown or spans modules; returns a graph-cited brief, never a design.",
    job: "Query Graphify for the subgraph, walk shortest paths, then read only cited files. Write a brief: what exists, what is ambiguous, what would change. Stop for a human if the ask has two product readings.",
    when: "Unknown surface, large repo, or the Conductor cannot name the files.",
    skipWhen: "The failing test and the two files are already in the parent context.",
    input: "Conductor contract. Graphify index.",
    output: "Brief (≤40 lines) + open questions + file list with reasons. No design.",
    tools: [
      "graphify.query_graph",
      "graphify.shortest_path",
      "graphify.explain",
      "graphify.get_neighbors",
      "Read",
    ],
    model: "haiku",
    skills: ["graph-first", "clarify-brief"],
    alwaysOnTokens: 80,
    isolated: true,
    required: false,
  },
  {
    id: "architect",
    name: "Architect",
    step: "02",
    verb: "Decide",
    oneLiner:
      "Use proactively when more than one approach fits; returns a decision table and a file-level plan, no code.",
    job: "Turn the brief into two or three real options, pick one with a reason that traces to the repo, and write a plan with file-level steps and a verification signal the Prover can run without judgment.",
    when: "More than one valid approach, or the change crosses a module boundary.",
    skipWhen: "The Scout brief already names a single obvious fix.",
    input: "Scout brief + contract.",
    output: "Decision table + numbered plan + success criteria. Still no diff.",
    tools: ["graphify.get_pr_impact", "Read"],
    model: "opus",
    skills: ["decision-table", "lean-handoff"],
    alwaysOnTokens: 75,
    isolated: true,
    required: false,
  },
  {
    id: "builder",
    name: "Builder",
    step: "03",
    verb: "Patch",
    oneLiner:
      "Use proactively after a plan is accepted; implements only the plan files with no extra refactors.",
    job: "Own only the files the plan named. Match local patterns. Do not 'improve' adjacent code. Leave a short note of what changed and what the Prover should run.",
    when: "After a plan is accepted, or after a Scout brief that already is the plan.",
    skipWhen: "The task is read-only.",
    input: "Plan (or brief) + cited files. Not the parent transcript.",
    output: "Diff + 6-line summary. No test strategy essay.",
    tools: ["Read", "Edit", "Write", "Bash"],
    model: "sonnet",
    skills: ["scoped-diff", "graph-first"],
    alwaysOnTokens: 70,
    isolated: true,
    required: false,
  },
  {
    id: "prover",
    name: "Prover",
    step: "04",
    verb: "Prove",
    oneLiner:
      "Use proactively on any behavior change; adds the smallest failing test first, then runs the repo checks.",
    job: "Add or update the smallest test that would have caught the bug. Run it. If it fails, send a tight failure note back — do not silently patch production code unless the failure is a one-line test fix.",
    when: "Any behavior change.",
    skipWhen: "Docs-only or a comment.",
    input: "Builder summary + plan success criteria.",
    output: "Commands run, pass/fail, and the test files touched.",
    tools: ["Bash", "Read", "Edit"],
    model: "haiku",
    skills: ["prove-behavior"],
    alwaysOnTokens: 65,
    isolated: true,
    required: false,
  },
  {
    id: "auditor",
    name: "Auditor",
    step: "05",
    verb: "Audit",
    oneLiner:
      "Use proactively after builder and prover on anything that ships; PASS or FAIL with file:line evidence.",
    job: "Read the contract, the plan, the diff, and the Prover output in a fresh window. Pass, or reject with a specific miss. Never 'also consider'. Never share a context window with the Builder — that is the whole point.",
    when: "After Builder and Prover on anything that ships.",
    skipWhen: "A throwaway spike the human will rewrite.",
    input: "Contract + plan + diff + test output. Not the Builder chain of thought.",
    output: "PASS or FAIL with file:line evidence.",
    tools: ["Read", "Bash", "graphify.get_pr_impact"],
    model: "opus",
    skills: ["independent-audit"],
    alwaysOnTokens: 70,
    isolated: true,
    required: false,
  },
];

export const CREW_BY_ID = Object.fromEntries(CREW.map((c) => [c.id, c])) as Record<
  CrewId,
  CrewRole
>;

export const DEFAULT_CREW: CrewId[] = CREW.map((c) => c.id);
