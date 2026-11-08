// Helix Tool Execution & Security Confinement (Phases 03 & 06)
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  CommandSecurityInspector,
  assertCanonicalKnowledgeWriteAllowed,
  DangerousCommandError,
  isForbidden,
  isTamperProtected,
  redactSecrets,
  resolveSafePath,
  sanitizeEnvironment,
  SecurityGuard,
  SENSITIVE_PATTERNS,
  ToolArgumentValidationError,
  ToolSecurityError,
  validateToolArguments,
} from "./security.ts";
import { countTokens } from "../measure.ts";
import { matchDomainsForFilePath, matchEpisodicRulesForSource } from "../knowledge/discovery.ts";
import { parseFrontmatter, TieredKnowledgeRepository } from "../knowledge/repository.ts";
import { retrieveEpisodicRecords } from "../knowledge/retriever.ts";
import { matchPathGlob } from "../knowledge/glob.ts";
import { compileTier0DomainRoutes, syncCanonicalSkillStore } from "../knowledge/discovery.ts";
import type { ProgressiveContextState } from "./context.ts";
import {
  resolveOrthogonalAuditor,
  invokeProviderHeadlessAgent,
  type HeadlessApiConfiguration,
  type HeadlessProvider,
  type ModelRoute,
  type ProviderSelection,
} from "./provider.ts";
import type { HelixTeamRuntime, PeerMessageType } from "./state.ts";
import { searchMcpToolSchemas } from "../mcps.ts";
import type { McpDiscoveredToolSchema } from "../mcps.ts";
import type {
  CommandClassificationResult,
  ToolExecutionContext,
  ToolExecutionResult,
  ToolExecutor,
} from "./types.ts";

export interface ProgressiveToolSchema {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Readonly<Record<string, unknown>>;
  readonly source: "native" | "mcp";
}

export interface ProgressiveToolCallResult {
  readonly content: string;
  readonly isError?: boolean;
}

export type ProgressiveRuntimeEvent = {
  readonly type:
    "skill_loaded" | "visibility_tools_unlocked" | "peer_consulted" | "team_task_state";
  readonly payload: Readonly<Record<string, unknown>>;
};

const NATIVE_PROGRESSIVE_SCHEMAS: readonly ProgressiveToolSchema[] = [
  {
    name: "load_skill",
    description: "Load one canonical domain skill and matching episodic notes.",
    source: "native",
    inputSchema: {
      type: "object",
      properties: { domain_id: { type: "string" }, reference_file: { type: "string" } },
      required: ["domain_id"],
      additionalProperties: false,
    },
  },
  {
    name: "tool_search",
    description: "Find tool schemas by intent before invoking a tool.",
    source: "native",
    inputSchema: {
      type: "object",
      properties: {
        intent_query: { type: "string" },
        limit: { type: "integer", minimum: 1, maximum: 10 },
      },
      required: ["intent_query"],
      additionalProperties: false,
    },
  },
  {
    name: "spawn_scout",
    description: "Run an isolated read-only repository scout.",
    source: "native",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string" }, pathScope: { type: "string" } },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "consult_peer",
    description: "Ask an orthogonal read-only model to critique an approach.",
    source: "native",
    inputSchema: {
      type: "object",
      properties: {
        counterpartRole: { type: "string", enum: ["codex", "opencode", "claude"] },
        question: { type: "string" },
        fileSlices: {
          type: "array",
          maxItems: 8,
          items: {
            type: "object",
            properties: {
              filePath: { type: "string" },
              startLine: { type: "integer", minimum: 1 },
              endLine: { type: "integer", minimum: 1 },
            },
            required: ["filePath", "startLine", "endLine"],
            additionalProperties: false,
          },
        },
        proposedApproach: { type: "string" },
      },
      required: ["question", "fileSlices"],
      additionalProperties: false,
    },
  },
  {
    name: "claim_team_task",
    description: "Claim a dependency-ready team task in read-only plan mode.",
    source: "native",
    inputSchema: {
      type: "object",
      properties: { task_id: { type: "string" } },
      required: ["task_id"],
      additionalProperties: false,
    },
  },
  {
    name: "submit_teammate_plan",
    description: "Submit an interface contract for lead approval before writing.",
    source: "native",
    inputSchema: {
      type: "object",
      properties: { task_id: { type: "string" }, interface_contract: { type: "string" } },
      required: ["task_id", "interface_contract"],
      additionalProperties: false,
    },
  },
  {
    name: "approve_teammate_plan",
    description: "Approve a teammate's interface contract as team lead.",
    source: "native",
    inputSchema: {
      type: "object",
      properties: {
        teammate_id: { type: "string" },
        task_id: { type: "string" },
        approved: { type: "boolean" },
        feedback: { type: "string" },
      },
      required: ["teammate_id", "task_id", "approved"],
      additionalProperties: false,
    },
  },
  {
    name: "send_peer_message",
    description: "Send a sanitized JSON message to a teammate inbox.",
    source: "native",
    inputSchema: {
      type: "object",
      properties: {
        target_agent: { type: "string" },
        message_type: {
          type: "string",
          enum: ["plan", "question", "finding", "status", "answer", "broadcast"],
        },
        payload: { type: "object" },
      },
      required: ["target_agent", "message_type", "payload"],
      additionalProperties: false,
    },
  },
  {
    name: "broadcast_team",
    description: "Send a sanitized JSON message to every active teammate inbox.",
    source: "native",
    inputSchema: {
      type: "object",
      properties: {
        message_type: {
          type: "string",
          enum: ["plan", "question", "finding", "status", "answer", "broadcast"],
        },
        payload: { type: "object" },
      },
      required: ["message_type", "payload"],
      additionalProperties: false,
    },
  },
  {
    name: "Read",
    description: "Read a file or line range from the workspace.",
    source: "native",
    inputSchema: {
      type: "object",
      properties: {
        filePath: { type: "string" },
        startLine: { type: "integer" },
        endLine: { type: "integer" },
      },
      required: ["filePath"],
      additionalProperties: false,
    },
  },
  {
    name: "Grep",
    description: "Search workspace files for literal text.",
    source: "native",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string" }, pathScope: { type: "string" } },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "Glob",
    description: "List workspace files matching a glob pattern.",
    source: "native",
    inputSchema: {
      type: "object",
      properties: { pattern: { type: "string" } },
      required: ["pattern"],
      additionalProperties: false,
    },
  },
  {
    name: "Write",
    description: "Write a file within an approved write scope.",
    source: "native",
    inputSchema: {
      type: "object",
      properties: { filePath: { type: "string" }, content: { type: "string" } },
      required: ["filePath", "content"],
      additionalProperties: false,
    },
  },
  {
    name: "Edit",
    description: "Replace one exact text range within an approved write scope.",
    source: "native",
    inputSchema: {
      type: "object",
      properties: {
        filePath: { type: "string" },
        oldString: { type: "string" },
        newString: { type: "string" },
      },
      required: ["filePath", "oldString", "newString"],
      additionalProperties: false,
    },
  },
];

function objectInput(input: unknown): Record<string, unknown> {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Tool input must be a JSON object");
  }
  return input as Record<string, unknown>;
}

function isPeerMessageType(value: unknown): value is PeerMessageType {
  return (
    value === "plan" ||
    value === "question" ||
    value === "finding" ||
    value === "status" ||
    value === "answer" ||
    value === "broadcast"
  );
}

function requiredString(input: Record<string, unknown>, key: string): string {
  const value = input[key];
  if (typeof value !== "string" || value.length === 0)
    throw new Error(`${key} must be a non-empty string`);
  return value;
}

function stringValue(input: Record<string, unknown>, key: string): string {
  const value = input[key];
  if (typeof value !== "string") throw new Error(`${key} must be a string`);
  return value;
}

function redactToolOutput(value: string): string {
  let output = redactSecrets(value).text;
  const canary = process.env.ADMIN_TEST_KEY;
  if (canary) output = output.split(canary).join("[REDACTED_CANARY]");
  return output.replace(/\bADMIN_TEST_KEY\s*[:=]\s*[^\s,;]+/g, "ADMIN_TEST_KEY=[REDACTED_CANARY]");
}

function progressiveToolContext(
  context: ToolExecutionContext | undefined,
  workspaceRoot: string,
  redact = false,
): ToolExecutionContext {
  return {
    workspaceRoot,
    environmentVariables: context?.environmentVariables ?? {},
    forbiddenPaths: context?.forbiddenPaths ?? [],
    maxOutputBytes: context?.maxOutputBytes ?? 64 * 1024,
    timeoutMs: context?.timeoutMs ?? 30_000,
    role: context?.role,
    permissions: context?.permissions,
    networkPolicy: context?.networkPolicy,
    validateArguments: context?.validateArguments,
    redactSecrets: redact || context?.redactSecrets,
    auditLogger: context?.auditLogger,
  };
}

/** Runtime registry for two-level disclosure, tool visibility, and path-aware knowledge hints. */
export class ProgressiveToolRuntime {
  readonly schemas = new Map<string, ProgressiveToolSchema>();
  private readonly workspaceRoot: string;
  private readonly state: ProgressiveContextState;
  private readonly executor: DefaultToolExecutor;
  private readonly teamRuntime?: HelixTeamRuntime;
  private readonly teammateId?: string;
  private readonly callbacks: {
    spawnScout?: (input: Record<string, unknown>) => Promise<ProgressiveToolCallResult>;
    consultPeer?: (input: Record<string, unknown>) => Promise<ProgressiveToolCallResult>;
    mcpExecutor?: (toolName: string, input: unknown) => Promise<unknown>;
    onProgress?: (event: ProgressiveRuntimeEvent) => void;
  };

  constructor(options: {
    workspaceRoot?: string;
    state: ProgressiveContextState;
    executor?: DefaultToolExecutor;
    schemas?: readonly ProgressiveToolSchema[];
    spawnScout?: (input: Record<string, unknown>) => Promise<ProgressiveToolCallResult>;
    consultPeer?: (input: Record<string, unknown>) => Promise<ProgressiveToolCallResult>;
    mcpExecutor?: (toolName: string, input: unknown) => Promise<unknown>;
    teamRuntime?: HelixTeamRuntime;
    teammateId?: string;
    peerConsult?: {
      readonly generatorProvider: ProviderSelection | HeadlessProvider | string;
      readonly resolveApi: (route: ModelRoute) => HeadlessApiConfiguration | undefined;
    };
    onProgress?: (event: ProgressiveRuntimeEvent) => void;
  }) {
    this.workspaceRoot = path.resolve(options.workspaceRoot ?? process.cwd());
    this.state = options.state;
    this.executor = options.executor ?? new DefaultToolExecutor();
    this.teamRuntime = options.teamRuntime;
    this.teammateId = options.teammateId;
    this.callbacks = {
      spawnScout: options.spawnScout,
      consultPeer:
        options.consultPeer ??
        (options.peerConsult
          ? createConsultPeerHandler({ workspaceRoot: this.workspaceRoot, ...options.peerConsult })
          : undefined),
      mcpExecutor: options.mcpExecutor,
      onProgress: options.onProgress,
    };
    for (const schema of [...NATIVE_PROGRESSIVE_SCHEMAS, ...(options.schemas ?? [])])
      this.registerSchema(schema);
  }

  registerSchema(schema: ProgressiveToolSchema): void {
    if (!schema.name.trim() || !schema.inputSchema || typeof schema.inputSchema !== "object") {
      throw new Error("Tool schemas require a name and object inputSchema");
    }
    this.schemas.set(schema.name, schema);
  }

  approveWriteScope(glob: string): void {
    if (!glob.trim()) throw new Error("Write scope cannot be empty");
    if (this.teamRuntime && this.teammateId)
      this.teamRuntime.assertScopeAllowed(this.teammateId, glob);
    this.state.approvedWriteScopes.add(glob);
  }

  private requireTeamRuntime(): { teamRuntime: HelixTeamRuntime; teammateId: string } {
    if (!this.teamRuntime || !this.teammateId)
      throw new Error("Peer team runtime is not configured for this agent");
    return { teamRuntime: this.teamRuntime, teammateId: this.teammateId };
  }

  toolSearch(intentQuery: string, limit = 5): ProgressiveToolSchema[] {
    const queryTerms = new Set(
      intentQuery
        .toLowerCase()
        .split(/[^a-z0-9_]+/)
        .filter(Boolean),
    );
    const boundedLimit = Math.max(1, Math.min(10, Math.trunc(limit)));
    const mcpCandidates = [...this.schemas.values()].filter(
      (schema): schema is ProgressiveToolSchema & McpDiscoveredToolSchema =>
        schema.source === "mcp",
    );
    const rankedMcp = new Set(
      searchMcpToolSchemas(intentQuery, mcpCandidates, boundedLimit).map((schema) => schema.name),
    );
    const matches = [...this.schemas.values()]
      .filter(
        (schema) =>
          schema.name !== "tool_search" &&
          (schema.source === "native" || rankedMcp.has(schema.name)),
      )
      .map((schema) => {
        const text = `${schema.name} ${schema.description}`.toLowerCase();
        const score = [...queryTerms].reduce(
          (total, term) => total + (text.includes(term) ? 1 : 0),
          0,
        );
        return { schema, score };
      })
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score || a.schema.name.localeCompare(b.schema.name))
      .slice(0, boundedLimit)
      .map(({ schema }) => schema);
    const newlyVisible = matches.filter((schema) => !this.state.visibleToolNames.has(schema.name));
    for (const schema of matches) this.state.visibleToolNames.add(schema.name);
    if (newlyVisible.length)
      this.callbacks.onProgress?.({
        type: "visibility_tools_unlocked",
        payload: { count: newlyVisible.length, names: newlyVisible.map((schema) => schema.name) },
      });
    return matches;
  }

  async invoke(
    name: string,
    input: unknown,
    context?: ToolExecutionContext,
  ): Promise<ProgressiveToolCallResult> {
    if (!this.state.visibleToolNames.has(name)) {
      return {
        isError: true,
        content: JSON.stringify({
          code: "TOOL_NOT_VISIBLE",
          tool: name,
          message: `Tool '${name}' is not visible. Call tool_search(intent_query) first to discover and unlock its schema.`,
        }),
      };
    }
    try {
      const args = objectInput(input);
      let result: ProgressiveToolCallResult;
      switch (name) {
        case "tool_search": {
          const schemas = this.toolSearch(
            requiredString(args, "intent_query"),
            typeof args.limit === "number" ? args.limit : 5,
          );
          result = { content: JSON.stringify(schemas) };
          break;
        }
        case "load_skill":
          result = await this.loadSkill(
            requiredString(args, "domain_id"),
            typeof args.reference_file === "string" ? args.reference_file : undefined,
          );
          if (!result.isError)
            this.callbacks.onProgress?.({
              type: "skill_loaded",
              payload: { domainId: requiredString(args, "domain_id") },
            });
          break;
        case "Read":
          result = {
            content: await this.readWithHints(
              requiredString(args, "filePath"),
              args.startLine,
              args.endLine,
              context,
            ),
          };
          break;
        case "Write":
          result = await this.writeApproved(
            requiredString(args, "filePath"),
            stringValue(args, "content"),
            context,
          );
          break;
        case "Edit":
          result = await this.editApproved(
            requiredString(args, "filePath"),
            requiredString(args, "oldString"),
            stringValue(args, "newString"),
            context,
          );
          break;
        case "Grep":
          result = await this.grep(
            requiredString(args, "query"),
            typeof args.pathScope === "string" ? args.pathScope : "",
          );
          break;
        case "Glob":
          result = await this.glob(requiredString(args, "pattern"));
          break;
        case "spawn_scout":
          result = this.callbacks.spawnScout
            ? await this.callbacks.spawnScout(args)
            : { isError: true, content: "Scout execution is not configured for this runtime." };
          break;
        case "consult_peer":
          result = this.callbacks.consultPeer
            ? await this.callbacks.consultPeer(args)
            : { isError: true, content: "Peer consultation is not configured for this runtime." };
          if (!result.isError) {
            try {
              const peer: unknown = JSON.parse(result.content);
              if (peer !== null && typeof peer === "object" && !Array.isArray(peer)) {
                const record = peer as Record<string, unknown>;
                this.callbacks.onProgress?.({
                  type: "peer_consulted",
                  payload: {
                    reviewerHarness: record.reviewerHarness,
                    reviewerModelId: record.reviewerModelId,
                  },
                });
              }
            } catch {
              /* Custom peer callbacks may return plain text. */
            }
          }
          break;
        case "claim_team_task": {
          const { teamRuntime, teammateId } = this.requireTeamRuntime();
          const claimed = teamRuntime.claimTask(requiredString(args, "task_id"), teammateId);
          result = { content: JSON.stringify(claimed) };
          this.callbacks.onProgress?.({
            type: "team_task_state",
            payload: { taskId: claimed.taskId, from: "pending", to: claimed.status },
          });
          break;
        }
        case "submit_teammate_plan": {
          const { teamRuntime, teammateId } = this.requireTeamRuntime();
          result = {
            content: JSON.stringify(
              teamRuntime.submitPlan(
                teammateId,
                requiredString(args, "task_id"),
                requiredString(args, "interface_contract"),
              ),
            ),
          };
          break;
        }
        case "approve_teammate_plan": {
          const { teamRuntime, teammateId } = this.requireTeamRuntime();
          if (!teamRuntime.isLead(teammateId))
            throw new Error("Only the lead agent may approve a teammate plan");
          const approved = teamRuntime.approve_teammate_plan(teammateId, {
            teammate_id: requiredString(args, "teammate_id"),
            task_id: requiredString(args, "task_id"),
            approved: args.approved === true,
            ...(typeof args.feedback === "string" ? { feedback: args.feedback } : {}),
          });
          result = { content: JSON.stringify(approved) };
          if (approved.planApprovedByLead)
            this.callbacks.onProgress?.({
              type: "team_task_state",
              payload: {
                taskId: approved.taskId,
                from: "awaiting_plan_approval",
                to: approved.status,
              },
            });
          break;
        }
        case "send_peer_message": {
          const { teamRuntime, teammateId } = this.requireTeamRuntime();
          if (
            !isPeerMessageType(args.message_type) ||
            args.payload === null ||
            typeof args.payload !== "object" ||
            Array.isArray(args.payload)
          )
            throw new Error("Peer message type or payload is invalid");
          teamRuntime.send_peer_message(teammateId, {
            target_agent: requiredString(args, "target_agent"),
            message_type: args.message_type,
            payload: args.payload as Record<string, unknown>,
          });
          result = { content: "Peer message queued." };
          break;
        }
        case "broadcast_team": {
          const { teamRuntime, teammateId } = this.requireTeamRuntime();
          if (
            !isPeerMessageType(args.message_type) ||
            args.payload === null ||
            typeof args.payload !== "object" ||
            Array.isArray(args.payload)
          )
            throw new Error("Peer message type or payload is invalid");
          teamRuntime.broadcast_team(teammateId, {
            message_type: args.message_type,
            payload: args.payload as Record<string, unknown>,
          });
          result = { content: "Team broadcast queued." };
          break;
        }
        default: {
          const schema = this.schemas.get(name);
          if (!schema || schema.source !== "mcp")
            throw new Error(`No executor is registered for ${name}`);
          if (!this.callbacks.mcpExecutor) {
            result = {
              isError: true,
              content: `MCP tool '${name}' has a visible schema but no connected executor.`,
            };
          } else {
            const mcpOutput = await this.callbacks.mcpExecutor(name, args);
            result = {
              content:
                typeof mcpOutput === "string"
                  ? mcpOutput
                  : (JSON.stringify(mcpOutput) ?? String(mcpOutput)),
            };
          }
        }
      }
      return { ...result, content: redactToolOutput(result.content) };
    } catch (error) {
      return { isError: true, content: error instanceof Error ? error.message : String(error) };
    }
  }

  private async loadSkill(
    domainId: string,
    referenceFile?: string,
  ): Promise<ProgressiveToolCallResult> {
    if (!/^[a-z0-9][a-z0-9._-]*$/i.test(domainId)) throw new Error("Invalid domain_id");
    const repository = new TieredKnowledgeRepository(this.workspaceRoot);
    try {
      const allRoutes = compileTier0DomainRoutes(this.workspaceRoot).filter(
        (route) => route.domainId === domainId,
      );
      if (allRoutes.length === 0) throw new Error(`Unknown knowledge domain: ${domainId}`);
      syncCanonicalSkillStore(allRoutes, repository, this.workspaceRoot);
      const skill = repository.getCanonicalSkill(domainId);
      if (!skill) throw new Error(`Canonical skill is not available: ${domainId}`);
      if (skill.route.skillTokenCost > 600 || countTokens(skill.bodyMarkdown) > 600)
        throw new Error(`Canonical skill ${domainId} exceeds the 600-token budget`);
      const skillBody = parseFrontmatter(skill.bodyMarkdown).content;
      const records = retrieveEpisodicRecords(
        repository,
        `${domainId} ${skill.route.description}`,
        { domainId, limit: 3, maxTokens: 250 },
      );
      for (const record of records) this.state.injectedEpisodicIds.add(record.id);
      let references = "";
      if (referenceFile) {
        const domainRoot = path.join(
          this.workspaceRoot,
          ".helix",
          "knowledge",
          "domains",
          domainId,
        );
        const referenceRoot = path.resolve(domainRoot, "references");
        const target = path.resolve(referenceRoot, referenceFile);
        const relative = path.relative(referenceRoot, target);
        if (relative.startsWith("..") || path.isAbsolute(relative))
          throw new Error("reference_file must stay inside the domain references directory");
        if (!fs.existsSync(target) || !fs.statSync(target).isFile())
          throw new Error(`Reference file does not exist: ${referenceFile}`);
        const realRoot = fs.realpathSync(referenceRoot);
        const realTarget = fs.realpathSync(target);
        const realRelative = path.relative(realRoot, realTarget);
        if (realRelative.startsWith("..") || path.isAbsolute(realRelative))
          throw new Error("reference_file resolves outside the domain references directory");
        references = `\n\n## Reference: ${referenceFile}\n${fs.readFileSync(realTarget, "utf8")}`;
      }
      this.state.loadedDomainIds.add(domainId);
      const notes = records
        .map((record) => `- ${record.triggerSummary}: ${record.resolutionRule}`)
        .join("\n");
      return {
        content: `${skillBody}${references}${notes ? `\n\n## Retrieved episodic notes\n${notes}` : ""}`,
      };
    } finally {
      repository.close();
    }
  }

  private async readWithHints(
    filePath: string,
    startLine: unknown,
    endLine: unknown,
    context?: ToolExecutionContext,
  ): Promise<string> {
    const content = await this.executor.readFile(
      filePath,
      typeof startLine === "number" ? startLine : undefined,
      typeof endLine === "number" ? endLine : undefined,
      progressiveToolContext(context, this.workspaceRoot, true),
    );
    const safePath = resolveSafePath(this.workspaceRoot, filePath, context?.forbiddenPaths);
    const fullSource =
      fs.existsSync(safePath) && fs.statSync(safePath).isFile()
        ? fs.readFileSync(safePath, "utf8")
        : undefined;
    const hints = this.pathHints(filePath, fullSource);
    return [content, ...hints].filter(Boolean).join("\n\n");
  }

  private pathHints(filePath: string, sourceCode?: string): string[] {
    const hints = matchDomainsForFilePath(filePath, this.workspaceRoot)
      .filter((route) => !this.state.loadedDomainIds.has(route.domainId))
      .map(
        (route) =>
          `[Helix Hint: File matches domain '${route.domainId}'. Call load_skill("${route.domainId}") for domain invariants.]`,
      );
    if (sourceCode && /\.(?:[cm]?js|tsx?)$/i.test(filePath)) {
      const repository = new TieredKnowledgeRepository(this.workspaceRoot);
      try {
        const records = matchEpisodicRulesForSource(filePath, sourceCode, repository);
        for (const record of records) {
          if (countTokens(record.resolutionRule) <= 100)
            hints.push(`[Helix Validated Rule ${record.id}]: ${record.resolutionRule}`);
        }
      } finally {
        repository.close();
      }
    }
    return hints;
  }

  private hasApprovedScope(filePath: string): boolean {
    const relative = path
      .relative(this.workspaceRoot, path.resolve(this.workspaceRoot, filePath))
      .replace(/\\/g, "/");
    if (this.teamRuntime && this.teammateId) {
      for (const glob of this.teamRuntime.approvedOwnedPaths(this.teammateId))
        this.state.approvedWriteScopes.add(glob);
    }
    return [...this.state.approvedWriteScopes].some((glob) => matchPathGlob(relative, glob));
  }

  private async writeApproved(
    filePath: string,
    content: string,
    context?: ToolExecutionContext,
  ): Promise<ProgressiveToolCallResult> {
    if (this.teamRuntime && this.teammateId)
      this.teamRuntime.assertWriteAllowed(this.teammateId, filePath);
    if (!this.hasApprovedScope(filePath))
      return {
        isError: true,
        content: `Write blocked: approve a write scope covering '${filePath}' first.`,
      };
    const result = await this.executor.writeFile(
      filePath,
      content,
      progressiveToolContext(context, this.workspaceRoot),
    );
    return { isError: result.exitCode !== 0, content: result.output };
  }

  private async editApproved(
    filePath: string,
    oldString: string,
    newString: string,
    context?: ToolExecutionContext,
  ): Promise<ProgressiveToolCallResult> {
    if (this.teamRuntime && this.teammateId)
      this.teamRuntime.assertWriteAllowed(this.teammateId, filePath);
    if (!this.hasApprovedScope(filePath))
      return {
        isError: true,
        content: `Edit blocked: approve a write scope covering '${filePath}' first.`,
      };
    const current = await this.executor.readFile(
      filePath,
      undefined,
      undefined,
      progressiveToolContext(context, this.workspaceRoot),
    );
    const first = current.indexOf(oldString);
    if (!oldString || first < 0 || current.indexOf(oldString, first + oldString.length) >= 0)
      throw new Error("Edit requires one exact, unique oldString match");
    const result = await this.executor.writeFile(
      filePath,
      current.slice(0, first) + newString + current.slice(first + oldString.length),
      progressiveToolContext(context, this.workspaceRoot),
    );
    if (result.exitCode !== 0) return { isError: true, content: result.output };
    const safePath = resolveSafePath(this.workspaceRoot, filePath, context?.forbiddenPaths);
    const sourceCode =
      fs.existsSync(safePath) && fs.statSync(safePath).isFile()
        ? fs.readFileSync(safePath, "utf8")
        : undefined;
    const hints = this.pathHints(filePath, sourceCode);
    return { isError: false, content: [result.output, ...hints].filter(Boolean).join("\n\n") };
  }

  private async grep(query: string, pathScope: string): Promise<ProgressiveToolCallResult> {
    const root = path.resolve(this.workspaceRoot, pathScope || ".");
    if (!root.startsWith(`${this.workspaceRoot}${path.sep}`) && root !== this.workspaceRoot)
      throw new Error("Grep scope escapes the workspace");
    const lines: string[] = [];
    const visit = (directory: string): void => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        if (entry.name === "node_modules" || entry.name === ".git") continue;
        const fullPath = path.join(directory, entry.name);
        if (entry.isDirectory()) visit(fullPath);
        else if (entry.isFile() && fs.statSync(fullPath).size <= 1_000_000) {
          const source = fs.readFileSync(fullPath, "utf8");
          source.split(/\r?\n/).forEach((line, index) => {
            if (line.includes(query))
              lines.push(`${path.relative(this.workspaceRoot, fullPath)}:${index + 1}:${line}`);
          });
        }
      }
    };
    visit(root);
    return { content: lines.slice(0, 100).join("\n") };
  }

  private async glob(pattern: string): Promise<ProgressiveToolCallResult> {
    const files: string[] = [];
    const visit = (directory: string): void => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        if (entry.name === "node_modules" || entry.name === ".git") continue;
        const fullPath = path.join(directory, entry.name);
        const relative = path.relative(this.workspaceRoot, fullPath).replace(/\\/g, "/");
        if (entry.isFile() && matchPathGlob(relative, pattern)) files.push(relative);
        else if (entry.isDirectory()) visit(fullPath);
      }
    };
    visit(this.workspaceRoot);
    return { content: files.sort().slice(0, 500).join("\n") };
  }
}

// Re-export core security helpers from security.ts for backward compatibility
export { ToolSecurityError, SENSITIVE_PATTERNS, isForbidden, isTamperProtected, resolveSafePath };

export type CachedFileRead = {
  content: string;
  mtimeMs: number;
  size: number;
  readCount: number;
};

export class ToolVisibilityError extends Error {
  readonly code = "TOOL_NOT_VISIBLE";
  readonly toolName: string;

  constructor(toolName: string) {
    super(
      `Tool '${toolName}' is not visible. Call tool_search(intent_query) first to discover and unlock its schema.`,
    );
    this.name = "ToolVisibilityError";
    this.toolName = toolName;
  }

  toToolError(): ProgressiveToolCallResult {
    return {
      isError: true,
      content: JSON.stringify({ code: this.code, message: this.message, tool: this.toolName }),
    };
  }
}

export interface ConsultPeerInput {
  readonly counterpartRole?: "codex" | "opencode" | "claude";
  readonly question: string;
  readonly fileSlices: readonly {
    readonly filePath: string;
    readonly startLine: number;
    readonly endLine: number;
  }[];
  readonly proposedApproach?: string;
}

export function createConsultPeerHandler(options: {
  readonly workspaceRoot: string;
  readonly generatorProvider: ProviderSelection | HeadlessProvider | string;
  readonly resolveApi: (route: ModelRoute) => HeadlessApiConfiguration | undefined;
  readonly invoke?: (route: ModelRoute, prompt: string) => Promise<string>;
}): (input: Record<string, unknown>) => Promise<ProgressiveToolCallResult> {
  const root = fs.realpathSync(path.resolve(options.workspaceRoot));
  return async (input) => {
    if (
      typeof input.question !== "string" ||
      !input.question.trim() ||
      !Array.isArray(input.fileSlices) ||
      input.fileSlices.length > 8
    ) {
      throw new Error("consult_peer requires a question and at most eight fileSlices");
    }
    const slices: string[] = [];
    for (const value of input.fileSlices) {
      if (value === null || typeof value !== "object" || Array.isArray(value))
        throw new Error("consult_peer file slice must be an object");
      const slice = value as Record<string, unknown>;
      if (
        typeof slice.filePath !== "string" ||
        !Number.isSafeInteger(slice.startLine) ||
        !Number.isSafeInteger(slice.endLine)
      )
        throw new Error("consult_peer file slice requires filePath, startLine, and endLine");
      const startLine = slice.startLine as number;
      const endLine = slice.endLine as number;
      if (startLine < 1 || endLine < startLine || endLine - startLine > 100)
        throw new Error("consult_peer file slices must be between 1 and 101 lines");
      const absolute = path.resolve(root, slice.filePath);
      const real = fs.realpathSync(absolute);
      const relative = path.relative(root, real);
      if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative))
        throw new Error("consult_peer file slice escapes the worktree");
      const lines = fs.readFileSync(real, "utf8").split(/\r?\n/);
      if (endLine > lines.length)
        throw new Error(`consult_peer line range exceeds ${slice.filePath}`);
      const source = lines.slice(startLine - 1, endLine).join("\n");
      if (source.length === 0 && startLine > lines.length)
        throw new Error(`consult_peer line range exceeds ${slice.filePath}`);
      const safeSource = redactSecrets(source).text;
      const canary = process.env.ADMIN_TEST_KEY;
      const redacted = canary ? safeSource.split(canary).join("[REDACTED_CANARY]") : safeSource;
      slices.push(`### ${relative}:${startLine}-${endLine}\n${redacted}`);
    }
    const orthogonal = resolveOrthogonalAuditor(options.generatorProvider);
    let route = orthogonal;
    if (input.counterpartRole !== undefined) {
      if (
        input.counterpartRole !== "claude" &&
        input.counterpartRole !== "codex" &&
        input.counterpartRole !== "opencode"
      )
        throw new Error("Unsupported consult_peer counterpartRole");
      const defaults: Readonly<Record<HeadlessProvider, ModelRoute>> = {
        claude: { ...orthogonal, harness: "claude", modelId: "claude-fable-5-1" },
        codex: { ...orthogonal, harness: "codex", modelId: "gpt-6.1-sol" },
        opencode: { ...orthogonal, harness: "opencode", modelId: "gemini-3.1-pro" },
        copilot: { ...orthogonal, harness: "copilot", modelId: "gpt-6.1-sol" },
      };
      route = defaults[input.counterpartRole];
      const generatorHarness: HeadlessProvider =
        typeof options.generatorProvider === "string"
          ? /claude|anthropic/i.test(options.generatorProvider)
            ? "claude"
            : /codex|openai|gpt-/i.test(options.generatorProvider)
              ? "codex"
              : /copilot/i.test(options.generatorProvider)
                ? "copilot"
                : "opencode"
          : options.generatorProvider.harness;
      if (route.harness === generatorHarness)
        throw new Error("consult_peer counterpart must use a distinct harness family");
    }
    const prompt = [
      "You are a read-only engineering peer. Critique the proposed approach for concurrency, security, type, and edge-case hazards.",
      "Use the exact supplied source slices. Return a concise review of at most 300 tokens; do not propose edits.",
      `Question: ${input.question}`,
      typeof input.proposedApproach === "string"
        ? `Proposed approach: ${input.proposedApproach}`
        : "",
      ...slices,
    ]
      .filter(Boolean)
      .join("\n\n");
    const api = options.resolveApi(route);
    if (!api)
      throw new Error(
        "consult_peer requires an explicitly configured API endpoint for a tool-free read-only invocation",
      );
    const output = options.invoke
      ? await options.invoke(route, prompt)
      : (
          await invokeProviderHeadlessAgent(route.harness, {
            mode: "api",
            modelId: route.modelId,
            effort: "medium",
            prompt,
            timeoutMs: 60_000,
            maxInputTokens: 30_000,
            maxOutputTokens: 600,
            maxTurns: 3,
            readOnlyToolsOnly: true,
            api,
          })
        ).stdout;
    if (countTokens(output) > 300)
      throw new Error("Peer consultation exceeded the 300-token response limit");
    return {
      content: JSON.stringify({
        reviewerHarness: route.harness,
        reviewerModelId: route.modelId,
        review: output,
      }),
    };
  };
}

function assertVisible(context: ToolExecutionContext | undefined, name: string): void {
  if (context?.progressiveState && !context.progressiveState.visibleToolNames.has(name)) {
    throw new ToolVisibilityError(name);
  }
}

export class DefaultToolExecutor implements ToolExecutor {
  private fileReadCache = new Map<string, CachedFileRead>();
  private repeatedReadCount = 0;
  private readonly defaultSecurityGuard: SecurityGuard;

  constructor(securityGuard?: SecurityGuard) {
    this.defaultSecurityGuard = securityGuard || new SecurityGuard();
  }

  getRepeatedReadCount(): number {
    return this.repeatedReadCount;
  }

  clearCache(): void {
    this.fileReadCache.clear();
    this.repeatedReadCount = 0;
  }

  getSecurityGuard(): SecurityGuard {
    return this.defaultSecurityGuard;
  }

  async executeCommand(
    command: string,
    context: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    assertVisible(context, "Bash");
    const t0 = Date.now();
    const guard = this.defaultSecurityGuard;
    const auditLogger = context.auditLogger || guard.getAuditLogger();
    const timeoutMs = context.timeoutMs > 0 ? context.timeoutMs : 30000;
    const maxBytes = context.maxOutputBytes > 0 ? context.maxOutputBytes : 4096;

    // 1. Argument validation
    if (context.validateArguments !== false) {
      try {
        validateToolArguments("executeCommand", { command }, context.permissions);
      } catch (err) {
        auditLogger.log({
          type: "argument_validation",
          severity: "violation",
          role: context.role,
          message: err instanceof Error ? err.message : String(err),
          details: { command },
        });
        return {
          exitCode: 1,
          output: `Command blocked by security policy: ${err instanceof Error ? err.message : String(err)}`,
          truncated: false,
          durationMs: 0,
          error: "SecurityViolation",
        };
      }
    }

    // 2. Command Security & Permission Boundary Inspection
    let _inspection: CommandClassificationResult;
    try {
      _inspection = CommandSecurityInspector.assertCommandPermitted(
        command,
        context.permissions,
        context.role,
      );
    } catch (err) {
      auditLogger.log({
        type:
          err instanceof DangerousCommandError ? "dangerous_command_blocked" : "permission_check",
        severity: "violation",
        role: context.role,
        message: err instanceof Error ? err.message : String(err),
        details: { command },
      });
      return {
        exitCode: 1,
        output: `Command blocked by security policy: ${err instanceof Error ? err.message : String(err)}`,
        truncated: false,
        durationMs: 0,
        error: "SecurityViolation",
      };
    }

    // Check system directory access (retaining Phase 03 credentials check)
    if (/\b(~|\$HOME)\/(\.ssh|\.aws|\.gnupg)\b/.test(command)) {
      auditLogger.log({
        type: "forbidden_path_access",
        severity: "violation",
        role: context.role,
        message: "Command references sensitive system directories",
        details: { command },
      });
      return {
        exitCode: 1,
        output: "Command blocked by security policy: access to sensitive credentials detected",
        truncated: false,
        durationMs: 0,
        error: "SecurityViolation",
      };
    }

    // 3. Environment Variable Sanitization
    const sanitizedEnv = sanitizeEnvironment(
      { ...process.env, ...context.environmentVariables },
      [],
      context.networkPolicy || context.permissions?.networkPolicy || "none",
    );

    return new Promise((resolve) => {
      let stdoutFull = "";
      let stdoutTail = "";
      let stdoutTotal = 0;

      let stderrFull = "";
      let stderrTail = "";
      let stderrTotal = 0;

      let killed = false;

      const headBytes = Math.floor(maxBytes * 0.6);
      const tailBytes = Math.max(0, maxBytes - headBytes);

      const isPosix = process.platform !== "win32";
      const proc = spawn(command, {
        shell: true,
        cwd: context.workspaceRoot,
        env: sanitizedEnv,
        stdio: ["ignore", "pipe", "pipe"],
        detached: isPosix,
      });

      const timer = setTimeout(() => {
        killed = true;
        auditLogger.log({
          type: "execution_limit_exceeded",
          severity: "warning",
          role: context.role,
          message: `Command timed out after ${timeoutMs}ms: ${command}`,
          details: { command, timeoutMs },
        });
        try {
          if (isPosix && proc.pid) {
            process.kill(-proc.pid, "SIGKILL");
          } else {
            proc.kill("SIGKILL");
          }
        } catch {
          // Process might already be dead
        }
      }, timeoutMs);

      proc.stdout?.on("data", (chunk: Buffer) => {
        const text = chunk.toString("utf8");
        stdoutTotal += text.length;
        if (stdoutFull.length < maxBytes) {
          stdoutFull += text;
        }
        stdoutTail += text;
        if (stdoutTail.length > tailBytes) {
          stdoutTail = stdoutTail.slice(stdoutTail.length - tailBytes);
        }
      });

      proc.stderr?.on("data", (chunk: Buffer) => {
        const text = chunk.toString("utf8");
        stderrTotal += text.length;
        if (stderrFull.length < maxBytes) {
          stderrFull += text;
        }
        stderrTail += text;
        if (stderrTail.length > tailBytes) {
          stderrTail = stderrTail.slice(stderrTail.length - tailBytes);
        }
      });

      proc.on("error", (err) => {
        clearTimeout(timer);
        const durationMs = Date.now() - t0;
        resolve({
          exitCode: 1,
          output: stderrFull || err.message,
          truncated: false,
          durationMs,
          error: err.message,
        });
      });

      proc.on("close", (code) => {
        clearTimeout(timer);
        const durationMs = Date.now() - t0;

        const formatStream = (
          full: string,
          tail: string,
          total: number,
        ): { text: string; wasTruncated: boolean } => {
          if (total <= maxBytes) {
            return { text: full, wasTruncated: false };
          }
          const head = full.slice(0, headBytes);
          const omitted = Math.max(0, total - (head.length + tail.length));
          return {
            text: `${head}\n\n[... output truncated: ${omitted} bytes omitted to preserve token budget ...]\n\n${tail}`,
            wasTruncated: true,
          };
        };

        const outRes = formatStream(stdoutFull, stdoutTail, stdoutTotal);
        const errRes = formatStream(stderrFull, stderrTail, stderrTotal);

        let output = outRes.text;
        if (errRes.text) {
          output = output ? `${output}\n${errRes.text}` : errRes.text;
        }

        const truncated = outRes.wasTruncated || errRes.wasTruncated;

        // Secret redaction filter on output
        if (context.redactSecrets !== false) {
          const redacted = redactSecrets(output);
          if (redacted.count > 0) {
            auditLogger.log({
              type: "secret_redacted",
              severity: "warning",
              role: context.role,
              message: `Redacted ${redacted.count} secret(s) from command output`,
              details: { command, count: redacted.count, types: redacted.types },
            });
            output = redacted.text;
          }
        }

        if (killed) {
          resolve({
            exitCode: 124,
            output: output
              ? `${output}\n[command timed out after ${timeoutMs}ms]`
              : `[command timed out after ${timeoutMs}ms]`,
            truncated,
            durationMs,
            error: "ETIMEDOUT",
          });
          return;
        }

        resolve({
          exitCode: code ?? 0,
          output: output.trimEnd(),
          truncated,
          durationMs,
        });
      });
    });
  }

  async readFile(
    filePath: string,
    startLine?: number,
    endLine?: number,
    context?: ToolExecutionContext,
  ): Promise<string> {
    assertVisible(context, "Read");
    const root = context?.workspaceRoot || process.cwd();
    const guard = this.defaultSecurityGuard;
    const auditLogger = context?.auditLogger || guard.getAuditLogger();

    // 1. Permission check
    guard.assertPermission("readFile", context?.permissions, context?.role);

    // 2. Argument validation
    if (context?.validateArguments !== false) {
      validateToolArguments("readFile", { filePath, startLine, endLine }, context?.permissions);
    }

    const safePath = resolveSafePath(root, filePath, context?.forbiddenPaths);

    if (!fs.existsSync(safePath)) {
      throw new Error(`File does not exist: ${filePath}`);
    }

    const stat = fs.statSync(safePath);
    if (!stat.isFile()) {
      throw new Error(`Path is not a regular file: ${filePath}`);
    }

    // 3. File size limit
    const maxFileSize = context?.permissions?.maxFileSizeBytes || 10 * 1024 * 1024;
    if (stat.size > maxFileSize) {
      throw new ToolArgumentValidationError(
        "readFile",
        "filePath",
        `File size (${stat.size} bytes) exceeds maximum allowable limit (${maxFileSize} bytes)`,
      );
    }

    const cacheKey = `${safePath}:${stat.mtimeMs}:${stat.size}:${startLine ?? 1}:${endLine ?? -1}`;
    const cached = this.fileReadCache.get(cacheKey);
    if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
      cached.readCount++;
      this.repeatedReadCount++;
      return cached.content;
    }

    let content = fs.readFileSync(safePath, "utf8");

    // Redact secrets if requested
    if (context?.redactSecrets) {
      const red = redactSecrets(content);
      if (red.count > 0) {
        auditLogger.log({
          type: "secret_redacted",
          severity: "warning",
          role: context?.role,
          message: `Redacted ${red.count} secret(s) during file read of ${filePath}`,
          details: { filePath, count: red.count, types: red.types },
        });
        content = red.text;
      }
    }

    let result: string;
    if (startLine !== undefined || endLine !== undefined) {
      const lines = content.split("\n");
      const start = Math.max(1, startLine ?? 1) - 1;
      const end = endLine !== undefined ? Math.min(lines.length, endLine) : lines.length;
      result = lines.slice(start, end).join("\n");
    } else {
      const lines = content.split("\n");
      // Output control: if whole file has > 200 lines and no bounds provided, clamp to first 200 lines
      if (lines.length > 200) {
        result = [
          ...lines.slice(0, 200),
          `\n// [Output control: File has ${lines.length} lines; clamped to first 200 lines to avoid token blowout. Request targeted line ranges to inspect further.]`,
        ].join("\n");
      } else {
        result = content;
      }
    }

    this.fileReadCache.set(cacheKey, {
      content: result,
      mtimeMs: stat.mtimeMs,
      size: stat.size,
      readCount: 1,
    });

    return result;
  }

  async writeFile(
    filePath: string,
    content: string,
    context?: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    assertVisible(context, "Write");
    const t0 = Date.now();
    const root = context?.workspaceRoot || process.cwd();
    const guard = this.defaultSecurityGuard;
    const auditLogger = context?.auditLogger || guard.getAuditLogger();

    // 1. Permission check
    guard.assertPermission("writeFile", context?.permissions, context?.role);

    // 2. Argument validation
    if (context?.validateArguments !== false) {
      validateToolArguments("writeFile", { filePath, content }, context?.permissions);
    }

    const safePath = resolveSafePath(root, filePath, context?.forbiddenPaths);
    if (context?.progressiveState) {
      const relativePath = path.relative(root, safePath).replace(/\\/g, "/");
      const approved = [...context.progressiveState.approvedWriteScopes].some((glob) =>
        matchPathGlob(relativePath, glob),
      );
      if (!approved)
        throw new Error(`Write blocked: approve a write scope covering '${filePath}' first.`);
    }
    assertCanonicalKnowledgeWriteAllowed(safePath);
    const safeParent = path.dirname(safePath);
    if (fs.existsSync(safeParent)) {
      assertCanonicalKnowledgeWriteAllowed(
        path.join(fs.realpathSync(safeParent), path.basename(safePath)),
      );
    }

    try {
      const dir = path.dirname(safePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      const tmp = `${safePath}.tmp.${Date.now()}`;
      fs.writeFileSync(tmp, content, "utf8");
      fs.renameSync(tmp, safePath);

      // Invalidate file read cache for this path
      for (const key of this.fileReadCache.keys()) {
        if (key.startsWith(`${safePath}:`)) {
          this.fileReadCache.delete(key);
        }
      }

      auditLogger.log({
        type: "argument_validation",
        severity: "info",
        role: context?.role,
        message: `Successfully wrote ${Buffer.byteLength(content, "utf8")} bytes to ${filePath}`,
        details: { filePath, bytes: Buffer.byteLength(content, "utf8") },
      });

      return {
        exitCode: 0,
        output: `Successfully wrote ${Buffer.byteLength(content, "utf8")} bytes to ${filePath}`,
        truncated: false,
        durationMs: Date.now() - t0,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        exitCode: 1,
        output: `Failed to write file: ${msg}`,
        truncated: false,
        durationMs: Date.now() - t0,
        error: msg,
      };
    }
  }
}
