// Adaptive workflow orchestration: risk-aware tier selection, the Helix v2
// lifecycle and execution modes, and handoff contracts. Legacy role labels
// remain for callers; the selected runtime topology is recorded separately.
//
// This file is the single source of truth for shared workflow policy: the
// tier table, the security rule, and the handoff size limit. `selectWorkflow`
// (executable decision), `simulation.pickTier` (demo), and the Dispatch rules
// in generated AGENTS.md (`dispatchRules`) all derive from it, so they cannot
// drift apart. Tests compare the three.
//
// Enforcement boundary: this module only *decides and describes*. It does not
// start a reviewer, and nothing here can prove one ran in a separate context.
// `independentReview: true` and the generated rules are requirements on the
// host agent. The only mechanical check Helix runs itself is `helix gate`
// (secrets, lint, typecheck, tests).
import type { CrewId } from "./types.ts";
import type { ExecutionModeId } from "./crew.ts";

export type WorkflowState = "INIT" | "DISCOVER" | "EXECUTE" | "VERIFY" | "COMPLETE" | "BLOCKED";

export type TaskTier = "trivial" | "standard" | "complex";

export type WorkflowSelection = {
  tier: TaskTier;
  /** Ordered logical roles for this task. Manager (main session) is implicit. */
  roles: CrewId[];
  /** Allowed state path, including legitimate skips. */
  states: WorkflowState[];
  /** Helix v2 execution topologies selected for the task. */
  executionModes: ExecutionModeId[];
  /** Why this tier was chosen (for reports, not prompts). */
  reason: string;
  /**
   * A fresh-window reviewer must verify before completion. A requirement on
   * the host agent, not proof that a separate reviewer actually ran.
   */
  independentReview: boolean;
};

export type TaskFacts = {
  /** Files the task will change. Must be a non-negative integer unless `isQuestion`. */
  fileCount: number;
  crossesModules: boolean;
  /**
   * Informational only: answering changes no code. Anything that edits files
   * is NOT a question, however it is phrased; reclassify it before editing.
   */
  isQuestion: boolean;
  /**
   * Security-sensitive: auth, permissions, secrets, crypto, sandbox/trust
   * boundaries. Omitted means "not flagged": the caller owns this judgement,
   * so pass true when unsure. A truthy value is treated as sensitive.
   */
  securitySensitive?: boolean;
  /** Requirements have two or more plausible readings. */
  ambiguous?: boolean;
};

const TIER_ORDER: TaskTier[] = ["trivial", "standard", "complex"];

const FULL_CHAIN: WorkflowState[] = ["INIT", "DISCOVER", "EXECUTE", "VERIFY", "COMPLETE"];

/** Canonical tier table. `when` and `roles` also feed the generated rules. */
export const TIER_POLICY: Record<
  TaskTier,
  {
    when: string;
    roles: CrewId[];
    states: WorkflowState[];
    executionModes: ExecutionModeId[];
    reason: string;
  }
> = {
  trivial: {
    when: "question, or one clear file",
    roles: [],
    states: FULL_CHAIN,
    executionModes: ["MODE_1_MASTER_LOOP"],
    reason: "trivial: main session only, gate before finish",
  },
  standard: {
    when: "known files, one module",
    roles: ["builder", "reviewer"],
    states: FULL_CHAIN,
    executionModes: ["MODE_1_MASTER_LOOP", "MODE_3_ADVERSARIAL_AUDITOR"],
    reason: "standard: build plus fresh-window review",
  },
  complex: {
    when: "unknown surface or cross-module",
    roles: ["scout", "architect", "builder", "reviewer"],
    states: FULL_CHAIN,
    executionModes: [
      "MODE_1_MASTER_LOOP",
      "MODE_2_DISPOSABLE_SCOUT",
      "MODE_3_ADVERSARIAL_AUDITOR",
      "MODE_4_PEER_TEAM",
    ],
    reason: "complex: full discover-execute-verify lifecycle",
  },
};

/**
 * Invariant: a security-sensitive change never skips independent
 * verification because its file count or estimated complexity is low.
 * Informational questions are not changes and stay light.
 */
export const SECURITY_POLICY = {
  scope: "auth, permissions, secrets, crypto, sandbox",
  minTier: "standard" as TaskTier,
  roles: ["reviewer"] as CrewId[],
  states: FULL_CHAIN,
  executionModes: ["MODE_1_MASTER_LOOP", "MODE_3_ADVERSARIAL_AUDITOR"],
};

/** Maximum lines in a serialized handoff card (see `serializeHandoff`). */
export const HANDOFF_MAX_LINES = 12;

const TRANSITIONS: Record<WorkflowState, WorkflowState[]> = {
  INIT: ["DISCOVER", "BLOCKED"],
  DISCOVER: ["EXECUTE", "BLOCKED"],
  EXECUTE: ["VERIFY", "BLOCKED"],
  VERIFY: ["COMPLETE", "EXECUTE", "BLOCKED"],
  COMPLETE: [],
  BLOCKED: [],
};

/** True when moving from one state to another is a legitimate path. */
export function canTransition(from: WorkflowState, to: WorkflowState): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

function baseForTier(tier: TaskTier): WorkflowSelection {
  const p = TIER_POLICY[tier];
  return {
    tier,
    roles: [...p.roles],
    states: [...p.states],
    executionModes: [...p.executionModes],
    reason: p.reason,
    independentReview: p.roles.includes("reviewer"),
  };
}

function blocked(reason: string): WorkflowSelection {
  return {
    tier: "trivial",
    roles: [],
    states: ["INIT", "BLOCKED"],
    executionModes: ["MODE_1_MASTER_LOOP"],
    reason,
    independentReview: false,
  };
}

/**
 * Surface-only tier (no security input). Shared by `selectWorkflow` and the
 * demo's `pickTier` so the thresholds exist once.
 */
export function classifyTier(
  facts: Pick<TaskFacts, "fileCount" | "crossesModules" | "isQuestion">,
): TaskTier {
  if (facts.isQuestion || facts.fileCount <= 1) return "trivial";
  if (!facts.crossesModules) return "standard";
  return "complex";
}

/**
 * Risk-aware workflow selection. Minimum workflow for the task:
 * - ambiguous or malformed facts block for clarification first (fail closed);
 * - an informational question stays trivial, even a security-related one;
 * - a security-sensitive change is raised to at least `SECURITY_POLICY.minTier`
 *   with the full chain and a required reviewer, whatever its file count;
 * - otherwise tier by surface (trivial/standard/complex).
 * Missing `crossesModules` is treated as crossing (the heavier tier).
 */
export function selectWorkflow(facts: TaskFacts): WorkflowSelection {
  if (facts == null || typeof facts !== "object") {
    return blocked("task facts missing: classify before acting");
  }
  if (facts.ambiguous) {
    return blocked("ambiguous: ask before acting; no files change until clarified");
  }
  const security = Boolean(facts.securitySensitive);
  if (facts.isQuestion === true) {
    const sel = baseForTier("trivial");
    if (security) {
      sel.reason +=
        "; security-related question: answer only, reclassify as a change before editing";
    }
    return sel;
  }
  const n = facts.fileCount;
  if (typeof n !== "number" || !Number.isInteger(n) || n < 0) {
    return blocked("task facts invalid: fileCount must be a non-negative integer");
  }
  let tier = classifyTier({
    fileCount: n,
    crossesModules: facts.crossesModules !== false,
    isQuestion: false,
  });
  if (security && TIER_ORDER.indexOf(tier) < TIER_ORDER.indexOf(SECURITY_POLICY.minTier)) {
    tier = SECURITY_POLICY.minTier;
  }
  const sel = baseForTier(tier);
  if (!security) return sel;
  // Security-sensitive work keeps the reviewer even if tier roles were trimmed.
  const roles = [...sel.roles, ...SECURITY_POLICY.roles.filter((r) => !sel.roles.includes(r))];
  return {
    ...sel,
    roles,
    states: [...SECURITY_POLICY.states],
    reason: `${sel.reason}; security-sensitive: full chain with independent verification`,
    independentReview: roles.includes("reviewer"),
  };
}

/**
 * Rules for a pack that installs no subagents (`helix init` without `--crew`): there is no one
 * to dispatch, so the tier table would only describe roles that do not exist. The security
 * invariant survives as a self-check, because it never depended on a separate window existing.
 */
function noCrewRules(): string[] {
  return [
    "- No subagents installed: work in the main session (add roles with `helix init --crew`).",
    `- Security-sensitive (${SECURITY_POLICY.scope}): never skip the gate; re-read your own diff cold and list what you could not verify. Unsure: assume sensitive. Security questions: answer only.`,
  ];
}

/**
 * Dispatch rules for generated AGENTS.md, derived from the policy above. `available` is the
 * installed crew: omitted means the full policy (the demo and policy tests); empty means none.
 */
export function dispatchRules(available?: readonly CrewId[]): string[] {
  if (available && available.length === 0) return noCrewRules();
  const names = (roles: CrewId[], fresh: boolean) =>
    roles.map((r) => (fresh && r === "reviewer" ? "fresh-window reviewer" : r)).join(", ");
  const tiers = TIER_ORDER.map((t) => {
    const p = TIER_POLICY[t];
    return `- ${t} (${p.when}): ${p.roles.length ? names(p.roles, true) : "main session only"}.`;
  });
  const s = SECURITY_POLICY;
  return [
    ...tiers,
    `- Security-sensitive (${s.scope}): even one file is never ${TIER_ORDER[0]}; min ${s.minTier}, ${names(s.roles, false)} must pass. Unsure: assume sensitive. Security questions: answer only.`,
    `- Handoff: ${HANDOFF_MAX_LINES} lines max, one per cited file; goal, constraints, files, done-means, out of scope.`,
  ];
}

export type Handoff = {
  goal: string;
  constraints: string;
  files: string[];
  doneMeans: string;
  outOfScope: string;
};

// CRLF, CR, VT, FF, NEL, LS, PS: every separator a terminal or editor may
// render as a line break, so none of them hides lines from the count.
const LINE_BREAKS = /\r\n|[\n\r\v\f\u0085\u2028\u2029]/g;

function clean(v: unknown): string {
  return typeof v === "string" ? v.replace(LINE_BREAKS, "\n").trim() : "";
}

/**
 * Canonical card text: every field is always present, one labelled line per
 * cited file, continuation lines for multi-line values. Counting, validation
 * and display all use this one form; an empty value still occupies its line.
 */
export function serializeHandoff(h: Handoff): string {
  const files = Array.isArray(h?.files) ? h.files.map(clean) : [];
  return [
    `goal: ${clean(h?.goal)}`,
    `constraints: ${clean(h?.constraints)}`,
    ...(files.length ? files : [""]).map((f) => `file: ${f}`),
    `done: ${clean(h?.doneMeans)}`,
    `out of scope: ${clean(h?.outOfScope)}`,
  ].join("\n");
}

/** Lines in the serialized card: the number `HANDOFF_MAX_LINES` limits. */
export function handoffLineCount(h: Handoff): number {
  return serializeHandoff(h).split("\n").length;
}

/** Validate a handoff card. Returns problems (empty = valid). Never throws. */
export function validateHandoff(h: Handoff): string[] {
  if (h == null || typeof h !== "object") return ["handoff must be an object"];
  const problems: string[] = [];
  for (const [name, required] of [
    ["goal", true],
    ["constraints", false],
    ["doneMeans", true],
    ["outOfScope", false],
  ] as const) {
    const v = h[name];
    if (typeof v !== "string") problems.push(`${name} must be a string`);
    else if (required && !clean(v)) problems.push(`${name} is empty`);
  }
  if (!Array.isArray(h.files)) {
    problems.push("files must be an array of cited paths");
  } else {
    if (h.files.length === 0) problems.push("files is empty: cite at least one path or range");
    for (const f of h.files) {
      if (typeof f !== "string") {
        problems.push("file entry must be a string");
        continue;
      }
      const c = clean(f);
      if (!c) problems.push("file entry is empty");
      else if (c.includes("\n") || c.length > 160) {
        problems.push(`file entry looks pasted, not cited: ${c.slice(0, 40).replace(/\n/g, " ")}`);
      }
    }
  }
  const lines = handoffLineCount(h);
  if (lines > HANDOFF_MAX_LINES) {
    problems.push(
      `handoff is ${lines} lines (max ${HANDOFF_MAX_LINES}): cite fewer files or shorten multi-line fields`,
    );
  }
  return problems;
}
