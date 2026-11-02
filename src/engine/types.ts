// Helix Core Engine — Architecture Interfaces and Data Models (Phase 02)
// Defines the complete contract for task execution, agent abstraction,
// tool isolation, context optimization, mechanical validation, and state management.
import type { CrewId, PlatformId, RepoFacts } from "../types.ts";
import type { TaskTier, WorkflowState, WorkflowSelection } from "../workflow.ts";

// ============================================================================
// 1. Task Interface & Specification
// ============================================================================

export type TaskStatus =
  "pending" | "running" | "verifying" | "succeeded" | "failed" | "blocked" | "cancelled";

export type TaskConstraints = {
  /** Maximum wall-clock execution time in seconds (default: 600). */
  timeoutSec: number;
  /** Maximum number of gate-failure retries before stopping (default: 2, hard max: 2). */
  maxRetries: number;
  /** Maximum agent turn interactions allowed for the task. */
  maxTurns?: number;
  /** Maximum token budget limit for the task. */
  maxTokens?: number;
  /** Optional role-specific token budget limits. */
  roleBudgets?: Partial<RoleTokenBudgets>;
  /** Paths that must never be read, modified, or staged (e.g., secrets/, .env*). */
  forbiddenPaths: string[];
  /** Whether the task requires git diff to be non-empty on success (default: true). */
  requireDiff: boolean;
};

export type TaskDefinition = {
  /** Unique task identifier (e.g., "task-bugfix-limiter"). */
  id: string;
  /** Short human-readable title. */
  title: string;
  /** Full natural language task prompt / specification. */
  prompt: string;
  /** Target workspace root directory. */
  workspaceRoot: string;
  /** Optional file paths known or suspected to be involved. */
  targetFiles?: string[];
  /** Mechanical verification command to run in addition to standard gate. */
  passCommand?: string;
  /** Execution and security constraints. */
  constraints: TaskConstraints;
  /** Explicit tier override if provided by user or caller. */
  tierOverride?: TaskTier;
  /** Security sensitivity flag (auth, secrets, crypto, permissions). */
  securitySensitive?: boolean;
  /** Informational task flag (questions that change no code). */
  isQuestion?: boolean;
  /** Creation timestamp (ISO string). */
  createdAt: string;
};

export type TaskResult = {
  taskId: string;
  status: TaskStatus;
  /** Final workflow state when execution ended. */
  finalWorkflowState: WorkflowState;
  /** Unified diff of changes produced, if any. */
  diff: string;
  /** List of modified, created, or deleted files. */
  affectedFiles: string[];
  /** Summary of execution outcome. */
  summary: string;
  /** Full validation report from the zero-token gate. */
  validation: ValidationReport;
  /** Detailed performance and token accounting metrics. */
  metrics: RunMetrics;
  /** Error details if task failed or was blocked. */
  error?: {
    code: string;
    message: string;
    stepId?: string;
    retryCount: number;
  };
};

// ============================================================================
// 2. Task Planner & Plan Representation
// ============================================================================

export type StepExecutionStatus =
  "pending" | "running" | "completed" | "failed" | "skipped" | "cancelled";

export type PlanStep = {
  id: string;
  title: string;
  role: AgentRole;
  description: string;
  targetFiles: string[];
  dependencies: string[];
  status: StepExecutionStatus;
  assignedAgent?: string;
  output?: {
    stdout?: string;
    diff?: string;
    affectedFiles?: string[];
    error?: string;
  };
};

export type TaskPlan = {
  taskId: string;
  tier: TaskTier;
  selection: WorkflowSelection;
  steps: PlanStep[];
  reason: string;
  independentReviewRequired: boolean;
  createdAt: string;
};

export interface TaskPlanner {
  /** Assess task surface and risk, returning workflow tier and plan. */
  plan(task: TaskDefinition): Promise<TaskPlan>;
}

// ============================================================================
// 3. Execution Engine
// ============================================================================

export type OrchestrationStrategy =
  | "chain"
  | "parallel"
  | "review"
  | "plan-only"
  | "single-agent"
  | "single-agent-with-planning"
  | "multiple-implementers"
  | "implementer-plus-reviewer"
  | "parallel-implementation";

export type EngineExecutionOptions = {
  /** Execute in an isolated ephemeral Git worktree (default: true). */
  isolatedWorktree?: boolean;
  /** Force single-agent execution even for standard/complex tasks (default: true). */
  singleAgentOnly?: boolean;
  /** Multi-agent strategy if orchestration is enabled (default: 'chain'). */
  orchestrationStrategy?: OrchestrationStrategy;
  /** Dry-run mode: plan and assemble context without launching agent. */
  dryRun?: boolean;
  /** Event listener for real-time observability. */
  onEvent?: (event: ExecutionEvent) => void;
};

export interface HelixEngine {
  /** Execute a task to completion using single-agent baseline or optional orchestrator. */
  execute(task: TaskDefinition, options?: EngineExecutionOptions): Promise<TaskResult>;
  /** Abort an active task run cleanly, restoring workspace state. */
  abort(taskId: string, reason: string): Promise<void>;
  /** Get current snapshot of task execution state. */
  getState(taskId: string): Promise<ExecutionStateSnapshot | null>;
}

// ============================================================================
// 4. Agent Abstraction
// ============================================================================

export type AgentRole = CrewId | "single-agent" | "planner" | "implementer" | "tester";

export type AgentCapabilities = {
  /** Supports executing arbitrary bash/terminal commands. */
  supportsBash: boolean;
  /** Supports invoking subagents directly. */
  supportsSubagents: boolean;
  /** Supports deterministic lifecycle hooks (e.g., Claude Code PreToolUse/Stop). */
  supportsHooks: boolean;
  /** Supports native Model Context Protocol (MCP) servers. */
  supportsMcp: boolean;
};

export type AgentMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  timestamp: string;
  toolCallId?: string;
};

export type AgentSession = {
  sessionId: string;
  taskId: string;
  role: AgentRole;
  platform: PlatformId;
  workdir: string;
  systemPrompt: string;
  messages: AgentMessage[];
  timeoutSec: number;
};

export type AgentExecutionOutput = {
  exitCode: number;
  stdout: string;
  stderr: string;
  messages: AgentMessage[];
  durationMs: number;
  tokens?: {
    input: number;
    output: number;
    cacheRead?: number;
  };
  interrupted?: boolean;
};

export interface AgentRunner {
  readonly platform: PlatformId;
  readonly capabilities: AgentCapabilities;

  /** Run the agent within the provisioned session directory. */
  run(session: AgentSession): Promise<AgentExecutionOutput>;
  /** Gracefully terminate an active agent process. */
  terminate(sessionId: string): Promise<void>;
}

// ============================================================================
// 5. Model & Provider Abstraction (Token Math & Capabilities)
// ============================================================================

export type ProviderId = "anthropic" | "openai" | "google" | "local" | "generic";

export type ModelMetadata = {
  modelId: string;
  provider: ProviderId;
  contextWindow: number;
  maxOutputTokens: number;
  costPerMillionInputTokens: number;
  costPerMillionOutputTokens: number;
  costPerMillionCacheReadTokens?: number;
};

export type TokenUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  totalTokens: number;
};

export type CostEstimate = {
  currency: "USD";
  estimatedTotalUsd: number;
  breakdown: {
    inputUsd: number;
    outputUsd: number;
    cacheUsd: number;
  };
};

export interface ModelProvider {
  readonly providerId: ProviderId;
  /** Accurately count tokens for a given text snippet. */
  countTokens(text: string): number;
  /** Calculate cost from token usage based on pricing table. */
  calculateCost(modelId: string, usage: TokenUsage): CostEstimate;
}

// ============================================================================
// 6. Tool Execution Interface & Confinement
// ============================================================================

export type ToolExecutionResult = {
  exitCode: number;
  output: string;
  truncated: boolean;
  durationMs: number;
  error?: string;
};

export type ToolExecutionContext = {
  workspaceRoot: string;
  environmentVariables: Record<string, string>;
  forbiddenPaths: string[];
  maxOutputBytes: number;
  timeoutMs: number;
};

export interface ToolExecutor {
  /** Execute a shell command within strict containment and bounds. */
  executeCommand(command: string, context: ToolExecutionContext): Promise<ToolExecutionResult>;
  /** Read a file safely with path containment and line range bounds. */
  readFile(
    filePath: string,
    startLine?: number,
    endLine?: number,
    context?: ToolExecutionContext,
  ): Promise<string>;
  /** Apply a file edit with atomic write guarantees. */
  writeFile(
    filePath: string,
    content: string,
    context?: ToolExecutionContext,
  ): Promise<ToolExecutionResult>;
}

// ============================================================================
// 7. Context Manager & Progressive Disclosure
// ============================================================================

export type RoleTokenBudgets = {
  planningMaxTokens: number;
  implementationMaxTokens: number;
  reviewMaxTokens: number;
  testingMaxTokens: number;
  retryMaxTokens: number;
  totalTaskMaxTokens: number;
};

export type ContextBudget = {
  /** Target token budget for system instruction (target: <= 300). */
  systemInstructionsMaxTokens: number;
  /** Token budget for task prompt and constraints. */
  taskPromptMaxTokens: number;
  /** Token budget for cited repository context. */
  repoContextMaxTokens: number;
  /** Token budget for gate error feedback. */
  errorFeedbackMaxTokens: number;
  /** Absolute total budget for initial agent prompt. */
  totalPromptMaxTokens: number;
  /** Optional role-specific execution token budgets. */
  roleBudgets?: Partial<RoleTokenBudgets>;
};

export type CompactionSummary = {
  objective: string;
  decisions: string[];
  modifiedFiles: string[];
  relevantDiscoveries: string[];
  remainingWork: string[];
  failedApproaches: string[];
  validationStatus: string;
  serializedText: string;
  tokenCount: number;
};

export type CompactionOptions = {
  maxSummaryTokens?: number;
  keepRecentMessages?: number;
};

export type ContextAssemblyOptions = {
  retriever?: RepositoryRetriever;
  handoffCard?: HandoffCard;
  recentDiff?: string;
  citations?: Array<{ path: string; start: number; end: number; reason?: string }>;
  includeInterfaces?: boolean;
  includeTests?: boolean;
  role?: AgentRole;
};

export type AssembledContext = {
  systemPrompt: string;
  taskPrompt: string;
  tokenCount: number;
  budgetRemaining: number;
  includedReferences: string[];
  layerBreakdown?: {
    systemTokens: number;
    contractTokens: number;
    repoStructureTokens: number;
    citedExcerptsTokens: number;
    diagnosticTokens: number;
  };
  citedExcerpts?: CitedExcerpt[];
  handoffCard?: HandoffCard;
};

export class TokenBudgetExceededError extends Error {
  public readonly role?: string;
  public readonly allocated: number;
  public readonly consumed: number;

  constructor(message: string, role?: string, allocated = 0, consumed = 0) {
    super(
      `Token budget exceeded: ${message} (role=${role ?? "task"}, allocated=${allocated}, consumed=${consumed})`,
    );
    this.name = "TokenBudgetExceededError";
    this.role = role;
    this.allocated = allocated;
    this.consumed = consumed;
  }
}

export interface ContextManager {
  /** Assemble minimal, high-signal context for an agent session. */
  assembleContext(
    task: TaskDefinition,
    plan: TaskPlan,
    errorFeedback?: string,
    options?: ContextAssemblyOptions,
  ): Promise<AssembledContext>;
  /** Compact or prune conversation messages if context limits are approached. */
  pruneHistory(messages: AgentMessage[], maxTokens: number): AgentMessage[];
  /** Compact multi-turn conversation messages into a structured technical summary. */
  compactHistory?(
    messages: AgentMessage[],
    options?: CompactionOptions,
  ): Promise<{ compactedMessages: AgentMessage[]; summary: CompactionSummary }>;
}

// ============================================================================
// 8. Repository Retrieval Mechanism
// ============================================================================

export type CitedExcerpt = {
  filePath: string;
  startLine: number;
  endLine: number;
  content: string;
  relevanceReason: string;
};

export type SymbolReference = {
  name: string;
  kind: "function" | "class" | "interface" | "type" | "variable";
  filePath: string;
  line: number;
};

export interface RepositoryRetriever {
  /** Query semantic graph (Graphify) or fallback structural outline. */
  queryStructure(query: string): Promise<SymbolReference[]>;
  /** Retrieve narrow cited line excerpts (strictly avoiding whole-file dumps >200 lines). */
  fetchExcerpts(
    citations: Array<{ path: string; start: number; end: number; reason?: string }>,
  ): Promise<CitedExcerpt[]>;
  /** Find files matching search pattern. */
  findFiles?(pattern: string): Promise<string[]>;
  /** Find relevant test files for given source files. */
  findRelatedTests?(sourceFiles: string[]): Promise<string[]>;
  /** Extract exported interfaces and types for given source files. */
  extractInterfaces?(sourceFiles: string[], maxTokens?: number): Promise<string>;
}

// ============================================================================
// 9. Agent Orchestrator & Multi-Agent Handoffs
// ============================================================================

export type HandoffCard = {
  goal: string;
  constraints: string;
  file: string;
  done: string;
  outOfScope: string;
  serializedText: string;
  lineCount: number;
};

export type ReviewVerdict = "PASS" | "FAIL";

export type ReviewEvidence = {
  file: string;
  line?: number;
  issue: string;
};

export type ReviewResult = {
  verdict: ReviewVerdict;
  summary: string;
  evidence: ReviewEvidence[];
  rawOutput: string;
};

export type ConflictItem = {
  file: string;
  conflictType: "overlapping_files" | "patch_failure" | "git_conflict";
  details: string;
};

export type ConflictResolutionResult = {
  hasConflicts: boolean;
  conflicts: ConflictItem[];
  resolved: boolean;
  strategy: "abort" | "retry_sequential" | "force_overwrite";
  error?: string;
};

export interface AgentOrchestrator {
  /** Serialize a validated 12-line handoff card for role transitions. */
  createHandoff(fields: {
    goal: string;
    constraints?: string;
    file?: string;
    files?: string[];
    done?: string;
    doneMeans?: string;
    outOfScope?: string;
  }): HandoffCard;
  /** Decompose a task into structured plan steps based on task facts and strategy. */
  decomposeTask(task: TaskDefinition, strategy?: OrchestrationStrategy): Promise<TaskPlan>;
  /** Execute multi-role chain (e.g. Scout/Planner -> Architect -> Builder/Implementer -> Reviewer). */
  orchestrateChain(
    task: TaskDefinition,
    plan: TaskPlan,
    options?: EngineExecutionOptions,
  ): Promise<TaskResult>;
  /** Execute independent subtasks in parallel across isolated worktrees. */
  orchestrateParallel(
    task: TaskDefinition,
    plan: TaskPlan,
    options?: EngineExecutionOptions,
  ): Promise<TaskResult>;
  /** Execute independent code review on the generated diff. */
  reviewChanges(
    task: TaskDefinition,
    diff: string,
    options?: EngineExecutionOptions,
  ): Promise<ReviewResult>;
  /** Abort active orchestration runs. */
  abort(taskId: string, reason: string): Promise<void>;
}

// ============================================================================
// 10. Execution State Manager
// ============================================================================

export type ExecutionEventType =
  | "task_started"
  | "tier_classified"
  | "worktree_created"
  | "agent_launched"
  | "agent_completed"
  | "tool_invoked"
  | "gate_started"
  | "gate_passed"
  | "gate_failed"
  | "retry_scheduled"
  | "task_completed"
  | "task_failed"
  | "worktree_cleaned"
  | "handoff_created"
  | "step_started"
  | "step_completed"
  | "step_failed"
  | "review_started"
  | "review_completed"
  | "conflict_detected"
  | "integration_started"
  | "integration_completed";

export type ExecutionEvent = {
  eventId: string;
  taskId: string;
  timestamp: string;
  type: ExecutionEventType;
  workflowState: WorkflowState;
  payload: Record<string, unknown>;
};

export type ExecutionStateSnapshot = {
  taskId: string;
  workflowState: WorkflowState;
  tier: TaskTier;
  worktreePath?: string;
  currentStepId?: string;
  retryCount: number;
  events: ExecutionEvent[];
  updatedAt: string;
};

export interface ExecutionStateManager {
  /** Record an execution event and advance state. */
  recordEvent(event: Omit<ExecutionEvent, "eventId" | "timestamp">): Promise<ExecutionEvent>;
  /** Save current state snapshot to persistent storage (.helix-work/state.json). */
  persist(taskId: string): Promise<void>;
  /** Load state snapshot to support resumption after interruption. */
  load(taskId: string): Promise<ExecutionStateSnapshot | null>;
  /** Clean up state on terminal completion or user purge. */
  cleanup(taskId: string): Promise<void>;
}

// ============================================================================
// 11. Validation Engine
// ============================================================================

export type ValidationStage = "secrets" | "lint" | "typecheck" | "tests";

export type ValidationCheckResult = {
  stage: ValidationStage;
  passed: boolean;
  command: string;
  exitCode: number;
  durationMs: number;
  stdout: string;
  stderr: string;
  failuresOnly?: string;
};

export type ValidationReport = {
  passed: boolean;
  durationMs: number;
  checks: ValidationCheckResult[];
  failingStage?: ValidationStage;
  diagnosticsExcerpt?: string;
};

export interface ValidationEngine {
  /** Execute mechanical verification gate (.helix/gate.mjs) in target worktree. */
  validate(worktreePath: string, passCommand?: string): Promise<ValidationReport>;
  /** Extract minimal failing assertions/lines from error output for bounded agent retry. */
  extractDiagnostics(report: ValidationReport, maxTokens?: number): string;
}

// ============================================================================
// 12. Observability, Metrics & Reporting
// ============================================================================

export type RunMetrics = {
  wallClockDurationMs: number;
  agentDurationMs: number;
  gateDurationMs: number;
  retriesAttempted: number;
  gateRuns: number;
  tokens: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    totalTokens: number;
    estimatedCostUsd: number;
  };
  fileStats: {
    filesInspected: number;
    filesModified: number;
    linesAdded: number;
    linesDeleted: number;
    repeatedFileReads: number;
  };
  optimization?: {
    contextReuseTokens: number;
    repeatedFileRetrievals: number;
    compactionCount: number;
    tokensByRole: Record<string, TokenUsage>;
    tokensPerSuccessfulTask: number;
  };
};

export interface ObservabilityCollector {
  /** Record metric observations during execution. */
  recordTokenUsage(usage: TokenUsage): void;
  recordGateRun(durationMs: number, passed: boolean): void;
  recordFileAccess(path: string, mode: "read" | "write"): void;
  recordRoleTokenUsage?(role: string, usage: TokenUsage): void;
  recordContextReuse?(tokensSaved: number): void;
  recordCompaction?(): void;
  /** Finalize and generate complete run report. */
  generateReport(taskId: string): Promise<RunMetrics>;
}

// ============================================================================
// 13. Configuration Management
// ============================================================================

export type EngineConfig = {
  /** Default execution platform (e.g., "claude-code", "codex", "opencode"). */
  defaultPlatform: PlatformId;
  /** Whether to enforce single-agent execution by default. */
  defaultSingleAgent: boolean;
  /** Git worktree parent directory (default: ".helix-work/worktrees"). */
  worktreeStorageDir: string;
  /** Report output directory (default: ".helix-work/reports"). */
  reportOutputDir: string;
  /** Default task timeout in seconds. */
  defaultTimeoutSec: number;
  /** Maximum retry limit for gate failures (ceiling: 2). */
  maxRetries: number;
  /** Detected repository facts (languages, commands). */
  stack?: RepoFacts;
};
