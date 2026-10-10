// Adaptive workflow orchestration: risk-aware tier selection, explicit states,
// and handoff contracts. Logical responsibilities (manager/scout/architect/
// builder/verifier), not necessarily separate model invocations. The main
// session is the manager: it classifies, owns acceptance criteria, and
// controls completion. No daemons, no persistent state.
import type { CrewId } from "./types.ts";

export type WorkflowState =
  "classified" | "discovered" | "planned" | "implemented" | "verifying" | "completed" | "blocked";

export type TaskTier = "trivial" | "standard" | "complex";

export type WorkflowSelection = {
  tier: TaskTier;
  /** Ordered logical roles for this task. Manager (main session) is implicit. */
  roles: CrewId[];
  /** Allowed state path, including legitimate skips. */
  states: WorkflowState[];
  /** Why this tier was chosen (for reports, not prompts). */
  reason: string;
};

export type TaskFacts = {
  fileCount: number;
  crossesModules: boolean;
  isQuestion: boolean;
  /** Security-sensitive: auth, secrets, permissions, crypto, sandbox boundaries. */
  securitySensitive?: boolean;
  /** Requirements have two or more plausible readings. */
  ambiguous?: boolean;
};

const TRANSITIONS: Record<WorkflowState, WorkflowState[]> = {
  classified: ["discovered", "planned", "implemented", "verifying", "completed", "blocked"],
  discovered: ["planned", "implemented", "verifying", "blocked"],
  planned: ["implemented", "verifying", "blocked"],
  implemented: ["verifying", "blocked"],
  verifying: ["completed", "blocked", "implemented"],
  blocked: ["classified", "discovered"],
  completed: [],
};

/** True when moving from one state to another is a legitimate path. */
export function canTransition(from: WorkflowState, to: WorkflowState): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

function baseForTier(tier: TaskTier): WorkflowSelection {
  switch (tier) {
    case "trivial":
      return {
        tier,
        roles: [],
        states: ["classified", "verifying", "completed"],
        reason: "trivial: main session only, gate before finish",
      };
    case "standard":
      return {
        tier,
        roles: ["builder", "reviewer"],
        states: ["classified", "implemented", "verifying", "completed"],
        reason: "standard: build plus fresh-window review",
      };
    case "complex":
      return {
        tier,
        roles: ["scout", "architect", "builder", "reviewer"],
        states: ["classified", "discovered", "planned", "implemented", "verifying", "completed"],
        reason: "complex: full discover-plan-build-verify chain",
      };
  }
}

/**
 * Risk-aware workflow selection. Minimum workflow for the task:
 * ambiguous blocks for clarification first; security-sensitive never skips
 * independent verification; otherwise tier by surface (trivial/standard/complex).
 */
export function selectWorkflow(facts: TaskFacts): WorkflowSelection {
  if (facts.ambiguous) {
    return {
      tier: "trivial",
      roles: [],
      states: ["classified", "blocked"],
      reason: "ambiguous: ask before acting; no files change until clarified",
    };
  }
  let tier: TaskTier;
  if (facts.isQuestion || facts.fileCount <= 1) tier = "trivial";
  else if (!facts.crossesModules) tier = "standard";
  else tier = "complex";
  const sel = baseForTier(tier);
  if (facts.securitySensitive && tier !== "trivial") {
    // Security-sensitive work keeps the reviewer even if the caller trimmed crew.
    const roles: CrewId[] = sel.roles.includes("reviewer")
      ? [...sel.roles]
      : [...sel.roles, "reviewer"];
    return {
      ...sel,
      roles,
      states: ["classified", "discovered", "planned", "implemented", "verifying", "completed"],
      reason: `${sel.reason}; security-sensitive: full chain with independent verification`,
    };
  }
  return sel;
}

export type Handoff = {
  goal: string;
  constraints: string;
  files: string[];
  doneMeans: string;
  outOfScope: string;
};

/** Validate a 12-line handoff card. Returns problems (empty = valid). */
export function validateHandoff(h: Handoff): string[] {
  const problems: string[] = [];
  if (!h.goal.trim()) problems.push("goal is empty");
  if (!h.doneMeans.trim()) problems.push("doneMeans is empty");
  if (h.files.length === 0) problems.push("files is empty: cite at least one path or range");
  const lines = [h.goal, h.constraints, h.doneMeans, h.outOfScope].join("\n").split("\n").length;
  if (lines > 12) problems.push(`handoff is ${lines} lines (max 12)`);
  for (const f of h.files) {
    if (f.includes("\n") || f.length > 160)
      problems.push(`file entry looks pasted, not cited: ${f.slice(0, 40)}`);
  }
  return problems;
}
