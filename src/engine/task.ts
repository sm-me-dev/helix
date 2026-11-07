// Helix Task Representation, Validation, and Planning (Phase 03)
import fs from "node:fs";
import path from "node:path";
import { selectWorkflow, type TaskFacts, type TaskTier } from "../workflow.ts";
import type { PlanStep, TaskConstraints, TaskDefinition, TaskPlan, TaskPlanner } from "./types.ts";

export class InvalidTaskInputError extends Error {
  public readonly field?: string;

  constructor(message: string, field?: string) {
    super(`Invalid task definition${field ? ` [${field}]` : ""}: ${message}`);
    this.name = "InvalidTaskInputError";
    this.field = field;
  }
}

export const DEFAULT_FORBIDDEN_PATHS: string[] = ["secrets/", ".env*", ".git/", ".helix/gate.mjs"];

const DEFAULT_TIMEOUT_SEC = 600;
const DEFAULT_MAX_RETRIES = 2;
const HARD_CEILING_RETRIES = 2;

/**
 * Normalizes and strictly validates a task definition.
 * Throws InvalidTaskInputError if requirements are violated.
 */
export function normalizeTaskDefinition(raw: unknown): TaskDefinition {
  if (raw === null || typeof raw !== "object") {
    throw new InvalidTaskInputError("Task definition must be a non-null object");
  }

  const obj = raw as Record<string, unknown>;

  // Prompt validation
  if (typeof obj.prompt !== "string" || obj.prompt.trim().length === 0) {
    throw new InvalidTaskInputError("Prompt must be a non-empty string", "prompt");
  }
  const prompt = obj.prompt.trim();

  // Workspace validation
  if (typeof obj.workspaceRoot !== "string" || obj.workspaceRoot.trim().length === 0) {
    throw new InvalidTaskInputError("Workspace root must be a non-empty string", "workspaceRoot");
  }
  const workspaceRoot = path.resolve(obj.workspaceRoot.trim());
  if (!fs.existsSync(workspaceRoot)) {
    throw new InvalidTaskInputError(
      `Workspace root does not exist on disk: ${workspaceRoot}`,
      "workspaceRoot",
    );
  }
  const stat = fs.statSync(workspaceRoot);
  if (!stat.isDirectory()) {
    throw new InvalidTaskInputError(
      `Workspace root must be a directory: ${workspaceRoot}`,
      "workspaceRoot",
    );
  }

  // ID generation or validation
  let id: string;
  if (typeof obj.id === "string" && obj.id.trim().length > 0) {
    id = obj.id.trim();
  } else {
    const slug = prompt
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .slice(0, 24)
      .replace(/^-|-$/g, "");
    id = `task-${slug || "run"}-${Date.now().toString(36)}`;
  }

  // Title derivation or validation
  let title: string;
  if (typeof obj.title === "string" && obj.title.trim().length > 0) {
    title = obj.title.trim();
  } else {
    title = prompt.split("\n")[0].trim().slice(0, 80);
  }

  // Target files
  let targetFiles: string[] | undefined;
  if (Array.isArray(obj.targetFiles)) {
    targetFiles = obj.targetFiles
      .filter((f): f is string => typeof f === "string" && f.trim().length > 0)
      .map((f) => f.trim());
  }

  // Pass command
  let passCommand: string | undefined;
  if (typeof obj.passCommand === "string" && obj.passCommand.trim().length > 0) {
    passCommand = obj.passCommand.trim();
  }

  const isQuestion = Boolean(obj.isQuestion);
  const securitySensitive = Boolean(obj.securitySensitive);

  // Tier override validation
  let tierOverride: TaskTier | undefined;
  if (typeof obj.tierOverride === "string") {
    if (
      obj.tierOverride === "trivial" ||
      obj.tierOverride === "standard" ||
      obj.tierOverride === "complex"
    ) {
      tierOverride = obj.tierOverride;
    } else {
      throw new InvalidTaskInputError(
        `Invalid tierOverride: ${obj.tierOverride} (must be trivial, standard, or complex)`,
        "tierOverride",
      );
    }
  }

  // Constraints normalization
  const rawConstraints = (obj.constraints as Record<string, unknown> | undefined) || {};

  let timeoutSec = DEFAULT_TIMEOUT_SEC;
  if (typeof rawConstraints.timeoutSec === "number") {
    if (rawConstraints.timeoutSec <= 0 || !Number.isFinite(rawConstraints.timeoutSec)) {
      throw new InvalidTaskInputError(
        "timeoutSec must be a positive finite number",
        "constraints.timeoutSec",
      );
    }
    timeoutSec = rawConstraints.timeoutSec;
  }

  let maxRetries = DEFAULT_MAX_RETRIES;
  if (typeof rawConstraints.maxRetries === "number") {
    if (rawConstraints.maxRetries < 0 || !Number.isInteger(rawConstraints.maxRetries)) {
      throw new InvalidTaskInputError(
        "maxRetries must be a non-negative integer",
        "constraints.maxRetries",
      );
    }
    // Hard ceiling bounded by ADR-006
    maxRetries = Math.min(rawConstraints.maxRetries, HARD_CEILING_RETRIES);
  }

  let maxTurns: number | undefined;
  if (typeof rawConstraints.maxTurns === "number") {
    if (rawConstraints.maxTurns <= 0 || !Number.isInteger(rawConstraints.maxTurns)) {
      throw new InvalidTaskInputError(
        "maxTurns must be a positive integer",
        "constraints.maxTurns",
      );
    }
    maxTurns = rawConstraints.maxTurns;
  }

  // Forbidden paths defaults + custom
  const forbiddenPathsSet = new Set<string>(DEFAULT_FORBIDDEN_PATHS);
  if (Array.isArray(rawConstraints.forbiddenPaths)) {
    for (const p of rawConstraints.forbiddenPaths) {
      if (typeof p === "string" && p.trim().length > 0) {
        forbiddenPathsSet.add(p.trim());
      }
    }
  }

  const requireDiff =
    typeof rawConstraints.requireDiff === "boolean" ? rawConstraints.requireDiff : !isQuestion;

  const constraints: TaskConstraints = {
    timeoutSec,
    maxRetries,
    maxTurns,
    forbiddenPaths: Array.from(forbiddenPathsSet),
    requireDiff,
  };

  const createdAt =
    typeof obj.createdAt === "string" && !Number.isNaN(Date.parse(obj.createdAt))
      ? obj.createdAt
      : new Date().toISOString();

  return {
    id,
    title,
    prompt,
    workspaceRoot,
    targetFiles,
    passCommand,
    constraints,
    tierOverride,
    securitySensitive,
    isQuestion,
    createdAt,
  };
}

/**
 * Checks whether a set of file paths crosses multiple module boundaries.
 */
function checkCrossesModule(files: string[]): boolean {
  if (files.length <= 1) return false;
  const topDirs = new Set<string>();
  for (const f of files) {
    const parts = f.replace(/\\/g, "/").split("/").filter(Boolean);
    topDirs.add(parts.length > 1 ? parts[0] : ".");
  }
  return topDirs.size > 1;
}

/**
 * Default zero-token heuristic task planner.
 * Uses selectWorkflow to determine tier and plan structure.
 */
export class DefaultTaskPlanner implements TaskPlanner {
  async plan(task: TaskDefinition): Promise<TaskPlan> {
    const files = task.targetFiles || [];
    const crossesModules = checkCrossesModule(files);

    const facts: TaskFacts = {
      fileCount: files.length,
      crossesModules,
      isQuestion: Boolean(task.isQuestion),
      securitySensitive: Boolean(task.securitySensitive),
    };

    const selection = selectWorkflow(facts);
    const tier = task.tierOverride ?? selection.tier;

    const isBlocked = selection.states.includes("BLOCKED");
    const steps: PlanStep[] = [];
    if (!isBlocked) {
      // In the baseline single-agent execution model, execution is handled
      // by a single unified agent session.
      steps.push({
        id: "step-1",
        title: "Single-Agent Execution",
        role: "single-agent",
        description: task.prompt,
        targetFiles: files,
        dependencies: [],
        status: "pending",
      });
    }

    const independentReviewRequired = tier === "complex" || Boolean(task.securitySensitive);

    return {
      taskId: task.id,
      tier,
      selection,
      steps,
      reason: selection.reason,
      independentReviewRequired,
      createdAt: new Date().toISOString(),
    };
  }
}
