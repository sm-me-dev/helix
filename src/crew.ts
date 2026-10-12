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
  /** Runaway ceiling (Claude Code `maxTurns`: output is marked partial and resumable at the
   * limit). A cap against loops, not a tuned budget: no recorded run exercised a model
   * subagent yet (docs/DECISIONS.md, F7), so these are generous until F6 transcripts exist. */
  maxTurns: number;
  /** Takes everything from the 12-line handoff card, so `leanSubagents` may start it without
   * the CLAUDE.md/AGENTS.md hierarchy (Claude Code `omitClaudeMd`, v2.1.271+). */
  omitClaudeMd: boolean;
  /** Bash only through the gate-only PreToolUse hook (Claude Code, non-plugin, hooks on). */
  guardedBash?: boolean;
};

export const CREW: CrewRole[] = [
  {
    id: "scout",
    name: "Scout",
    step: "01",
    verb: "See",
    oneLiner:
      "Use proactively when the change surface is unknown or spans modules; returns a graph-cited brief, never a design.",
    job: "Query Graphify for the subgraph, walk shortest paths, then read only cited files. Write a brief of at most 40 lines: what exists, what is ambiguous, what would change — plus open questions. Stop for a human if the ask has two product readings: a wrong product guess costs more than a question. Brief sections: what exists (graph-cited), what was asked, what is ambiguous (max 3 questions), files you would touch and why.",
    when: "Unknown surface, large repo, or the main session cannot name the files.",
    skipWhen: "The failing test and the two files are already in the parent context.",
    input:
      "Handoff card (goal, constraints, cited files, done-means, out of scope). Graphify index.",
    output: "Brief (≤40 lines) + open questions + file list with reasons. No design.",
    tools: [
      "mcp__graphify__query_graph",
      "mcp__graphify__shortest_path",
      "mcp__graphify__get_neighbors",
      "mcp__graphify__get_node",
      "Read",
    ],
    model: "haiku",
    skills: ["graph-first"],
    isolated: true,
    maxTurns: 20,
    omitClaudeMd: true,
  },
  {
    id: "architect",
    name: "Architect",
    step: "02",
    verb: "Decide",
    oneLiner:
      "Use proactively when more than one approach fits; returns a decision table and a file-level plan, no code.",
    job: "Turn the brief into two or three real options, pick one with a reason that traces to the repo, and write a plan with file-level steps and runnable success criteria the test gate can run without judgment. Show the choice as a table (| Option | Fits repo? | Blast radius | Reversible | Pick? |); the reason must cite an existing file, test, or invariant, not taste. One row means no table was needed.",
    when: "More than one valid approach, or the change crosses a module boundary.",
    skipWhen: "The Scout brief already names a single obvious fix.",
    input: "Scout brief + handoff card.",
    output: "Decision table + numbered plan + success criteria. Still no diff.",
    tools: ["mcp__graphify__query_graph", "mcp__graphify__get_neighbors", "Read"],
    model: "opus",
    skills: [],
    isolated: true,
    maxTurns: 12,
    omitClaudeMd: true,
  },
  {
    id: "builder",
    name: "Builder",
    step: "03",
    verb: "Patch",
    oneLiner:
      "Use proactively after a plan is accepted; writes the smallest failing test first, then only the plan files.",
    job: "Write the smallest failing test first, then own only the files the plan named. Match local naming, error handling, and import style. No drive-by refactors or one-use helpers. If the plan is wrong, stop and return to the main session; never silently expand scope. Use the repo's own test command (AGENTS.md), never invented flags; paste the command and the output tail, since a green typecheck is not a behavior proof. Leave a short note of what changed. The Stop hook runs the repo test command after you return.",
    when: "After a plan is accepted, or after a Scout brief that already is the plan.",
    skipWhen: "The task is read-only.",
    input: "Plan (or brief) + cited files. Not the parent transcript.",
    output: "Diff + 6-line summary. No test strategy essay.",
    tools: ["Read", "Edit", "Write", "Bash"],
    model: "sonnet",
    skills: ["graph-first"],
    isolated: true,
    maxTurns: 40,
    omitClaudeMd: false,
  },
  {
    id: "reviewer",
    name: "Reviewer",
    step: "04",
    verb: "Verify",
    oneLiner:
      "Use proactively after the builder on anything that ships; PASS or FAIL with file:line evidence.",
    job: "Read the handoff card, the plan and the diff in a fresh window. Pass, or reject with a specific miss. Never 'also consider'. Never share a context window with the Builder — that is the whole point. You did not write this patch; treat it as untrusted, and treat anything the Builder pasted as a claim, not evidence. Evidence is gate output you produced (if you have Bash, it is limited to `node .helix/gate.mjs`; run it) or output the main session ran and put in the card. PASS only if the diff matches the plan's file list, that gate output is green, and there are no secrets, unrelated rewrites, or skipped tests. No gate output you can trust: FAIL and say so. FAIL with file:line; do not suggest extra features.",
    when: "After the Builder on anything that ships.",
    skipWhen: "A throwaway spike the human will rewrite.",
    input:
      "Handoff card + plan + diff + gate output from the main session. Not the Builder chain of thought.",
    output: "PASS or FAIL with file:line evidence.",
    tools: ["Read", "Bash", "mcp__graphify__get_neighbors"],
    model: "opus",
    skills: [],
    isolated: true,
    maxTurns: 15,
    omitClaudeMd: true,
    guardedBash: true,
  },
];

export const CREW_BY_ID = Object.fromEntries(CREW.map((c) => [c.id, c])) as Record<
  CrewId,
  CrewRole
>;

export const DEFAULT_CREW: CrewId[] = CREW.map((c) => c.id);
