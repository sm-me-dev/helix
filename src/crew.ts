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
  isolated: boolean;
};

export const CREW: CrewRole[] = [
  {
    id: "scout",
    name: "Scout",
    step: "01",
    verb: "See",
    oneLiner:
      "Use proactively when the change surface is unknown or spans modules; returns a graph-cited brief, never a design.",
    job: "Query Graphify for the subgraph, walk shortest paths, then read only cited files. Write a brief of at most 40 lines: what exists, what is ambiguous, what would change — plus open questions. Stop for a human if the ask has two product readings.",
    when: "Unknown surface, large repo, or the main session cannot name the files.",
    skipWhen: "The failing test and the two files are already in the parent context.",
    input:
      "Handoff card (goal, constraints, cited files, done-means, out of scope). Graphify index.",
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
    isolated: true,
  },
  {
    id: "architect",
    name: "Architect",
    step: "02",
    verb: "Decide",
    oneLiner:
      "Use proactively when more than one approach fits; returns a decision table and a file-level plan, no code.",
    job: "Turn the brief into two or three real options, pick one with a reason that traces to the repo, and write a plan with file-level steps and runnable success criteria the test gate can run without judgment.",
    when: "More than one valid approach, or the change crosses a module boundary.",
    skipWhen: "The Scout brief already names a single obvious fix.",
    input: "Scout brief + handoff card.",
    output: "Decision table + numbered plan + success criteria. Still no diff.",
    tools: ["graphify.get_pr_impact", "Read"],
    model: "opus",
    skills: ["decision-table", "lean-handoff"],
    isolated: true,
  },
  {
    id: "builder",
    name: "Builder",
    step: "03",
    verb: "Patch",
    oneLiner:
      "Use proactively after a plan is accepted; writes the smallest failing test first, then only the plan files.",
    job: "Write the smallest failing test first, then own only the files the plan named. Match local patterns. Do not 'improve' adjacent code. Leave a short note of what changed. The Stop hook runs the repo test command after you return.",
    when: "After a plan is accepted, or after a Scout brief that already is the plan.",
    skipWhen: "The task is read-only.",
    input: "Plan (or brief) + cited files. Not the parent transcript.",
    output: "Diff + 6-line summary. No test strategy essay.",
    tools: ["Read", "Edit", "Write", "Bash"],
    model: "sonnet",
    skills: ["scoped-diff", "graph-first", "prove-behavior"],
    isolated: true,
  },
  {
    id: "reviewer",
    name: "Reviewer",
    step: "04",
    verb: "Verify",
    oneLiner:
      "Use proactively after the builder on anything that ships; PASS or FAIL with file:line evidence.",
    job: "Read the handoff card, the plan, the diff, and the test output in a fresh window. Pass, or reject with a specific miss. Never 'also consider'. Never share a context window with the Builder — that is the whole point.",
    when: "After the Builder on anything that ships.",
    skipWhen: "A throwaway spike the human will rewrite.",
    input: "Handoff card + plan + diff + test output. Not the Builder chain of thought.",
    output: "PASS or FAIL with file:line evidence.",
    tools: ["Read", "graphify.get_pr_impact"],
    model: "opus",
    skills: ["independent-audit"],
    isolated: true,
  },
];

export const CREW_BY_ID = Object.fromEntries(CREW.map((c) => [c.id, c])) as Record<
  CrewId,
  CrewRole
>;

export const DEFAULT_CREW: CrewId[] = CREW.map((c) => c.id);
