// Helix Context Manager, Progressive Disclosure & Token Optimization (Phase 05 - Component 7)
import fs from "node:fs";
import path from "node:path";
import { countTokens } from "../measure.ts";
import { compileTier0DomainCatalog, compileTier0DomainRoutes } from "../knowledge/discovery.ts";
import { UntrustedContentHandler } from "./security.ts";
import type {
  AgentMessage,
  AgentRole,
  AssembledContext,
  CitedExcerpt,
  CompactionOptions,
  CompactionSummary,
  ContextAssemblyOptions,
  ContextBudget,
  ContextManager,
  RoleTokenBudgets,
  TaskDefinition,
  TaskPlan,
  TokenUsage,
} from "./types.ts";
import { TokenBudgetExceededError } from "./types.ts";

export interface ProgressiveContextState {
  readonly sessionId: string;
  readonly activeModel: string;
  readonly maxContextTokens: number;
  readonly autoCompactThresholdRatio: number;
  readonly loadedDomainIds: Set<string>;
  readonly visibleToolNames: Set<string>;
  readonly approvedWriteScopes: Set<string>;
  readonly injectedEpisodicIds: Set<string>;
  currentTokenCount: number;
  turnCount: number;
  readonly maxTurns: number;
}

export const BOOTSTRAP_TOOL_NAMES = [
  "load_skill",
  "tool_search",
  "spawn_scout",
  "consult_peer",
  "Read",
  "Grep",
  "Glob",
] as const;

const BOOTSTRAP_CORE_RULES = [
  "You are Helix, a careful coding agent. Follow the user's task and repository rules.",
  "Load a matching domain skill before editing; discover tools with tool_search before use.",
  "Read only relevant file ranges. Preserve unrelated changes and verify edits with requested gates.",
].join("\n");

export function createProgressiveContextState(options: {
  sessionId: string;
  activeModel?: string;
  maxContextTokens: number;
  maxTurns?: number;
}): ProgressiveContextState {
  return {
    sessionId: options.sessionId,
    activeModel: options.activeModel ?? "claude-opus-5-5",
    maxContextTokens: options.maxContextTokens,
    autoCompactThresholdRatio: 0.92,
    loadedDomainIds: new Set(),
    visibleToolNames: new Set(BOOTSTRAP_TOOL_NAMES),
    approvedWriteScopes: new Set(),
    injectedEpisodicIds: new Set(),
    currentTokenCount: 0,
    turnCount: 0,
    maxTurns: options.maxTurns ?? 30,
  };
}

export function assembleBootstrapSystemPrompt(
  options: {
    workspaceRoot?: string;
    state?: ProgressiveContextState;
    sessionId?: string;
    activeModel?: string;
    maxContextTokens?: number;
    maxTurns?: number;
  } = {},
): { systemPrompt: string; state: ProgressiveContextState } {
  const workspaceRoot = path.resolve(options.workspaceRoot ?? process.cwd());
  const state =
    options.state ??
    createProgressiveContextState({
      sessionId: options.sessionId ?? `session-${Date.now()}`,
      activeModel: options.activeModel,
      maxContextTokens: options.maxContextTokens ?? 200_000,
      maxTurns: options.maxTurns,
    });
  const coreTokens = countTokens(BOOTSTRAP_CORE_RULES);
  if (coreTokens >= 350) throw new Error(`Bootstrap core is ${coreTokens} tokens; maximum is 349`);
  const catalog = compileTier0DomainCatalog(compileTier0DomainRoutes(workspaceRoot));
  const catalogTokens = countTokens(catalog);
  if (catalogTokens >= 250) {
    throw new Error(`Tier 0 bootstrap catalog is ${catalogTokens} tokens; maximum is 249`);
  }
  const systemPrompt = [BOOTSTRAP_CORE_RULES, "", "## Domain routes", catalog].join("\n");
  if (countTokens(systemPrompt) >= 600)
    throw new Error("Bootstrap system prompt must stay below 600 tokens");
  state.currentTokenCount = countTokens(systemPrompt);
  return { systemPrompt, state };
}

/** Archive old tool output exactly and replace the in-memory content with a compact pointer. */
export function compactContextIfNeeded(
  messages: AgentMessage[],
  state: ProgressiveContextState,
  workspaceRoot: string = process.cwd(),
): AgentMessage[] {
  const measured = countTokens(messages.map((message) => message.content).join("\n"));
  state.currentTokenCount = measured;
  if (
    state.maxContextTokens <= 0 ||
    measured / state.maxContextTokens < state.autoCompactThresholdRatio
  ) {
    return messages;
  }
  const toolIndexes = messages.flatMap((message, index) =>
    message.role === "tool" && !message.content.startsWith("[Compacted ->") ? [index] : [],
  );
  if (toolIndexes.length <= 2) return messages;
  const oldIndexes = new Set(toolIndexes.slice(0, -2));
  const oldTools = messages.filter((_message, index) => oldIndexes.has(index));
  const facts = oldTools
    .map((message, index) => `### Tool output ${index + 1}\n\n${message.content}`)
    .join("\n\n");
  const session = state.sessionId.replace(/[^a-zA-Z0-9._-]/g, "_");
  const notesPath = path.join(
    path.resolve(workspaceRoot),
    ".helix",
    "runtime",
    session,
    "NOTES.md",
  );
  fs.mkdirSync(path.dirname(notesPath), { recursive: true });
  const section = `\n## Compacted tool output (${new Date().toISOString()})\n${facts || "No tool output was available."}\n`;
  fs.appendFileSync(notesPath, section, "utf8");
  const notesRelativePath = `.helix/runtime/${session}/NOTES.md`;
  const compacted = messages.map((message, index) =>
    oldIndexes.has(index)
      ? {
          ...message,
          content: `[Compacted -> ${notesRelativePath}] Digest: ${toolOutputDigest(message.content)}`,
        }
      : message,
  );
  state.currentTokenCount = countTokens(compacted.map((message) => message.content).join("\n"));
  return compacted;
}

/** Keep compact evidence inline while the complete original output remains archived. */
function toolOutputDigest(output: string): string {
  const lines = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const filePathFacts =
    output.match(
      /(?:[A-Za-z]:)?(?:\.{0,2}[/\\])?[\w.@+-]+(?:[/\\][\w.@+-]+)*\.[A-Za-z0-9]+:\d+(?::\d+)?/g,
    ) ?? [];
  const symbolFacts = lines.filter((line) =>
    /\b(?:export\s+)?(?:declare\s+)?(?:async\s+)?(?:function|class|interface|type|enum|const|let|var)\s+[A-Za-z_$][\w$]*/.test(
      line,
    ),
  );
  const failureFacts = lines.filter((line) => /\b(?:Error|FAIL)\b/i.test(line));
  const facts = [...new Set([...filePathFacts, ...failureFacts, ...symbolFacts])];
  const selected: string[] = [];
  for (const fact of facts) {
    const candidate = [...selected, fact].join(" | ");
    if (countTokens(candidate) <= 120) selected.push(fact);
  }
  return selected.length ? selected.join(" | ") : "No path, symbol, or failure facts extracted.";
}

export interface MasterLoopTurn<T> {
  readonly stop_reason: "tool_use" | "end_turn";
  readonly value: T;
  readonly messages: AgentMessage[];
  readonly workspaceRoot?: string;
}

export async function runMasterLoop<T>(
  state: ProgressiveContextState,
  initialMessages: AgentMessage[],
  runTurn: (messages: AgentMessage[]) => Promise<MasterLoopTurn<T>>,
): Promise<{ value: T; messages: AgentMessage[] }> {
  let messages = initialMessages;
  while (state.turnCount < state.maxTurns) {
    const turn = await runTurn(messages);
    state.turnCount++;
    messages = compactContextIfNeeded(turn.messages, state, turn.workspaceRoot);
    if (turn.stop_reason === "end_turn") return { value: turn.value, messages };
  }
  throw new Error(`Master loop exceeded its ${state.maxTurns}-turn limit`);
}

export const DEFAULT_ROLE_TOKEN_BUDGETS: RoleTokenBudgets = {
  planningMaxTokens: 15_000,
  implementationMaxTokens: 40_000,
  reviewMaxTokens: 10_000,
  testingMaxTokens: 15_000,
  retryMaxTokens: 20_000,
  totalTaskMaxTokens: 80_000,
};

export const DEFAULT_CONTEXT_BUDGET: ContextBudget = {
  systemInstructionsMaxTokens: 300,
  taskPromptMaxTokens: 600,
  repoContextMaxTokens: 1000,
  errorFeedbackMaxTokens: 400,
  totalPromptMaxTokens: 2950,
  roleBudgets: DEFAULT_ROLE_TOKEN_BUDGETS,
};

/**
 * Manages role-specific and total task token budgets to prevent runaway consumption.
 */
export class TokenBudgetManager {
  private readonly limits: RoleTokenBudgets;
  private readonly usageByRole = new Map<string, TokenUsage>();
  private totalUsage: TokenUsage = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    totalTokens: 0,
  };

  constructor(customBudgets?: Partial<RoleTokenBudgets>) {
    this.limits = {
      ...DEFAULT_ROLE_TOKEN_BUDGETS,
      ...customBudgets,
    };
  }

  getLimit(role: string): number {
    switch (role.toLowerCase()) {
      case "planner":
      case "architect":
      case "planning":
        return this.limits.planningMaxTokens;
      case "implementer":
      case "builder":
      case "single-agent":
        return this.limits.implementationMaxTokens;
      case "reviewer":
      case "review":
        return this.limits.reviewMaxTokens;
      case "scout":
      case "tester":
      case "testing":
        return this.limits.testingMaxTokens;
      case "retry":
        return this.limits.retryMaxTokens;
      default:
        return this.limits.implementationMaxTokens;
    }
  }

  getTotalLimit(): number {
    return this.limits.totalTaskMaxTokens;
  }

  getRoleUsage(role: string): TokenUsage {
    return (
      this.usageByRole.get(role) || {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        totalTokens: 0,
      }
    );
  }

  getTotalUsage(): TokenUsage {
    return { ...this.totalUsage };
  }

  /**
   * Check if a proposed or additional token consumption exceeds role or total budget.
   */
  checkBudget(role: string, additionalTokens = 0): void {
    const roleLimit = this.getLimit(role);
    const currentRoleUsage = this.getRoleUsage(role).totalTokens;

    if (currentRoleUsage + additionalTokens > roleLimit) {
      throw new TokenBudgetExceededError(
        `Role '${role}' exceeded its allocated token ceiling`,
        role,
        roleLimit,
        currentRoleUsage + additionalTokens,
      );
    }

    if (this.totalUsage.totalTokens + additionalTokens > this.limits.totalTaskMaxTokens) {
      throw new TokenBudgetExceededError(
        "Total task execution exceeded its global token ceiling",
        "total_task",
        this.limits.totalTaskMaxTokens,
        this.totalUsage.totalTokens + additionalTokens,
      );
    }
  }

  /**
   * Record actual token consumption for a role and update global totals.
   */
  recordUsage(role: string, usage: TokenUsage): void {
    const existing = this.getRoleUsage(role);
    const updatedRole: TokenUsage = {
      inputTokens: existing.inputTokens + (usage.inputTokens || 0),
      outputTokens: existing.outputTokens + (usage.outputTokens || 0),
      cacheReadTokens: existing.cacheReadTokens + (usage.cacheReadTokens || 0),
      totalTokens:
        existing.totalTokens +
        (usage.totalTokens || (usage.inputTokens || 0) + (usage.outputTokens || 0)),
    };
    this.usageByRole.set(role, updatedRole);

    this.totalUsage = {
      inputTokens: this.totalUsage.inputTokens + (usage.inputTokens || 0),
      outputTokens: this.totalUsage.outputTokens + (usage.outputTokens || 0),
      cacheReadTokens: this.totalUsage.cacheReadTokens + (usage.cacheReadTokens || 0),
      totalTokens:
        this.totalUsage.totalTokens +
        (usage.totalTokens || (usage.inputTokens || 0) + (usage.outputTokens || 0)),
    };

    // Verify after recording
    const roleLimit = this.getLimit(role);
    if (updatedRole.totalTokens > roleLimit) {
      throw new TokenBudgetExceededError(
        `Role '${role}' exceeded its allocated token ceiling`,
        role,
        roleLimit,
        updatedRole.totalTokens,
      );
    }

    if (this.totalUsage.totalTokens > this.limits.totalTaskMaxTokens) {
      throw new TokenBudgetExceededError(
        "Total task execution exceeded its global token ceiling",
        "total_task",
        this.limits.totalTaskMaxTokens,
        this.totalUsage.totalTokens,
      );
    }
  }
}

/**
 * Compactor for long-running and multi-turn conversations.
 * Preserves essential technical facts while collapsing redundant intermediate turns.
 */
export class ContextCompactor {
  static compact(
    messages: AgentMessage[],
    options: CompactionOptions = {},
  ): { compactedMessages: AgentMessage[]; summary: CompactionSummary } {
    const keepRecent = options.keepRecentMessages ?? 2;
    const maxSummaryTokens = options.maxSummaryTokens ?? 800;

    if (messages.length <= keepRecent + 1) {
      // Nothing to compact if message count is small
      const summary: CompactionSummary = {
        objective: "Initial task",
        decisions: [],
        modifiedFiles: [],
        relevantDiscoveries: [],
        remainingWork: [],
        failedApproaches: [],
        validationStatus: "IN_PROGRESS",
        serializedText: "No compaction required.",
        tokenCount: 0,
      };
      return { compactedMessages: messages, summary };
    }

    const systemMessage = messages.find((m) => m.role === "system");
    const nonSystem = messages.filter((m) => m.role !== "system");
    const toCompact = nonSystem.slice(0, nonSystem.length - keepRecent);
    const recentMessages = nonSystem.slice(nonSystem.length - keepRecent);

    // Extract technical facts from toCompact turns
    let objective = "";
    const decisions: string[] = [];
    const modifiedFiles = new Set<string>();
    const relevantDiscoveries: string[] = [];
    const remainingWork: string[] = [];
    const failedApproaches: string[] = [];
    let validationStatus = "PENDING";

    for (const msg of toCompact) {
      const content = msg.content;

      // Extract objective from first user prompt
      if (!objective && msg.role === "user") {
        const objMatch = content.match(/(?:Task ID|Prompt|Objective)[:\s]+([^\n]+)/i);
        objective = objMatch ? objMatch[1].trim() : content.split("\n")[0].slice(0, 120);
      }

      // Extract modified files
      const fileMatches = content.matchAll(
        /(?:wrote|modified|created|edited|target file)[\s:`"']+([a-zA-Z0-9_\-./]+\.[a-zA-Z0-9]+)/gi,
      );
      for (const m of fileMatches) {
        if (!m[1].includes("node_modules")) {
          modifiedFiles.add(m[1]);
        }
      }

      // Extract decisions
      const decisionMatches = content.matchAll(
        /(?:decided to|chose to|decision:|approach:)[\s]+([^\n.]+)/gi,
      );
      for (const m of decisionMatches) {
        decisions.push(m[1].trim());
      }

      // Extract failed approaches and errors
      if (
        content.includes("failed") ||
        content.includes("error") ||
        content.includes("Error:") ||
        content.includes("FAIL")
      ) {
        const errLines = content
          .split("\n")
          .filter((l) => /error|fail|assert|exception/i.test(l))
          .slice(0, 3);
        for (const el of errLines) {
          const trimmed = el.trim().replace(/^[-*#\s]+/, "");
          if (trimmed && !failedApproaches.includes(trimmed)) {
            failedApproaches.push(trimmed);
          }
        }
        validationStatus = "PRIOR_FAILURE_DETECTED";
      }

      // Extract discoveries
      if (
        content.includes("found") ||
        content.includes("discovered") ||
        content.includes("located")
      ) {
        const discMatches = content.matchAll(/(?:found|discovered|located)[\s]+([^\n.]+)/gi);
        for (const m of discMatches) {
          relevantDiscoveries.push(m[1].trim());
        }
      }
    }

    if (failedApproaches.length > 0) {
      remainingWork.push("Address prior verification failure and satisfy all acceptance checks");
    } else {
      remainingWork.push("Complete implementation and pass mechanical verification gate");
    }

    const lines = [
      "=== HELIX CONTEXT COMPACTION SUMMARY ===",
      `Objective: ${objective || "Complete requested task"}`,
      `Status: ${validationStatus}`,
      `Modified Files: ${Array.from(modifiedFiles).join(", ") || "None recorded"}`,
    ];

    if (decisions.length > 0) {
      lines.push("Decisions:");
      for (const d of decisions.slice(0, 4)) {
        lines.push(`- ${d}`);
      }
    }

    if (relevantDiscoveries.length > 0) {
      lines.push("Discoveries:");
      for (const d of relevantDiscoveries.slice(0, 4)) {
        lines.push(`- ${d}`);
      }
    }

    if (failedApproaches.length > 0) {
      lines.push("Failed Approaches (DO NOT REPEAT):");
      for (const f of failedApproaches.slice(0, 5)) {
        lines.push(`- ${f}`);
      }
    }

    if (remainingWork.length > 0) {
      lines.push("Remaining Work:");
      for (const r of remainingWork.slice(0, 3)) {
        lines.push(`- ${r}`);
      }
    }

    lines.push("=========================================");

    let serializedText = lines.join("\n");
    let tokenCount = countTokens(serializedText);

    // If summary exceeds budget, trim lines from discoveries/decisions
    if (tokenCount > maxSummaryTokens) {
      serializedText =
        lines.slice(0, 10).join("\n") + "\n=========================================";
      tokenCount = countTokens(serializedText);
    }

    const summary: CompactionSummary = {
      objective: objective || "Complete requested task",
      decisions: decisions.slice(0, 4),
      modifiedFiles: Array.from(modifiedFiles),
      relevantDiscoveries: relevantDiscoveries.slice(0, 4),
      remainingWork: remainingWork.slice(0, 3),
      failedApproaches: failedApproaches.slice(0, 5),
      validationStatus,
      serializedText,
      tokenCount,
    };

    const summaryMessage: AgentMessage = {
      role: "user",
      content: serializedText,
      timestamp: new Date().toISOString(),
    };

    const compactedMessages: AgentMessage[] = [];
    if (systemMessage) {
      compactedMessages.push(systemMessage);
    }
    compactedMessages.push(summaryMessage);
    compactedMessages.push(...recentMessages);

    return { compactedMessages, summary };
  }
}

export class DefaultContextManager implements ContextManager {
  private readonly budget: ContextBudget;
  private readonly budgetManager: TokenBudgetManager;

  constructor(budget: ContextBudget = DEFAULT_CONTEXT_BUDGET) {
    this.budget = budget;
    this.budgetManager = new TokenBudgetManager(budget.roleBudgets);
  }

  getBudgetManager(): TokenBudgetManager {
    return this.budgetManager;
  }

  /**
   * Assemble minimal, progressive, task-specific context partitioned by strict layer budgets.
   */
  async assembleContext(
    task: TaskDefinition,
    plan: TaskPlan,
    errorFeedback?: string,
    options?: ContextAssemblyOptions,
  ): Promise<AssembledContext> {
    const includedReferences: string[] = [];
    const securityWarnings: string[] = [];
    let systemTokens = 0;
    let contractTokens = 0;
    let repoStructureTokens = 0;
    let knowledgeTokens = 0;
    let citedExcerptsTokens = 0;
    let diagnosticTokens = 0;
    let projectKnowledgePackage: unknown = undefined;

    // --------------------------------------------------------------------------
    // Layer 0: System Instructions (Target budget: <= 300 tokens)
    // --------------------------------------------------------------------------
    const role: AgentRole = options?.role || "single-agent";
    const roleTitle = role === "single-agent" ? "Single-Agent" : role.toUpperCase();
    const systemPromptLines = [
      `# Helix ${roleTitle} Execution`,
      `You are executing an atomic task under Helix as role: ${role}.`,
      "Work cleanly, deterministically, and minimally. Preserve existing code and documentation.",
      "",
      "## Invariants & Rules",
      `- Forbidden paths: ${task.constraints.forbiddenPaths.join(", ")}`,
      "- Zero token gate: all changes must satisfy mechanical validation before acceptance.",
      `- Verification command: ${task.passCommand || "node .helix/gate.mjs"}`,
      "- Strictly avoid inspecting or reading whole files exceeding 200 lines.",
      "- Output minimal text; prefer precise, verified changes.",
    ];

    if (task.isQuestion) {
      systemPromptLines.push(
        "- Informational question only: do NOT modify or create any files. Answer directly.",
      );
    }

    const systemPrompt = systemPromptLines.join("\n");
    systemTokens = countTokens(systemPrompt);

    // --------------------------------------------------------------------------
    // Layer 1: Task Contract & Handoff Card (Target budget: <= 350 tokens)
    // --------------------------------------------------------------------------
    const taskPromptLines: string[] = [];

    if (options?.handoffCard) {
      taskPromptLines.push(
        "## Handoff Contract (Max 12 Lines)",
        options.handoffCard.serializedText,
      );
    } else {
      taskPromptLines.push(
        `Task ID: ${task.id}`,
        `Title: ${task.title}`,
        `Tier: ${plan.tier}`,
        "",
        "## Prompt",
        task.prompt,
      );

      if (task.targetFiles && task.targetFiles.length > 0) {
        taskPromptLines.push("", `## Target Files (${task.targetFiles.length})`);
        for (const f of task.targetFiles) {
          taskPromptLines.push(`- ${f}`);
          includedReferences.push(f);
        }
      }
    }

    contractTokens = countTokens(taskPromptLines.join("\n"));

    // --------------------------------------------------------------------------
    // Layer 2: Repository Structure & Exported Interfaces (Target: <= 500 tokens)
    // --------------------------------------------------------------------------
    const structureLines: string[] = [];

    if (
      options?.includeInterfaces &&
      options?.retriever?.extractInterfaces &&
      task.targetFiles &&
      task.targetFiles.length > 0
    ) {
      const ifaces = await options.retriever.extractInterfaces(
        task.targetFiles,
        this.budget.repoContextMaxTokens / 2,
      );
      if (ifaces) {
        structureLines.push("", "## Exported Interfaces & Types", ifaces);
      }
    }

    if (
      options?.includeTests &&
      options?.retriever?.findRelatedTests &&
      task.targetFiles &&
      task.targetFiles.length > 0
    ) {
      const tests = await options.retriever.findRelatedTests(task.targetFiles);
      if (tests.length > 0) {
        structureLines.push("", "## Related Tests", ...tests.map((t) => `- ${t}`));
        for (const t of tests) {
          if (!includedReferences.includes(t)) includedReferences.push(t);
        }
      }
    }

    const structureText = structureLines.join("\n");
    repoStructureTokens = countTokens(structureText);
    if (structureText) {
      taskPromptLines.push(structureText);
    }

    // --------------------------------------------------------------------------
    // Layer 2.5: Adaptive Project Knowledge System (APKS) Retrieval
    // --------------------------------------------------------------------------
    if (options?.knowledgeRetriever && options.enableProjectKnowledge !== false) {
      try {
        const pkg = await options.knowledgeRetriever.retrieve({
          taskId: task.id,
          prompt: task.prompt,
          targetFiles: task.targetFiles,
          changedPaths: options.recentDiff ? [options.recentDiff] : undefined,
          agentRole: role,
          tokenBudget: options.knowledgeTokenBudget || 1200,
        });

        if (pkg && pkg.items && pkg.items.length > 0) {
          projectKnowledgePackage = pkg;
          const kSection = "\n" + pkg.markdownSection;
          knowledgeTokens = countTokens(kSection);
          taskPromptLines.push(kSection);

          for (const item of pkg.items) {
            includedReferences.push(`knowledge:${item.item.id}`);
          }
        }
      } catch (kErr) {
        securityWarnings.push(
          `Project knowledge retrieval degraded gracefully: ${kErr instanceof Error ? kErr.message : String(kErr)}`,
        );
      }
    }

    // --------------------------------------------------------------------------
    // Layer 3: Cited Line Excerpts (Target: <= 1,400 tokens)
    // --------------------------------------------------------------------------
    let citedExcerpts: CitedExcerpt[] | undefined;

    if (options?.citations && options.citations.length > 0 && options.retriever) {
      citedExcerpts = await options.retriever.fetchExcerpts(options.citations);
      if (citedExcerpts.length > 0) {
        const excerptLines = ["", "## Cited Repository Excerpts"];
        for (const ex of citedExcerpts) {
          let excerptBody = ex.content;
          if (options.scanPromptInjection !== false) {
            const injection = UntrustedContentHandler.detectPromptInjection(excerptBody);
            if (injection.detected) {
              securityWarnings.push(
                `Prompt injection signature detected in ${ex.filePath}: ${injection.patterns.join(", ")}`,
              );
              excerptBody = injection.neutralizedText;
            }
          }
          if (options.wrapUntrusted) {
            excerptBody = UntrustedContentHandler.wrapUntrustedContent(excerptBody, {
              source: `${ex.filePath}:L${ex.startLine}-L${ex.endLine}`,
              integrity: "untrusted",
              scanPromptInjection: false,
            });
          }
          excerptLines.push(
            `### ${ex.filePath} (L${ex.startLine}-L${ex.endLine}) - ${ex.relevanceReason}`,
            options.wrapUntrusted ? excerptBody : ["```ts", excerptBody, "```"].join("\n"),
          );
          if (!includedReferences.includes(ex.filePath)) {
            includedReferences.push(ex.filePath);
          }
        }
        const excerptsText = excerptLines.join("\n");
        citedExcerptsTokens = countTokens(excerptsText);

        // Enforce prompt ceiling on excerpts
        if (citedExcerptsTokens <= 1400) {
          taskPromptLines.push(excerptsText);
        } else {
          // Truncate excerpts to fit
          taskPromptLines.push(
            excerptsText.slice(0, 4000) + "\n[Excerpts truncated to fit prompt ceiling]",
          );
          citedExcerptsTokens = countTokens(taskPromptLines[taskPromptLines.length - 1]);
        }
      }
    }

    // --------------------------------------------------------------------------
    // Layer 4: Gate Diagnostic Feedback (Target: <= 400 tokens)
    // --------------------------------------------------------------------------
    if (errorFeedback && errorFeedback.trim().length > 0) {
      const trimmedFeedback = errorFeedback.trim();
      const feedbackHeader = "\n## Prior Verification Failure (Address this failure directly):\n";
      diagnosticTokens = countTokens(feedbackHeader + trimmedFeedback);

      if (diagnosticTokens > this.budget.errorFeedbackMaxTokens) {
        // Clamp error feedback to budget
        const clampedFeedback =
          trimmedFeedback.slice(0, 1200) + "\n[Diagnostics truncated to fit budget]";
        taskPromptLines.push(feedbackHeader, clampedFeedback);
        diagnosticTokens = countTokens(feedbackHeader + clampedFeedback);
      } else {
        taskPromptLines.push(feedbackHeader, trimmedFeedback);
      }
    }

    if (securityWarnings.length > 0) {
      taskPromptLines.unshift(
        "## Security Notice (Untrusted Repository Content)",
        ...securityWarnings.map((w) => `> [!WARNING] ${w}`),
        "",
      );
    }

    const taskPrompt = taskPromptLines.join("\n");
    const totalTokens = countTokens(systemPrompt) + countTokens(taskPrompt);
    const budgetRemaining = Math.max(0, this.budget.totalPromptMaxTokens - totalTokens);

    return {
      systemPrompt,
      taskPrompt,
      tokenCount: totalTokens,
      budgetRemaining,
      includedReferences,
      securityWarnings: securityWarnings.length > 0 ? securityWarnings : undefined,
      layerBreakdown: {
        systemTokens,
        contractTokens,
        repoStructureTokens,
        knowledgeTokens,
        citedExcerptsTokens,
        diagnosticTokens,
      },
      projectKnowledgePackage,
      citedExcerpts,
      handoffCard: options?.handoffCard,
    };
  }

  /**
   * Prune older conversation messages preserving system instructions and recent turns.
   */
  pruneHistory(messages: AgentMessage[], maxTokens: number): AgentMessage[] {
    let currentTokens = 0;
    const kept: AgentMessage[] = [];

    // Always preserve system messages and recent user/assistant turns
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      const msgTokens = countTokens(msg.content);
      if (currentTokens + msgTokens <= maxTokens || msg.role === "system") {
        kept.unshift(msg);
        currentTokens += msgTokens;
      } else {
        break;
      }
    }

    return kept;
  }

  /**
   * Compact multi-turn history into structured summary card preserving critical facts.
   */
  async compactHistory(
    messages: AgentMessage[],
    options?: CompactionOptions,
  ): Promise<{ compactedMessages: AgentMessage[]; summary: CompactionSummary }> {
    return ContextCompactor.compact(messages, options);
  }
}
