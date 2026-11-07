// Helix Core Execution Engine (Phase 03 - Component 3)
import fs from "node:fs";
import path from "node:path";
import type { WorkflowState } from "../workflow.ts";
import {
  assembleBootstrapSystemPrompt,
  DefaultContextManager,
  TokenBudgetManager,
} from "./context.ts";
import { DefaultObservabilityCollector } from "./observability.ts";
import { DefaultAgentOrchestrator } from "./orchestrator.ts";
import { DefaultRepositoryRetriever } from "./retrieval.ts";
import { MockAgentRunner } from "./runner.ts";
import {
  getDefaultPermissionsForRole,
  SecurityAuditLogger,
  WorkspaceConflictError,
  WorkspaceLockManager,
} from "./security.ts";
import { FileExecutionStateManager } from "./state.ts";
import { DefaultTaskPlanner, normalizeTaskDefinition } from "./task.ts";
import { DefaultToolExecutor } from "./tools.ts";
import type {
  AgentOrchestrator,
  AgentRunner,
  ContextManager,
  EngineExecutionOptions,
  ExecutionStateSnapshot,
  HelixEngine,
  ObservabilityCollector,
  TaskDefinition,
  TaskPlan,
  TaskPlanner,
  TaskResult,
  ToolExecutor,
  ValidationEngine,
  ValidationReport,
} from "./types.ts";
import { TokenBudgetExceededError } from "./types.ts";
import { CrossModelAdversarialValidationEngine, DefaultValidationEngine } from "./validator.ts";
import type { AuditorInvocationOutput, FirewalledAuditPayload } from "./validator.ts";
import { compileTier0DomainRoutes, matchDomainsForFilePath } from "../knowledge/discovery.ts";
import { parseFrontmatter } from "../knowledge/repository.ts";
import type { ModelRoute, ProviderSelection } from "./provider.ts";
import { GitWorktreeManager } from "./worktree.ts";
import { DefaultModelProvider } from "./provider.ts";
import type { ExtendedEngineConfig } from "./config.ts";
import type { ModelProvider } from "./types.ts";

export type HelixExecutionEngineDependencies = {
  planner?: TaskPlanner;
  runner?: AgentRunner;
  validator?: ValidationEngine;
  contextManager?: ContextManager;
  toolExecutor?: ToolExecutor;
  worktreeManager?: GitWorktreeManager;
  observability?: ObservabilityCollector;
  orchestrator?: AgentOrchestrator;
  provider?: ModelProvider;
  config?: ExtendedEngineConfig;
  adversarialAudit?: {
    readonly generatorProvider: ProviderSelection | string;
    readonly invokeAuditor: (
      payload: FirewalledAuditPayload,
      route: ModelRoute,
    ) => Promise<AuditorInvocationOutput>;
  };
};

export class HelixExecutionEngine implements HelixEngine {
  private readonly planner: TaskPlanner;
  private readonly runner: AgentRunner;
  private readonly validator: ValidationEngine;
  private readonly contextManager: ContextManager;
  private readonly toolExecutor: ToolExecutor;
  private readonly worktreeManager: GitWorktreeManager;
  private readonly orchestrator: AgentOrchestrator;
  private readonly provider: ModelProvider;
  private readonly config?: ExtendedEngineConfig;
  private readonly adversarialAudit?: HelixExecutionEngineDependencies["adversarialAudit"];
  private readonly stateManagers = new Map<string, FileExecutionStateManager>();
  private readonly activeRuns = new Map<string, { abort: (reason: string) => void }>();

  constructor(deps: HelixExecutionEngineDependencies = {}) {
    this.planner = deps.planner || new DefaultTaskPlanner();
    this.runner = deps.runner || new MockAgentRunner();
    this.validator = deps.validator || new DefaultValidationEngine();
    this.contextManager = deps.contextManager || new DefaultContextManager();
    this.toolExecutor = deps.toolExecutor || new DefaultToolExecutor();
    this.worktreeManager = deps.worktreeManager || new GitWorktreeManager();
    this.provider = deps.provider || new DefaultModelProvider();
    this.config = deps.config;
    this.adversarialAudit = deps.adversarialAudit;
    this.orchestrator =
      deps.orchestrator ||
      new DefaultAgentOrchestrator({
        runner: this.runner,
        validator: this.validator,
        contextManager: this.contextManager,
        worktreeManager: this.worktreeManager,
        observability: deps.observability,
      });
  }

  async getState(taskId: string): Promise<ExecutionStateSnapshot | null> {
    const manager = this.stateManagers.get(taskId);
    if (manager) {
      return manager.getSnapshot();
    }
    const tempManager = new FileExecutionStateManager(taskId);
    return tempManager.load(taskId);
  }

  async abort(taskId: string, reason = "User aborted task"): Promise<void> {
    const active = this.activeRuns.get(taskId);
    if (active) {
      active.abort(reason);
      this.activeRuns.delete(taskId);
    }
    await this.orchestrator.abort(taskId, reason).catch(() => {});
  }

  async execute(
    taskInput: TaskDefinition,
    options: EngineExecutionOptions = {},
  ): Promise<TaskResult> {
    let task: TaskDefinition;
    try {
      task = normalizeTaskDefinition(taskInput);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const validationReport: ValidationReport = {
        passed: false,
        durationMs: 0,
        checks: [],
      };
      const obs = new DefaultObservabilityCollector();
      const metrics = await obs.generateReport(taskInput?.id || "invalid-task");

      return {
        taskId: taskInput?.id || "invalid-task",
        status: "failed",
        finalWorkflowState: "BLOCKED",
        diff: "",
        affectedFiles: [],
        summary: `Task validation failed: ${msg}`,
        validation: validationReport,
        metrics,
        error: {
          code: "INVALID_TASK_INPUT",
          message: msg,
          retryCount: 0,
        },
      };
    }

    const obs = new DefaultObservabilityCollector();
    const stateManager = new FileExecutionStateManager(task.id, task.tierOverride || "trivial", {
      onEvent: options.onEvent,
    });
    this.stateManagers.set(task.id, stateManager);

    let aborted = false;
    let abortReason = "";
    this.activeRuns.set(task.id, {
      abort: (reason: string) => {
        aborted = true;
        abortReason = reason;
        this.runner.terminate(`${task.id}-active`).catch(() => {});
      },
    });

    // 1. Record task start
    await stateManager.recordEvent({
      taskId: task.id,
      type: "task_started",
      workflowState: "INIT",
      payload: { title: task.title, workspaceRoot: task.workspaceRoot },
    });

    // 2. Assess and Plan
    const plan = await this.planner.plan(task);
    const isBlocked = plan.selection.states.includes("BLOCKED");
    stateManager.setTier(plan.tier);
    await stateManager.recordEvent({
      taskId: task.id,
      type: "tier_classified",
      workflowState: isBlocked ? "BLOCKED" : "INIT",
      payload: {
        tier: plan.tier,
        selectionReason: plan.reason,
        independentReviewRequired: plan.independentReviewRequired,
      },
    });

    if (isBlocked) {
      await stateManager.recordEvent({
        taskId: task.id,
        type: "task_failed",
        workflowState: "BLOCKED",
        payload: { reason: plan.reason },
      });
      this.activeRuns.delete(task.id);
      const metrics = await obs.generateReport(task.id);
      return {
        taskId: task.id,
        status: "blocked",
        finalWorkflowState: "BLOCKED",
        diff: "",
        affectedFiles: [],
        summary: `Task blocked by workflow policy: ${plan.reason}`,
        validation: { passed: false, durationMs: 0, checks: [] },
        metrics,
        error: {
          code: "TASK_BLOCKED",
          message: plan.reason,
          retryCount: 0,
        },
      };
    }

    const taskValidator = this.validatorForTask(task, plan);

    // Check if multi-agent orchestration is requested
    const isSingleAgent = options.singleAgentOnly !== false;
    if (!isSingleAgent) {
      const taskOptions = { ...options, validationEngine: taskValidator };
      const strategy = options.orchestrationStrategy || "chain";
      const decomposedPlan = await this.orchestrator.decomposeTask(task, strategy);

      if (options.dryRun) {
        this.activeRuns.delete(task.id);
        const metrics = await obs.generateReport(task.id);
        return {
          taskId: task.id,
          status: "succeeded",
          finalWorkflowState: "DISCOVER",
          diff: "",
          affectedFiles: [],
          summary: `Dry run completed: multi-agent task planned with ${decomposedPlan.steps.length} steps (${strategy}).`,
          validation: { passed: true, durationMs: 0, checks: [] },
          metrics,
        };
      }

      if (strategy === "parallel" || strategy === "parallel-implementation") {
        return this.orchestrator.orchestrateParallel(task, decomposedPlan, taskOptions);
      }
      return this.orchestrator.orchestrateChain(task, decomposedPlan, taskOptions);
    }

    // 3. Workspace Setup (Ephemeral Git Worktree or direct)
    let worktreePath = task.workspaceRoot;
    let branchName = "";
    let isEphemeral = false;

    if (options.isolatedWorktree !== false) {
      const provision = await this.worktreeManager.createWorktree(task.workspaceRoot, task.id);
      worktreePath = provision.worktreePath;
      branchName = provision.branch;
      isEphemeral = provision.isEphemeral;

      stateManager.setWorktreePath(worktreePath);
      await stateManager.recordEvent({
        taskId: task.id,
        type: "worktree_created",
        workflowState: "DISCOVER",
        payload: { worktreePath, branch: branchName, isEphemeral },
      });
    }

    // Dry run check
    if (options.dryRun) {
      if (isEphemeral) {
        await this.worktreeManager.cleanupWorktree(task.workspaceRoot, worktreePath, branchName);
      }
      this.activeRuns.delete(task.id);
      const metrics = await obs.generateReport(task.id);
      return {
        taskId: task.id,
        status: "succeeded",
        finalWorkflowState: "DISCOVER",
        diff: "",
        affectedFiles: [],
        summary: "Dry run completed: task planned successfully without launching agent.",
        validation: { passed: true, durationMs: 0, checks: [] },
        metrics,
      };
    }

    // 4. Bounded Execution & Verification Loop (Max 2 Retries ceiling)
    const maxRetries = Math.min(task.constraints.maxRetries, 2);
    let retryCount = 0;
    let errorFeedback = "";
    let lastValidation: ValidationReport = {
      passed: false,
      durationMs: 0,
      checks: [],
    };
    let lastOutputStderr = "";

    const retriever = new DefaultRepositoryRetriever({
      workspaceRoot: worktreePath,
      forbiddenPaths: task.constraints.forbiddenPaths,
    });
    const budgetManager = new TokenBudgetManager(
      task.constraints.maxTokens ? { totalTaskMaxTokens: task.constraints.maxTokens } : undefined,
    );

    const lockAcquired = WorkspaceLockManager.acquireLock(worktreePath, task.id);
    if (!lockAcquired) {
      const currentOwner = WorkspaceLockManager.getLockOwner(worktreePath) || "unknown";
      throw new WorkspaceConflictError(worktreePath, currentOwner, task.id);
    }
    const auditLogger = new SecurityAuditLogger(task.id);
    const permissions = getDefaultPermissionsForRole("single-agent");
    auditLogger.log({
      type: "permission_check",
      severity: "info",
      role: "single-agent",
      message: "Initialized single-agent permission boundary",
      details: { permissions: Array.from(permissions.permissions) },
    });

    try {
      while (retryCount <= maxRetries) {
        if (aborted) break;

        try {
          budgetManager.checkBudget("single-agent");
        } catch (err) {
          if (err instanceof TokenBudgetExceededError) {
            aborted = true;
            abortReason = err.message;
            break;
          }
          throw err;
        }

        stateManager.setRetryCount(retryCount);
        const sessionId = `${task.id}-run-${retryCount}`;

        await stateManager.recordEvent({
          taskId: task.id,
          type: "agent_launched",
          workflowState: "EXECUTE",
          payload: { sessionId, retryCount, role: "single-agent" },
        });

        // Assemble minimal progressive context with semantic retrieval
        const assembled = await this.contextManager.assembleContext(task, plan, errorFeedback, {
          retriever,
          includeInterfaces: true,
          includeTests: true,
          role: "single-agent",
        });
        const bootstrap = assembleBootstrapSystemPrompt({
          workspaceRoot: worktreePath,
          sessionId,
          activeModel: this.config?.defaultModelId,
        });

        // Run agent
        const agentOutput = await this.runner.run({
          sessionId,
          taskId: task.id,
          role: "single-agent",
          platform: this.runner.platform,
          workdir: worktreePath,
          systemPrompt: `${bootstrap.systemPrompt}\n\n${assembled.systemPrompt}`,
          messages: [
            {
              role: "user",
              content: assembled.taskPrompt,
              timestamp: new Date().toISOString(),
            },
          ],
          timeoutSec: task.constraints.timeoutSec,
          onOutputChunk: options.onMessageDelta,
        });

        obs.recordAgentDuration(agentOutput.durationMs);
        if (agentOutput.tokens) {
          const usage = {
            inputTokens: agentOutput.tokens.input,
            outputTokens: agentOutput.tokens.output,
            cacheReadTokens: agentOutput.tokens.cacheRead ?? 0,
            totalTokens: agentOutput.tokens.input + agentOutput.tokens.output,
          };
          obs.recordTokenUsage(usage);
          obs.recordRoleTokenUsage?.("single-agent", usage);
          try {
            budgetManager.recordUsage("single-agent", usage);
          } catch (err) {
            if (err instanceof TokenBudgetExceededError) {
              aborted = true;
              abortReason = err.message;
              break;
            }
            throw err;
          }
        }

        lastOutputStderr = agentOutput.stderr;

        await stateManager.recordEvent({
          taskId: task.id,
          type: "agent_completed",
          workflowState: "EXECUTE",
          payload: {
            exitCode: agentOutput.exitCode,
            durationMs: agentOutput.durationMs,
            interrupted: agentOutput.interrupted,
            stdout: agentOutput.stdout,
            stderr: agentOutput.stderr,
          },
        });

        if (agentOutput.interrupted || aborted) {
          aborted = true;
          abortReason = abortReason || "Agent execution was interrupted";
          break;
        }

        // Handle agent non-zero exit
        if (agentOutput.exitCode !== 0) {
          if (retryCount < maxRetries) {
            retryCount++;
            obs.recordRetry();
            obs.recordCompaction?.();
            errorFeedback = `Agent execution returned exit code ${agentOutput.exitCode}:\n${agentOutput.stderr || agentOutput.stdout}`;
            await stateManager.recordEvent({
              taskId: task.id,
              type: "retry_scheduled",
              workflowState: "EXECUTE",
              payload: { retryCount, reason: "Agent non-zero exit", errorFeedback },
            });
            continue;
          }
          // Retries exhausted on agent failure
          break;
        }

        // If informational question only, verify no edits and return success
        if (task.isQuestion) {
          const diffResult = await this.worktreeManager.extractDiff(worktreePath);
          if (diffResult.affectedFiles.length > 0) {
            if (retryCount < maxRetries) {
              retryCount++;
              obs.recordRetry();
              errorFeedback =
                "Question task attempted to modify files. Informational tasks must modify zero files.";
              await stateManager.recordEvent({
                taskId: task.id,
                type: "retry_scheduled",
                workflowState: "EXECUTE",
                payload: { retryCount, reason: "Question modified files", errorFeedback },
              });
              continue;
            }
            break;
          }

          await stateManager.recordEvent({
            taskId: task.id,
            type: "task_completed",
            workflowState: "COMPLETE",
            payload: { isQuestion: true },
          });

          if (isEphemeral) {
            await this.worktreeManager.cleanupWorktree(
              task.workspaceRoot,
              worktreePath,
              branchName,
            );
          }

          const metrics = await obs.generateReport(task.id);
          return {
            taskId: task.id,
            status: "succeeded",
            finalWorkflowState: "COMPLETE",
            diff: "",
            affectedFiles: [],
            summary:
              agentOutput.stdout || "Question answered successfully with zero file modifications.",
            validation: { passed: true, durationMs: 0, checks: [] },
            metrics,
          };
        }

        // 5. Mechanical Gate Validation
        await stateManager.recordEvent({
          taskId: task.id,
          type: "gate_started",
          workflowState: "VERIFY",
          payload: { worktreePath, passCommand: task.passCommand },
        });

        const validationReport = await taskValidator.validate(worktreePath, task.passCommand);
        lastValidation = validationReport;
        obs.recordGateRun(validationReport.durationMs, validationReport.passed);

        if (validationReport.passed) {
          // Check requireDiff invariant
          const diffResult = await this.worktreeManager.extractDiff(worktreePath);
          obs.recordDiffStats(diffResult.diff);
          for (const f of diffResult.affectedFiles) {
            obs.recordFileAccess(f, "write");
          }

          if (task.constraints.requireDiff && diffResult.diff.length === 0) {
            if (retryCount < maxRetries) {
              retryCount++;
              obs.recordRetry();
              errorFeedback =
                "Verification requires non-empty file modifications, but no changes were detected.";
              await stateManager.recordEvent({
                taskId: task.id,
                type: "gate_failed",
                workflowState: "VERIFY",
                payload: { reason: "requireDiff violated" },
              });
              await stateManager.recordEvent({
                taskId: task.id,
                type: "retry_scheduled",
                workflowState: "EXECUTE",
                payload: { retryCount, errorFeedback },
              });
              continue;
            }
            // Retries exhausted on empty diff
            break;
          }

          // Gate Passed!
          await stateManager.recordEvent({
            taskId: task.id,
            type: "gate_passed",
            workflowState: "VERIFY",
            payload: { checksRun: validationReport.checks.length },
          });

          await stateManager.recordEvent({
            taskId: task.id,
            type: "task_completed",
            workflowState: "COMPLETE",
            payload: {
              affectedFiles: diffResult.affectedFiles,
              diffPatch: diffResult.diff,
              durationMs: agentOutput.durationMs,
            },
          });

          if (isEphemeral) {
            await this.worktreeManager.cleanupWorktree(
              task.workspaceRoot,
              worktreePath,
              branchName,
              false,
            );
          }

          this.activeRuns.delete(task.id);
          const metrics = await obs.generateReport(task.id);

          return {
            taskId: task.id,
            status: "succeeded",
            finalWorkflowState: "COMPLETE",
            diff: diffResult.diff,
            affectedFiles: diffResult.affectedFiles,
            summary: "Task executed successfully and verified by mechanical gate.",
            validation: validationReport,
            metrics,
          };
        }

        // Gate Failed
        await stateManager.recordEvent({
          taskId: task.id,
          type: "gate_failed",
          workflowState: "VERIFY",
          payload: { failingStage: validationReport.failingStage },
        });

        if (retryCount < maxRetries) {
          retryCount++;
          obs.recordRetry();
          obs.recordCompaction?.();
          errorFeedback = taskValidator.extractDiagnostics(validationReport);
          await stateManager.recordEvent({
            taskId: task.id,
            type: "retry_scheduled",
            workflowState: "EXECUTE",
            payload: { retryCount, failingStage: validationReport.failingStage, errorFeedback },
          });
        } else {
          // Max retries reached
          break;
        }
      }

      // If loop exited without returning success:
      const status = aborted ? "cancelled" : "failed";
      const workflowState: WorkflowState = "BLOCKED";

      await stateManager.recordEvent({
        taskId: task.id,
        type: "task_failed",
        workflowState,
        payload: {
          aborted,
          abortReason,
          retriesAttempted: retryCount,
          failingStage: lastValidation.failingStage,
        },
      });

      if (isEphemeral) {
        await this.worktreeManager.cleanupWorktree(
          task.workspaceRoot,
          worktreePath,
          branchName,
          true,
        );
      }

      this.activeRuns.delete(task.id);
      const metrics = await obs.generateReport(task.id);

      const errorMessage = aborted
        ? `Task cancelled: ${abortReason}`
        : lastValidation.diagnosticsExcerpt ||
          lastOutputStderr ||
          `Task failed mechanical validation at stage: ${lastValidation.failingStage || "unknown"}`;

      return {
        taskId: task.id,
        status,
        finalWorkflowState: workflowState,
        diff: "",
        affectedFiles: [],
        summary: `Execution ended with status: ${status}`,
        validation: lastValidation,
        metrics,
        error: {
          code: aborted ? "TASK_CANCELLED" : "EXECUTION_FAILED",
          message: errorMessage,
          retryCount,
        },
      };
    } finally {
      if (isEphemeral && worktreePath !== task.workspaceRoot) {
        await this.worktreeManager
          .cleanupWorktree(task.workspaceRoot, worktreePath, branchName, true)
          .catch(() => {});
      }
      WorkspaceLockManager.releaseLock(worktreePath, task.id);
      obs.recordSecuritySummary?.(auditLogger.getSummary());
      this.activeRuns.delete(task.id);
    }
  }

  private validatorForTask(task: TaskDefinition, plan: TaskPlan): ValidationEngine {
    if (!this.adversarialAudit || (!plan.selection.independentReview && plan.tier !== "complex")) {
      return this.validator;
    }

    const candidatePaths = [
      ...(task.targetFiles ?? []),
      ...plan.steps.flatMap((step) => step.targetFiles),
    ];
    const domainIds = new Set(
      candidatePaths.flatMap((filePath) =>
        matchDomainsForFilePath(filePath, task.workspaceRoot).map((route) => route.domainId),
      ),
    );
    const routes = compileTier0DomainRoutes(task.workspaceRoot);
    const domainInvariants = [...domainIds].flatMap((domainId) => {
      const route = routes.find((candidate) => candidate.domainId === domainId);
      if (!route) return [];
      const domainPath = path.join(
        task.workspaceRoot,
        ".helix",
        "knowledge",
        "domains",
        domainId,
        "domain.md",
      );
      const skillPath = path.join(path.dirname(domainPath), "SKILL.md");
      const sourcePath = fs.existsSync(skillPath) ? skillPath : domainPath;
      try {
        return [parseFrontmatter(fs.readFileSync(sourcePath, "utf8")).content || route.description];
      } catch {
        return [route.description];
      }
    });

    return new CrossModelAdversarialValidationEngine({
      taskId: task.id,
      taskSpec: task.prompt,
      domainInvariants,
      generatorProvider: this.adversarialAudit.generatorProvider,
      invokeAuditor: this.adversarialAudit.invokeAuditor,
      deterministic: this.validator,
    });
  }
}
