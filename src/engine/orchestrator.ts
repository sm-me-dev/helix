// Helix Agent Orchestrator & Multi-Role Coordination Engine (Phase 04)
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  HANDOFF_MAX_LINES,
  handoffLineCount,
  serializeHandoff,
  validateHandoff,
  type Handoff,
} from "../workflow.ts";
import { DefaultContextManager } from "./context.ts";
import { DefaultObservabilityCollector } from "./observability.ts";
import { MockAgentRunner } from "./runner.ts";
import {
  getDefaultPermissionsForRole,
  scanSecrets,
  SecurityAuditLogger,
  WorkspaceConflictError,
  WorkspaceLockManager,
} from "./security.ts";
import {
  FileExecutionStateManager,
  HelixTeamRuntime,
  type RootCauseProof,
  type TeamTaskNode,
} from "./state.ts";
import { DEFAULT_FORBIDDEN_PATHS } from "./task.ts";
import {
  type AgentOrchestrator,
  type AgentRole,
  type AgentRunner,
  type ConflictItem,
  type ConflictResolutionResult,
  type ContextManager,
  type EngineExecutionOptions,
  type HandoffCard,
  type ObservabilityCollector,
  type OrchestrationStrategy,
  type PlanStep,
  type ReviewEvidence,
  type ReviewResult,
  type StepExecutionStatus,
  type TaskDefinition,
  type TaskPlan,
  type TaskResult,
  type ValidationEngine,
  type ValidationReport,
} from "./types.ts";
import { DefaultValidationEngine } from "./validator.ts";
import { GitWorktreeManager } from "./worktree.ts";

export type AgentOrchestratorDependencies = {
  runner?: AgentRunner;
  validator?: ValidationEngine;
  contextManager?: ContextManager;
  worktreeManager?: GitWorktreeManager;
  observability?: ObservabilityCollector;
};

export type StepExecutionOutcome = {
  stepId: string;
  role: AgentRole;
  status: StepExecutionStatus;
  worktreePath: string;
  branchName?: string;
  diff: string;
  affectedFiles: string[];
  stdout: string;
  stderr: string;
  durationMs: number;
  tokens?: { input: number; output: number; cacheRead?: number };
  error?: string;
};

function cleanText(s: string | undefined): string {
  if (!s) return "";
  return s
    .replace(/[\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Default implementation of Helix Agent Orchestrator.
 * Supports task decomposition, dependency DAG execution, parallel isolated workspaces,
 * 12-line handoff cards, independent review verification, and conflict detection.
 */
export class DefaultAgentOrchestrator implements AgentOrchestrator {
  private readonly runner: AgentRunner;
  private readonly validator: ValidationEngine;
  private readonly contextManager: ContextManager;
  private readonly worktreeManager: GitWorktreeManager;
  private readonly activeRuns = new Map<string, { abort: (reason: string) => void }>();
  private readonly runningSessions = new Map<string, Set<string>>();

  constructor(deps: AgentOrchestratorDependencies = {}) {
    this.runner = deps.runner || new MockAgentRunner();
    this.validator = deps.validator || new DefaultValidationEngine();
    this.contextManager = deps.contextManager || new DefaultContextManager();
    this.worktreeManager = deps.worktreeManager || new GitWorktreeManager();
  }

  createTeamRuntime(options: {
    workspaceRoot: string;
    teamId: string;
    tasks?: readonly TeamTaskNode[];
    onStatus?: ConstructorParameters<typeof HelixTeamRuntime>[0]["onStatus"];
  }): HelixTeamRuntime {
    return new HelixTeamRuntime(options);
  }

  spawnHypothesisTeam(
    runtime: HelixTeamRuntime,
    options: Parameters<HelixTeamRuntime["spawnHypothesisTeam"]>[0],
  ): Promise<RootCauseProof> {
    return runtime.spawnHypothesisTeam(options);
  }

  /**
   * Serializes and validates a strict 12-line handoff card.
   * If input files or text would exceed 12 lines, compacts files to fit within HANDOFF_MAX_LINES.
   */
  createHandoff(fields: {
    goal: string;
    constraints?: string;
    file?: string;
    files?: string[];
    done?: string;
    doneMeans?: string;
    outOfScope?: string;
  }): HandoffCard {
    const goal = cleanText(fields.goal) || "Execute task";
    const constraints = cleanText(fields.constraints) || "Preserve invariants; gate must pass";
    const doneMeans = cleanText(fields.doneMeans || fields.done) || "Mechanical gate passes";
    const outOfScope = cleanText(fields.outOfScope) || "Unrelated modules";

    let rawFiles: string[] = [];
    if (Array.isArray(fields.files) && fields.files.length > 0) {
      rawFiles = fields.files.map(cleanText).filter(Boolean);
    } else if (fields.file) {
      rawFiles = fields.file
        .split(/[,;\s]+/)
        .map(cleanText)
        .filter(Boolean);
    }
    if (rawFiles.length === 0) {
      rawFiles = ["."];
    }

    // A handoff template has:
    // 1 line goal + 1 line constraints + N lines files + 1 line done + 1 line outOfScope = 4 + N lines.
    // If N > 8, max allowed files is 8 so total <= 12 lines.
    const maxFiles = Math.max(1, HANDOFF_MAX_LINES - 4);
    const files = rawFiles.slice(0, maxFiles);

    const handoffPayload: Handoff = {
      goal,
      constraints,
      files,
      doneMeans,
      outOfScope,
    };

    const serializedText = serializeHandoff(handoffPayload);
    const lineCount = handoffLineCount(handoffPayload);
    const validationProblems = validateHandoff(handoffPayload);

    if (validationProblems.length > 0) {
      // If validation produced errors, attempt strict fallback
      const fallback: Handoff = {
        goal: goal.slice(0, 100),
        constraints: constraints.slice(0, 100),
        files: [files[0] || "."],
        doneMeans: doneMeans.slice(0, 100),
        outOfScope: outOfScope.slice(0, 100),
      };
      return {
        goal: fallback.goal,
        constraints: fallback.constraints || "",
        file: fallback.files.join(", "),
        done: fallback.doneMeans,
        outOfScope: fallback.outOfScope || "",
        serializedText: serializeHandoff(fallback),
        lineCount: handoffLineCount(fallback),
      };
    }

    return {
      goal,
      constraints,
      file: files.join(", "),
      done: doneMeans,
      outOfScope,
      serializedText,
      lineCount,
    };
  }

  /**
   * Decomposes a task into structured PlanSteps based on task facts and strategy.
   */
  async decomposeTask(
    task: TaskDefinition,
    strategy: OrchestrationStrategy = "chain",
  ): Promise<TaskPlan> {
    const files = task.targetFiles || [];
    const isSecurity = Boolean(task.securitySensitive);
    const tier = task.tierOverride || (files.length > 3 || isSecurity ? "complex" : "standard");

    const steps: PlanStep[] = [];

    switch (strategy) {
      case "single-agent": {
        steps.push({
          id: "step-implementer",
          title: "Single-Agent Implementation",
          role: "single-agent",
          description: task.prompt,
          targetFiles: files,
          dependencies: [],
          status: "pending",
        });
        break;
      }

      case "single-agent-with-planning": {
        steps.push({
          id: "step-planner",
          title: "Task Surface & Plan Analysis",
          role: "planner",
          description: `Analyze requirements and plan changes for: ${task.prompt}`,
          targetFiles: files,
          dependencies: [],
          status: "pending",
        });
        steps.push({
          id: "step-implementer",
          title: "Targeted Implementation",
          role: "implementer",
          description: task.prompt,
          targetFiles: files,
          dependencies: ["step-planner"],
          status: "pending",
        });
        break;
      }

      case "multiple-implementers": {
        steps.push({
          id: "step-planner",
          title: "Architecture & Modular Decomposition",
          role: "planner",
          description: `Decompose task into modular subtasks: ${task.prompt}`,
          targetFiles: files,
          dependencies: [],
          status: "pending",
        });

        const partition = files.length > 0 ? files : ["default-target"];
        for (let i = 0; i < partition.length; i++) {
          const target = partition[i];
          const prevDep = i === 0 ? "step-planner" : `step-implementer-${i - 1}`;
          steps.push({
            id: `step-implementer-${i}`,
            title: `Implement changes for ${target}`,
            role: "implementer",
            description: `Implement required logic for ${target}`,
            targetFiles: [target],
            dependencies: [prevDep],
            status: "pending",
          });
        }
        break;
      }

      case "review":
      case "implementer-plus-reviewer": {
        steps.push({
          id: "step-implementer",
          title: "Core Implementation",
          role: "implementer",
          description: task.prompt,
          targetFiles: files,
          dependencies: [],
          status: "pending",
        });
        steps.push({
          id: "step-reviewer",
          title: "Independent Code Review",
          role: "reviewer",
          description:
            "Review generated diff independently against task requirements and gate invariants.",
          targetFiles: files,
          dependencies: ["step-implementer"],
          status: "pending",
        });
        break;
      }

      case "parallel":
      case "parallel-implementation": {
        steps.push({
          id: "step-planner",
          title: "Parallel Work Decomposition",
          role: "planner",
          description: `Analyze parallel boundaries for: ${task.prompt}`,
          targetFiles: files,
          dependencies: [],
          status: "pending",
        });

        const parallelTargets = files.length >= 2 ? files : ["subtask-a", "subtask-b"];
        const implementerStepIds: string[] = [];

        for (let i = 0; i < parallelTargets.length; i++) {
          const target = parallelTargets[i];
          const stepId = `step-parallel-implementer-${i}`;
          implementerStepIds.push(stepId);
          steps.push({
            id: stepId,
            title: `Parallel Implementer for ${target}`,
            role: "implementer",
            description: `Implement independent changes for ${target}`,
            targetFiles: [target],
            dependencies: ["step-planner"],
            status: "pending",
          });
        }

        steps.push({
          id: "step-integrator",
          title: "Integrate & Verify Merged Changes",
          role: "single-agent",
          description:
            "Integrate all parallel subtask branches into main worktree and resolve conflicts.",
          targetFiles: files,
          dependencies: implementerStepIds,
          status: "pending",
        });

        steps.push({
          id: "step-reviewer",
          title: "Independent Verification",
          role: "reviewer",
          description: "Independent review of integrated diff against gate and task prompt.",
          targetFiles: files,
          dependencies: ["step-integrator"],
          status: "pending",
        });
        break;
      }

      case "chain":
      default: {
        steps.push({
          id: "step-scout",
          title: "Scout Repository Exploration",
          role: "scout",
          description: `Explore repository and map cited files for: ${task.prompt}`,
          targetFiles: files,
          dependencies: [],
          status: "pending",
        });
        steps.push({
          id: "step-architect",
          title: "Architect Decision Table & Plan",
          role: "architect",
          description: "Evaluate options and produce file-level implementation plan.",
          targetFiles: files,
          dependencies: ["step-scout"],
          status: "pending",
        });
        steps.push({
          id: "step-builder",
          title: "Builder Minimal Implementation",
          role: "builder",
          description: task.prompt,
          targetFiles: files,
          dependencies: ["step-architect"],
          status: "pending",
        });
        steps.push({
          id: "step-reviewer",
          title: "Reviewer Independent Verification",
          role: "reviewer",
          description: "Independent PASS/FAIL verification with file:line evidence.",
          targetFiles: files,
          dependencies: ["step-builder"],
          status: "pending",
        });
        break;
      }
    }

    return {
      taskId: task.id,
      tier,
      selection: {
        tier,
        roles: ["scout", "architect", "builder", "reviewer"],
        states: ["classified", "discovered", "planned", "implemented", "verifying", "completed"],
        reason: `Decomposed using ${strategy} strategy`,
        independentReview: isSecurity || tier === "complex" || strategy.includes("review"),
      },
      steps,
      reason: `Multi-agent orchestration plan generated (${strategy})`,
      independentReviewRequired: isSecurity || tier === "complex" || strategy.includes("review"),
      createdAt: new Date().toISOString(),
    };
  }

  /**
   * Aborts active orchestration runs and terminates running agent sessions.
   */
  async abort(taskId: string, reason = "Orchestration aborted"): Promise<void> {
    const handle = this.activeRuns.get(taskId);
    if (handle) {
      handle.abort(reason);
      this.activeRuns.delete(taskId);
    }

    const sessions = this.runningSessions.get(taskId);
    if (sessions) {
      for (const sid of sessions) {
        await this.runner.terminate(sid).catch(() => {});
      }
      this.runningSessions.delete(taskId);
    }
  }

  /**
   * Detects conflicting modifications across subtask outcomes.
   */
  detectConflicts(outcomes: StepExecutionOutcome[]): ConflictResolutionResult {
    const fileOwners = new Map<string, string>();
    const conflicts: ConflictItem[] = [];

    for (const outcome of outcomes) {
      for (const file of outcome.affectedFiles) {
        if (fileOwners.has(file)) {
          const priorOwner = fileOwners.get(file)!;
          conflicts.push({
            file,
            conflictType: "overlapping_files",
            details: `File '${file}' modified concurrently by '${priorOwner}' and '${outcome.stepId}'`,
          });
        } else {
          fileOwners.set(file, outcome.stepId);
        }
      }
    }

    return {
      hasConflicts: conflicts.length > 0,
      conflicts,
      resolved: conflicts.length === 0,
      strategy: conflicts.length > 0 ? "abort" : "force_overwrite",
    };
  }

  /**
   * Applies and integrates diffs from subtask worktrees into target base worktree.
   */
  async integrateSubtaskDiffs(
    targetWorktree: string,
    outcomes: StepExecutionOutcome[],
  ): Promise<ConflictResolutionResult> {
    const conflictCheck = this.detectConflicts(outcomes);
    if (conflictCheck.hasConflicts) {
      return conflictCheck;
    }

    for (const outcome of outcomes) {
      if (!outcome.diff || outcome.diff.trim().length === 0) continue;

      // Apply changes to target directory
      // First attempt git apply if available
      const tempPatchPath = path.join(targetWorktree, `.helix-patch-${outcome.stepId}.patch`);
      fs.writeFileSync(tempPatchPath, outcome.diff, "utf8");

      const applyRes = spawnSync("git", ["apply", "--whitespace=nowarn", tempPatchPath], {
        cwd: targetWorktree,
        encoding: "utf8",
      });

      if (fs.existsSync(tempPatchPath)) {
        try {
          fs.unlinkSync(tempPatchPath);
        } catch {
          // Ignore patch removal error
        }
      }

      if (applyRes.status !== 0) {
        // Fallback: Copy affected files directly from outcome worktree if it exists
        if (fs.existsSync(outcome.worktreePath)) {
          for (const relFile of outcome.affectedFiles) {
            const src = path.join(outcome.worktreePath, relFile);
            const dst = path.join(targetWorktree, relFile);
            if (fs.existsSync(src) && fs.statSync(src).isFile()) {
              fs.mkdirSync(path.dirname(dst), { recursive: true });
              fs.copyFileSync(src, dst);
            }
          }
        } else {
          return {
            hasConflicts: true,
            conflicts: [
              {
                file: outcome.affectedFiles[0] || "unknown",
                conflictType: "patch_failure",
                details: `Git apply failed for step ${outcome.stepId}: ${applyRes.stderr || applyRes.stdout}`,
              },
            ],
            resolved: false,
            strategy: "abort",
            error: `Failed to integrate patch from ${outcome.stepId}`,
          };
        }
      }
    }

    return {
      hasConflicts: false,
      conflicts: [],
      resolved: true,
      strategy: "force_overwrite",
    };
  }

  /**
   * Executes an independent code review of the generated diff.
   * Reviewer receives ONLY task requirements, constraints, done criteria, and the actual diff.
   * Reviewer NEVER receives the implementer's conversational history.
   */
  async reviewChanges(
    task: TaskDefinition,
    diff: string,
    _options: EngineExecutionOptions = {},
  ): Promise<ReviewResult> {
    const sessionId = `${task.id}-reviewer-${Date.now().toString(36)}`;

    // Build strictly bounded reviewer context (no implementer conversation)
    const reviewPrompt = [
      `TASK GOAL: ${task.prompt}`,
      `ACCEPTANCE CRITERIA: ${task.passCommand || "Gate passes; no regressions; no forbidden paths touched"}`,
      `CONSTRAINTS: Forbidden paths: ${task.constraints.forbiddenPaths.join(", ")}; requireDiff: ${task.constraints.requireDiff}`,
      "",
      "ACTUAL CHANGES (UNIFIED DIFF):",
      "```diff",
      diff || "(No diff detected)",
      "```",
      "",
      "INSTRUCTIONS FOR REVIEWER:",
      "1. Evaluate if the diff strictly satisfies the goal without introducing defects.",
      "2. Check that no forbidden paths or secrets are exposed.",
      "3. Format your response with either 'VERDICT: PASS' or 'VERDICT: FAIL'.",
      "4. If FAIL, cite specific file:line evidence.",
    ].join("\n");

    const sessionMessages = [
      {
        role: "user" as const,
        content: reviewPrompt,
        timestamp: new Date().toISOString(),
      },
    ];

    const agentOutput = await this.runner.run({
      sessionId,
      taskId: task.id,
      role: "reviewer",
      platform: this.runner.platform,
      workdir: task.workspaceRoot,
      systemPrompt:
        "You are an adversarial code reviewer. You verify diffs against requirements with strict evidence.",
      messages: sessionMessages,
      timeoutSec: task.constraints.timeoutSec,
    });

    const rawOutput = (agentOutput.stdout || agentOutput.stderr || "").trim();

    // Check for secrets exposed in diff
    const secretScan = scanSecrets(diff);
    if (secretScan.hasSecrets) {
      return {
        verdict: "FAIL",
        summary: `Diff introduces exposed secrets or credentials: ${secretScan.findings.map((f) => f.type).join(", ")}`,
        evidence: secretScan.findings.map((f) => ({
          file: "diff",
          line: f.line,
          issue: `Exposed secret detected: ${f.type}`,
        })),
        rawOutput,
      };
    }

    // Check for forbidden paths touched in diff
    for (const forbidden of DEFAULT_FORBIDDEN_PATHS) {
      if (diff.includes(forbidden.replace("*", ""))) {
        return {
          verdict: "FAIL",
          summary: `Diff touches forbidden path pattern '${forbidden}'`,
          evidence: [
            {
              file: forbidden,
              issue: "Modification of forbidden security path detected in diff",
            },
          ],
          rawOutput,
        };
      }
    }

    // Parse verdict and evidence
    const upper = rawOutput.toUpperCase();
    const isFail =
      upper.includes("VERDICT: FAIL") || upper.includes("FAIL:") || agentOutput.exitCode !== 0;
    const verdict = isFail ? "FAIL" : "PASS";

    const evidenceList: ReviewEvidence[] = [];
    const lines = rawOutput.split("\n");
    for (const line of lines) {
      const match = line.match(/(?:file:)?\s*([a-zA-Z0-9_./-]+\.[a-z0-9]+)(?::(\d+))?[:\s]+(.+)/i);
      if (match && isFail) {
        evidenceList.push({
          file: match[1],
          line: match[2] ? parseInt(match[2], 10) : undefined,
          issue: match[3].trim(),
        });
      }
    }

    return {
      verdict,
      summary: isFail
        ? "Independent reviewer rejected the changes with defects or missing requirements."
        : "Independent review PASSED with verified compliance.",
      evidence: evidenceList,
      rawOutput,
    };
  }

  /**
   * Executes a multi-agent plan using dependency-aware DAG scheduling.
   */
  async orchestrateChain(
    task: TaskDefinition,
    plan: TaskPlan,
    options: EngineExecutionOptions = {},
  ): Promise<TaskResult> {
    return this.executePlanDAG(task, plan, options, false);
  }

  /**
   * Executes subtasks in parallel when their dependencies are satisfied.
   */
  async orchestrateParallel(
    task: TaskDefinition,
    plan: TaskPlan,
    options: EngineExecutionOptions = {},
  ): Promise<TaskResult> {
    return this.executePlanDAG(task, plan, options, true);
  }

  /**
   * Core DAG Engine supporting sequential and parallel step execution.
   */
  private async executePlanDAG(
    task: TaskDefinition,
    plan: TaskPlan,
    options: EngineExecutionOptions,
    allowParallel: boolean,
  ): Promise<TaskResult> {
    const obs = new DefaultObservabilityCollector();
    const securityAuditLogger = new SecurityAuditLogger(task.id);
    const stateManager = new FileExecutionStateManager(task.id, plan.tier, {
      onEvent: options.onEvent,
    });

    let aborted = false;
    let abortReason = "";
    this.activeRuns.set(task.id, {
      abort: (reason: string) => {
        aborted = true;
        abortReason = reason;
      },
    });

    if (!this.runningSessions.has(task.id)) {
      this.runningSessions.set(task.id, new Set());
    }

    // 1. Provision Primary Integration Worktree
    let integrationWorktree = task.workspaceRoot;
    let integrationBranch = "";
    let isEphemeralIntegration = false;

    if (options.isolatedWorktree !== false) {
      const provision = await this.worktreeManager.createWorktree(task.workspaceRoot, task.id);
      integrationWorktree = provision.worktreePath;
      integrationBranch = provision.branch;
      isEphemeralIntegration = provision.isEphemeral;
      stateManager.setWorktreePath(integrationWorktree);

      await stateManager.recordEvent({
        taskId: task.id,
        type: "worktree_created",
        workflowState: "discovered",
        payload: {
          worktreePath: integrationWorktree,
          branch: integrationBranch,
          role: "orchestrator",
        },
      });
    }

    // 2. Track Step States
    const stepMap = new Map<string, PlanStep>();
    for (const s of plan.steps) {
      stepMap.set(s.id, { ...s, status: "pending" });
    }

    const stepOutcomes = new Map<string, StepExecutionOutcome>();
    const allocatedWorktrees: Array<{ path: string; branch?: string }> = [];

    let currentHandoffCard: HandoffCard = this.createHandoff({
      goal: task.prompt,
      constraints: `Forbidden: ${task.constraints.forbiddenPaths.join(", ")}`,
      files: task.targetFiles || ["."],
      doneMeans: task.passCommand || "Gate passes without regressions",
    });

    await stateManager.recordEvent({
      taskId: task.id,
      type: "handoff_created",
      workflowState: "planned",
      payload: {
        lineCount: currentHandoffCard.lineCount,
        card: currentHandoffCard.serializedText,
      },
    });

    // 3. Execution DAG Loop
    let cycle = 0;
    const maxCycles = plan.steps.length * 3 + 5;

    try {
      while (cycle++ < maxCycles) {
        if (aborted) break;

        const allSteps = Array.from(stepMap.values());
        const pendingSteps = allSteps.filter((s) => s.status === "pending");
        const runningSteps = allSteps.filter((s) => s.status === "running");

        if (pendingSteps.length === 0 && runningSteps.length === 0) {
          // All steps resolved
          break;
        }

        // Find steps ready to execute: dependencies all 'completed'
        const readySteps = pendingSteps.filter((step) => {
          return step.dependencies.every((depId) => {
            const dep = stepMap.get(depId);
            return dep && dep.status === "completed";
          });
        });

        // Check for failed dependencies
        for (const step of pendingSteps) {
          const hasFailedDep = step.dependencies.some((depId) => {
            const dep = stepMap.get(depId);
            return (
              dep &&
              (dep.status === "failed" || dep.status === "cancelled" || dep.status === "skipped")
            );
          });
          if (hasFailedDep) {
            step.status = "skipped";
            await stateManager.recordEvent({
              taskId: task.id,
              type: "step_failed",
              workflowState: "implemented",
              payload: { stepId: step.id, reason: "Prerequisite dependency failed or cancelled" },
            });
          }
        }

        if (readySteps.length === 0 && runningSteps.length === 0) {
          // Deadlock or cycle detected among remaining pending steps
          for (const s of pendingSteps) {
            s.status = "failed";
          }
          break;
        }

        // Determine batch: if parallel execution is enabled, run all ready steps concurrently;
        // otherwise execute one at a time.
        const batch = allowParallel ? readySteps : readySteps.slice(0, 1);

        for (const s of batch) {
          s.status = "running";
        }

        // Execute batch steps
        const stepPromises = batch.map(async (step) => {
          return this.runSingleStep({
            task,
            step,
            integrationWorktree,
            currentHandoffCard,
            options,
            stateManager,
            obs,
            allocatedWorktrees,
            isParallel: allowParallel && batch.length > 1,
            securityAuditLogger,
          });
        });

        const batchResults = await Promise.all(stepPromises);

        for (const outcome of batchResults) {
          stepOutcomes.set(outcome.stepId, outcome);
          const stepObj = stepMap.get(outcome.stepId);
          if (stepObj) {
            stepObj.status = outcome.status;
            stepObj.output = {
              stdout: outcome.stdout,
              diff: outcome.diff,
              affectedFiles: outcome.affectedFiles,
              error: outcome.error,
            };
          }

          if (outcome.status === "completed") {
            // Update handoff card with cited files for next steps
            if (outcome.affectedFiles.length > 0) {
              currentHandoffCard = this.createHandoff({
                goal: task.prompt,
                constraints: `Forbidden: ${task.constraints.forbiddenPaths.join(", ")}`,
                files: outcome.affectedFiles,
                doneMeans: task.passCommand || "Gate passes without regressions",
              });
            }
          }
        }
      }

      if (aborted) {
        throw new Error(abortReason || "Task aborted by user");
      }

      // Verify that no required steps failed or were skipped
      const failedSteps = Array.from(stepMap.values()).filter(
        (s) => s.status === "failed" || s.status === "skipped",
      );
      if (failedSteps.length > 0) {
        const failureDetails = failedSteps
          .map(
            (s) => `${s.id} (${s.role}): ${s.status} - ${s.output?.error || "prerequisite failed"}`,
          )
          .join("; ");
        throw new Error(`Orchestration step execution failed: ${failureDetails}`);
      }

      // 4. Integrate parallel subtask diffs into primary integration worktree
      const parallelImplementerOutcomes = Array.from(stepOutcomes.values()).filter(
        (o) => o.status === "completed" && o.diff && o.worktreePath !== integrationWorktree,
      );

      if (parallelImplementerOutcomes.length > 0) {
        await stateManager.recordEvent({
          taskId: task.id,
          type: "integration_started",
          workflowState: "verifying",
          payload: { subtaskCount: parallelImplementerOutcomes.length },
        });

        const integrationResult = await this.integrateSubtaskDiffs(
          integrationWorktree,
          parallelImplementerOutcomes,
        );

        if (integrationResult.hasConflicts) {
          await stateManager.recordEvent({
            taskId: task.id,
            type: "conflict_detected",
            workflowState: "verifying",
            payload: { conflicts: integrationResult.conflicts },
          });

          throw new Error(
            `Orchestration integration conflict: ${integrationResult.conflicts.map((c) => `${c.file} (${c.conflictType})`).join(", ")}`,
          );
        }

        await stateManager.recordEvent({
          taskId: task.id,
          type: "integration_completed",
          workflowState: "verifying",
          payload: { resolved: true },
        });
      }

      // 5. Extract Integrated Diff
      const integratedDiffResult = await this.worktreeManager.extractDiff(integrationWorktree);

      // 6. Mechanical Gate Validation on Integrated Result
      await stateManager.recordEvent({
        taskId: task.id,
        type: "gate_started",
        workflowState: "verifying",
        payload: { worktreePath: integrationWorktree, passCommand: task.passCommand },
      });

      const validationReport: ValidationReport = task.isQuestion
        ? { passed: true, durationMs: 0, checks: [] }
        : await this.validator.validate(integrationWorktree, task.passCommand);

      obs.recordGateRun(validationReport.durationMs, validationReport.passed);

      if (!validationReport.passed) {
        await stateManager.recordEvent({
          taskId: task.id,
          type: "gate_failed",
          workflowState: "verifying",
          payload: { failingStage: validationReport.failingStage },
        });
        throw new Error(
          `Gate validation failed: ${this.validator.extractDiagnostics(validationReport)}`,
        );
      }

      // 7. Independent Review Verification if required
      if (plan.independentReviewRequired) {
        await stateManager.recordEvent({
          taskId: task.id,
          type: "review_started",
          workflowState: "verifying",
          payload: { reviewerRole: "reviewer" },
        });

        const reviewResult = await this.reviewChanges(task, integratedDiffResult.diff, options);

        await stateManager.recordEvent({
          taskId: task.id,
          type: "review_completed",
          workflowState: "verifying",
          payload: { verdict: reviewResult.verdict, evidence: reviewResult.evidence },
        });

        if (reviewResult.verdict === "FAIL") {
          throw new Error(`Independent review failed: ${reviewResult.summary}`);
        }
      }

      // Success completion
      await stateManager.recordEvent({
        taskId: task.id,
        type: "gate_passed",
        workflowState: "completed",
        payload: { checksRun: validationReport.checks.length },
      });

      await stateManager.recordEvent({
        taskId: task.id,
        type: "task_completed",
        workflowState: "completed",
        payload: { affectedFiles: integratedDiffResult.affectedFiles },
      });

      // Cleanup ephemeral worktrees
      for (const wt of allocatedWorktrees) {
        await this.worktreeManager.cleanupWorktree(task.workspaceRoot, wt.path, wt.branch);
      }
      if (isEphemeralIntegration) {
        await this.worktreeManager.cleanupWorktree(
          task.workspaceRoot,
          integrationWorktree,
          integrationBranch,
          false,
        );
      }

      this.activeRuns.delete(task.id);
      this.runningSessions.delete(task.id);
      obs.recordSecuritySummary?.(securityAuditLogger.getSummary());
      const metrics = await obs.generateReport(task.id);

      return {
        taskId: task.id,
        status: "succeeded",
        finalWorkflowState: "completed",
        diff: integratedDiffResult.diff,
        affectedFiles: integratedDiffResult.affectedFiles,
        summary: `Multi-agent orchestration (${allowParallel ? "parallel" : "chain"}) completed successfully.`,
        validation: validationReport,
        metrics,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const isAbort = aborted || msg.includes("aborted");

      await stateManager.recordEvent({
        taskId: task.id,
        type: "task_failed",
        workflowState: isAbort ? "blocked" : "implemented",
        payload: { error: msg, aborted: isAbort },
      });

      // Cleanup on failure
      for (const wt of allocatedWorktrees) {
        await this.worktreeManager
          .cleanupWorktree(task.workspaceRoot, wt.path, wt.branch)
          .catch(() => {});
      }
      if (isEphemeralIntegration) {
        await this.worktreeManager
          .cleanupWorktree(task.workspaceRoot, integrationWorktree, integrationBranch)
          .catch(() => {});
      }

      this.activeRuns.delete(task.id);
      this.runningSessions.delete(task.id);
      obs.recordSecuritySummary?.(securityAuditLogger.getSummary());
      const metrics = await obs.generateReport(task.id);

      return {
        taskId: task.id,
        status: isAbort ? "cancelled" : "failed",
        finalWorkflowState: "blocked",
        diff: "",
        affectedFiles: [],
        summary: `Orchestration ${isAbort ? "cancelled" : "failed"}: ${msg}`,
        validation: { passed: false, durationMs: 0, checks: [] },
        metrics,
        error: {
          code: isAbort ? "TASK_ABORTED" : "ORCHESTRATION_FAILURE",
          message: msg,
          retryCount: 0,
        },
      };
    }
  }

  /**
   * Runs an individual PlanStep within its designated worktree (ephemeral if parallel).
   */
  private async runSingleStep(params: {
    task: TaskDefinition;
    step: PlanStep;
    integrationWorktree: string;
    currentHandoffCard: HandoffCard;
    options: EngineExecutionOptions;
    stateManager: FileExecutionStateManager;
    obs: DefaultObservabilityCollector;
    allocatedWorktrees: Array<{ path: string; branch?: string }>;
    isParallel: boolean;
    securityAuditLogger?: SecurityAuditLogger;
  }): Promise<StepExecutionOutcome> {
    const {
      task,
      step,
      integrationWorktree,
      currentHandoffCard,
      options,
      stateManager,
      obs,
      allocatedWorktrees,
      isParallel,
      securityAuditLogger,
    } = params;

    let stepWorktree = integrationWorktree;
    let stepBranch: string | undefined;

    // For parallel implementers, provision an isolated ephemeral worktree
    if (isParallel && step.role.includes("implementer") && options.isolatedWorktree !== false) {
      const provision = await this.worktreeManager.createWorktree(
        task.workspaceRoot,
        `${task.id}-${step.id}`,
      );
      stepWorktree = provision.worktreePath;
      stepBranch = provision.branch;
      allocatedWorktrees.push({ path: stepWorktree, branch: stepBranch });
    }

    const lockOwner = `${task.id}-${step.id}`;
    if (options.isolatedWorktree !== false) {
      const acquired = WorkspaceLockManager.acquireLock(stepWorktree, lockOwner);
      if (!acquired) {
        const currentOwner = WorkspaceLockManager.getLockOwner(stepWorktree) || "unknown";
        throw new WorkspaceConflictError(stepWorktree, currentOwner, lockOwner);
      }
    }

    try {
      const sessionId = `${task.id}-${step.id}-${Date.now().toString(36)}`;
      const sessionSet = this.runningSessions.get(task.id);
      if (sessionSet) {
        sessionSet.add(sessionId);
      }

      await stateManager.recordEvent({
        taskId: task.id,
        type: "step_started",
        workflowState: "implemented",
        payload: { stepId: step.id, role: step.role, worktreePath: stepWorktree },
      });

      const stepPermissions = getDefaultPermissionsForRole(step.role);
      securityAuditLogger?.log({
        type: "permission_check",
        severity: "info",
        role: step.role,
        message: `Assigned least-privilege boundary for step role '${step.role}'`,
        details: { stepId: step.id, permissions: Array.from(stepPermissions.permissions) },
      });

      // Step Prompt combines handoff card with step description
      const stepPrompt = [
        `HANDOFF CONTRACT (MAX 12 LINES):`,
        currentHandoffCard.serializedText,
        "",
        `STEP ASSIGNMENT (${step.role.toUpperCase()}):`,
        step.description,
        step.targetFiles.length > 0 ? `Target Files: ${step.targetFiles.join(", ")}` : "",
      ]
        .filter(Boolean)
        .join("\n");

      const t0 = Date.now();
      const agentOutput = await this.runner.run({
        sessionId,
        taskId: task.id,
        role: step.role,
        platform: this.runner.platform,
        workdir: stepWorktree,
        systemPrompt: `You are the ${step.role} agent in Helix. Work strictly within cited files.`,
        messages: [
          {
            role: "user",
            content: stepPrompt,
            timestamp: new Date().toISOString(),
          },
        ],
        timeoutSec: task.constraints.timeoutSec,
      });

      const durationMs = Date.now() - t0;
      obs.recordAgentDuration(durationMs);
      if (agentOutput.tokens) {
        const usage = {
          inputTokens: agentOutput.tokens.input,
          outputTokens: agentOutput.tokens.output,
          cacheReadTokens: agentOutput.tokens.cacheRead ?? 0,
          totalTokens: agentOutput.tokens.input + agentOutput.tokens.output,
        };
        obs.recordTokenUsage(usage);
        obs.recordRoleTokenUsage?.(step.role, usage);
        // Context reuse benefit: 12-line handoff saves ~1,200 tokens over forwarding raw transcript
        obs.recordContextReuse?.(1200);
      }

      const diffResult = await this.worktreeManager.extractDiff(stepWorktree);
      const isSuccess = agentOutput.exitCode === 0 && !agentOutput.interrupted;
      const status: StepExecutionStatus = isSuccess ? "completed" : "failed";

      await stateManager.recordEvent({
        taskId: task.id,
        type: isSuccess ? "step_completed" : "step_failed",
        workflowState: "implemented",
        payload: {
          stepId: step.id,
          role: step.role,
          exitCode: agentOutput.exitCode,
          affectedFiles: diffResult.affectedFiles,
        },
      });

      return {
        stepId: step.id,
        role: step.role,
        status,
        worktreePath: stepWorktree,
        branchName: stepBranch,
        diff: diffResult.diff,
        affectedFiles: diffResult.affectedFiles,
        stdout: agentOutput.stdout,
        stderr: agentOutput.stderr,
        durationMs,
        tokens: agentOutput.tokens,
        error: isSuccess ? undefined : agentOutput.stderr || "Step execution failed",
      };
    } finally {
      if (options.isolatedWorktree !== false) {
        WorkspaceLockManager.releaseLock(stepWorktree, lockOwner);
      }
    }
  }
}
