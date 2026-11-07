// Helix Execution State Management (Phase 03)
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { TaskTier, WorkflowState } from "../workflow.ts";
import { acquireAtomicLock } from "../../cli/safe-write.ts";
import { redactSecrets, UntrustedContentHandler } from "./security.ts";
import { matchPathGlob } from "../knowledge/glob.ts";
import { DEFAULT_HELIX_V2_ROUTING, type HeadlessProvider } from "./provider.ts";
import type {
  ExecutionEvent,
  ExecutionEventType,
  ExecutionStateManager,
  ExecutionStateSnapshot,
} from "./types.ts";

export type StateManagerOptions = {
  storageDir?: string;
  persistImmediately?: boolean;
  onEvent?: (event: ExecutionEvent) => void;
};

export interface TeamTaskNode {
  readonly taskId: string;
  readonly title: string;
  readonly description: string;
  readonly dependsOn: readonly string[];
  readonly ownedPaths: readonly string[];
  status: "pending" | "awaiting_plan_approval" | "in_progress" | "completed" | "failed";
  assignedTeammate?: string;
  submittedPlanContract?: string;
  planApprovedByLead: boolean;
}

export type PeerMessageType = "plan" | "question" | "finding" | "status" | "answer" | "broadcast";
export interface TeamPeerMessage {
  readonly sender_agent: string;
  readonly target_agent: string;
  readonly message_type: PeerMessageType;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly sent_at: string;
}

export interface RootCauseProof {
  readonly hypothesis: string;
  readonly evidence: readonly string[];
  readonly falsifiedHypotheses: readonly string[];
}

export type HypothesisInvestigator = (input: {
  readonly hypothesis: string;
  readonly targetFiles: readonly string[];
  readonly competingFindings: readonly TeamPeerMessage[];
  readonly teammateId: string;
  readonly provider: HeadlessProvider;
  readonly modelId: string;
  readonly instructions: string;
  readonly readOnlyToolsOnly: true;
  readonly maxTurns: 8;
}) => Promise<{ readonly evidence: readonly string[]; readonly disproved?: boolean }>;

function validateTeamTask(value: unknown): TeamTaskNode {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new Error("Team task must be an object");
  const record = value as Record<string, unknown>;
  const required = [
    "taskId",
    "title",
    "description",
    "dependsOn",
    "ownedPaths",
    "status",
    "planApprovedByLead",
  ];
  const allowed = [...required, "assignedTeammate", "submittedPlanContract"];
  if (
    required.some((key) => !(key in record)) ||
    Object.keys(record).some((key) => !allowed.includes(key))
  )
    throw new Error("Team task has an invalid schema");
  if (
    typeof record.taskId !== "string" ||
    !/^[a-z0-9][a-z0-9._-]*$/i.test(record.taskId) ||
    typeof record.title !== "string" ||
    typeof record.description !== "string"
  )
    throw new Error("Team task identity fields are invalid");
  if (
    !Array.isArray(record.dependsOn) ||
    record.dependsOn.some((item: unknown) => typeof item !== "string") ||
    !Array.isArray(record.ownedPaths) ||
    record.ownedPaths.length === 0 ||
    record.ownedPaths.some(
      (item: unknown) =>
        typeof item !== "string" ||
        !item.trim() ||
        path.isAbsolute(item) ||
        item.replace(/\\/g, "/").split("/").includes(".."),
    )
  )
    throw new Error(`Task '${record.taskId}' requires safe explicit ownedPaths and dependency ids`);
  const statuses = ["pending", "awaiting_plan_approval", "in_progress", "completed", "failed"];
  if (
    !statuses.includes(String(record.status)) ||
    typeof record.planApprovedByLead !== "boolean" ||
    (record.assignedTeammate !== undefined &&
      (typeof record.assignedTeammate !== "string" ||
        !/^[a-z0-9][a-z0-9._-]*$/i.test(record.assignedTeammate))) ||
    (record.submittedPlanContract !== undefined && typeof record.submittedPlanContract !== "string")
  )
    throw new Error(`Task '${record.taskId}' has invalid runtime fields`);
  return value as TeamTaskNode;
}

export class HelixTeamRuntime {
  readonly teamDir: string;
  private readonly teamId: string;
  private readonly workspaceRoot: string;
  private readonly leadId: string;
  private readonly maxTeammates: number;
  private readonly onStatus?: (event: {
    taskId: string;
    from: TeamTaskNode["status"];
    to: TeamTaskNode["status"];
    teammateId?: string;
  }) => void;

  constructor(options: {
    workspaceRoot?: string;
    teamId: string;
    leadId?: string;
    maxTeammates?: number;
    tasks?: readonly TeamTaskNode[];
    onStatus?: (event: {
      taskId: string;
      from: TeamTaskNode["status"];
      to: TeamTaskNode["status"];
      teammateId?: string;
    }) => void;
  }) {
    if (!/^[a-z0-9][a-z0-9._-]*$/i.test(options.teamId)) throw new Error("Invalid team id");
    this.teamId = options.teamId;
    this.workspaceRoot = path.resolve(options.workspaceRoot ?? process.cwd());
    this.leadId = options.leadId ?? "lead";
    this.maxTeammates = Math.min(4, Math.max(1, options.maxTeammates ?? 4));
    this.onStatus = options.onStatus;
    this.teamDir = path.resolve(this.workspaceRoot, ".helix/runtime/teams", this.teamId);
    fs.mkdirSync(this.teamDir, { recursive: true });
    const rootReal = fs.realpathSync(this.workspaceRoot);
    const teamReal = fs.realpathSync(this.teamDir);
    const relative = path.relative(rootReal, teamReal);
    if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative))
      throw new Error("Team runtime directory escapes the workspace root");
    const tasksPath = path.join(this.teamDir, "tasks.json");
    if (!fs.existsSync(tasksPath))
      this.writeTasks({ tasks: options.tasks ? [...options.tasks] : [] });
    else if (options.tasks?.length) this.addTasks(options.tasks);
  }

  private lockPath(): string {
    return path.join(this.teamDir, ".team.lock");
  }

  private withLock<T>(operation: () => T): T {
    const release = acquireAtomicLock(this.lockPath());
    try {
      return operation();
    } finally {
      release();
    }
  }

  private readTasks(): TeamTaskNode[] {
    const raw: unknown = JSON.parse(fs.readFileSync(path.join(this.teamDir, "tasks.json"), "utf8"));
    if (
      raw === null ||
      typeof raw !== "object" ||
      Array.isArray(raw) ||
      !Array.isArray((raw as Record<string, unknown>).tasks)
    ) {
      throw new Error("Team tasks.json has an invalid schema");
    }
    const tasks = (raw as { tasks: unknown[] }).tasks.map(validateTeamTask);
    this.assertAcyclic(tasks);
    return tasks;
  }

  private writeTasks(value: { tasks: readonly TeamTaskNode[] }): void {
    const tasks = value.tasks.map(validateTeamTask);
    const target = path.join(this.teamDir, "tasks.json");
    const temporary = `${target}.${randomUUID()}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify({ tasks }, null, 2) + "\n", {
      encoding: "utf8",
      mode: 0o600,
    });
    fs.renameSync(temporary, target);
  }

  snapshot(): readonly TeamTaskNode[] {
    return this.readTasks().map((task) => ({ ...task }));
  }

  addTasks(nodes: readonly TeamTaskNode[]): void {
    this.withLock(() => {
      const tasks = this.readTasks();
      const ids = new Set(tasks.map((task) => task.taskId));
      for (const task of nodes) {
        if (!/^[a-z0-9][a-z0-9._-]*$/i.test(task.taskId) || ids.has(task.taskId))
          throw new Error(`Invalid or duplicate team task id: ${task.taskId}`);
        if (
          !task.ownedPaths.length ||
          task.ownedPaths.some(
            (glob) =>
              !glob.trim() ||
              path.isAbsolute(glob) ||
              glob.replace(/\\/g, "/").split("/").includes(".."),
          )
        )
          throw new Error(`Task '${task.taskId}' requires safe explicit ownedPaths globs`);
        if (task.dependsOn.some((id) => !ids.has(id) && !nodes.some((node) => node.taskId === id)))
          throw new Error(`Task '${task.taskId}' has an unknown dependency`);
        ids.add(task.taskId);
      }
      const all = [...tasks, ...nodes];
      this.assertAcyclic(all);
      this.writeTasks({ tasks: all });
    });
  }

  private assertAcyclic(tasks: readonly TeamTaskNode[]): void {
    const byId = new Map(tasks.map((task) => [task.taskId, task]));
    const visiting = new Set<string>();
    const visited = new Set<string>();
    const visit = (id: string): void => {
      if (visiting.has(id)) throw new Error("Team task dependencies contain a cycle");
      if (visited.has(id)) return;
      visiting.add(id);
      for (const dependency of byId.get(id)?.dependsOn ?? []) visit(dependency);
      visiting.delete(id);
      visited.add(id);
    };
    for (const task of tasks) visit(task.taskId);
  }

  claimTask(taskId: string, teammateId: string): TeamTaskNode {
    return this.withLock(() => {
      const tasks = this.readTasks();
      const target = tasks.find((task) => task.taskId === taskId);
      if (!target || (target.status !== "pending" && target.status !== "failed"))
        throw new Error(`Task '${taskId}' is not claimable`);
      const previousStatus = target.status;
      if (
        target.dependsOn.some(
          (dependency) => tasks.find((task) => task.taskId === dependency)?.status !== "completed",
        )
      ) {
        throw new Error(`Task '${taskId}' is blocked by an uncompleted dependency`);
      }
      const active = tasks.filter(
        (task) => task.status === "in_progress" || task.status === "awaiting_plan_approval",
      );
      const conflict = active.find(
        (task) =>
          task.taskId !== taskId &&
          task.ownedPaths.some((left) =>
            target.ownedPaths.some((right) => globPatternsOverlap(left, right)),
          ),
      );
      if (conflict)
        throw new Error(`Task '${taskId}' overlaps active task '${conflict.taskId}' ownedPaths`);
      const teammates = new Set(
        tasks.map((task) => task.assignedTeammate).filter((id): id is string => Boolean(id)),
      );
      if (!teammates.has(teammateId) && teammates.size >= this.maxTeammates)
        throw new Error(`Team size limit is ${this.maxTeammates} teammates`);
      target.status = "awaiting_plan_approval";
      target.assignedTeammate = teammateId;
      target.planApprovedByLead = false;
      target.submittedPlanContract = undefined;
      this.writeTasks({ tasks });
      this.emitStatus({ taskId, from: previousStatus, to: target.status, teammateId });
      return { ...target };
    });
  }

  submitPlan(teammateId: string, taskId: string, contract: string): TeamTaskNode {
    return this.withLock(() => {
      const tasks = this.readTasks();
      const task = tasks.find(
        (entry) =>
          entry.taskId === taskId &&
          entry.assignedTeammate === teammateId &&
          entry.status === "awaiting_plan_approval",
      );
      if (!task) throw new Error("No task is awaiting this teammate's plan");
      task.submittedPlanContract = sanitizePeerText(contract).slice(0, 8000);
      this.writeTasks({ tasks });
      return { ...task };
    });
  }

  approveTeammatePlan(
    actorId: string,
    teammateId: string,
    taskId: string,
    approved: boolean,
    feedback?: string,
  ): TeamTaskNode {
    if (actorId !== this.leadId) throw new Error("Only the lead agent may approve a teammate plan");
    return this.withLock(() => {
      const tasks = this.readTasks();
      const task = tasks.find(
        (entry) =>
          entry.taskId === taskId &&
          entry.assignedTeammate === teammateId &&
          entry.status === "awaiting_plan_approval",
      );
      if (!task || !task.submittedPlanContract)
        throw new Error("Teammate must submit a plan before approval");
      let transition: { from: TeamTaskNode["status"]; to: TeamTaskNode["status"] } | undefined;
      if (approved) {
        const previousStatus = task.status;
        task.planApprovedByLead = true;
        task.status = "in_progress";
        transition = { from: previousStatus, to: task.status };
      } else if (feedback) {
        task.submittedPlanContract = `${task.submittedPlanContract}\nLead feedback: ${sanitizePeerText(feedback).slice(0, 2000)}`;
      }
      this.writeTasks({ tasks });
      if (transition) this.emitStatus({ taskId, ...transition, teammateId });
      return { ...task };
    });
  }

  isPlanApproved(teammateId: string): boolean {
    return this.readTasks().some(
      (task) =>
        task.assignedTeammate === teammateId &&
        task.status === "in_progress" &&
        task.planApprovedByLead,
    );
  }

  assertWriteAllowed(teammateId: string, filePath: string): void {
    this.withLock(() => {
      const tasks = this.readTasks();
      const own = tasks.filter(
        (task) =>
          task.assignedTeammate === teammateId &&
          task.status === "in_progress" &&
          task.planApprovedByLead,
      );
      const relative = path
        .relative(this.workspaceRoot, path.resolve(this.workspaceRoot, filePath))
        .replace(/\\/g, "/");
      if (!own.some((task) => task.ownedPaths.some((glob) => matchPathGlob(relative, glob))))
        throw new Error(`WriteGate blocked '${filePath}': approved plan does not own this path`);
      const conflict = tasks.find(
        (task) =>
          task.assignedTeammate !== teammateId &&
          (task.status === "in_progress" || task.status === "awaiting_plan_approval") &&
          task.ownedPaths.some((glob) => globMatchesPath(glob, relative)),
      );
      if (conflict)
        throw new Error(
          `WriteGate blocked '${filePath}': overlapping task '${conflict.taskId}' is active`,
        );
    });
  }

  assertScopeAllowed(teammateId: string, scope: string): void {
    this.withLock(() => {
      const tasks = this.readTasks();
      const own = tasks.filter(
        (task) =>
          task.assignedTeammate === teammateId &&
          task.status === "in_progress" &&
          task.planApprovedByLead,
      );
      if (!own.some((task) => task.ownedPaths.some((glob) => globPatternsOverlap(glob, scope))))
        throw new Error(
          `WriteGate blocked scope '${scope}': teammate plan is not approved for these paths`,
        );
      const conflict = tasks.find(
        (task) =>
          task.assignedTeammate !== teammateId &&
          (task.status === "in_progress" || task.status === "awaiting_plan_approval") &&
          task.ownedPaths.some((left) => globPatternsOverlap(left, scope)),
      );
      if (conflict)
        throw new Error(
          `WriteGate blocked scope '${scope}': overlaps active task '${conflict.taskId}'`,
        );
    });
  }

  completeTask(taskId: string, teammateId: string, succeeded = true): void {
    this.withLock(() => {
      const tasks = this.readTasks();
      const task = tasks.find(
        (entry) => entry.taskId === taskId && entry.assignedTeammate === teammateId,
      );
      if (!task || task.status !== "in_progress")
        throw new Error("Only the assigned teammate can complete an active task");
      const previousStatus = task.status;
      task.status = succeeded ? "completed" : "failed";
      this.writeTasks({ tasks });
      this.emitStatus({ taskId, from: previousStatus, to: task.status, teammateId });
    });
  }

  private emitStatus(event: {
    taskId: string;
    from: TeamTaskNode["status"];
    to: TeamTaskNode["status"];
    teammateId?: string;
  }): void {
    try {
      this.onStatus?.(event);
    } catch {
      /* UI observers must not disrupt team state. */
    }
  }

  sendPeerMessage(message: TeamPeerMessage): void {
    const clean = validatePeerMessage(message);
    this.withLock(() => {
      const inboxDir = path.join(this.teamDir, "inboxes");
      fs.mkdirSync(inboxDir, { recursive: true });
      const target = path.join(inboxDir, `${clean.target_agent}.json`);
      const prior: unknown = fs.existsSync(target)
        ? JSON.parse(fs.readFileSync(target, "utf8"))
        : [];
      if (!Array.isArray(prior)) throw new Error(`Peer inbox '${clean.target_agent}' is invalid`);
      const temporary = `${target}.${randomUUID()}.tmp`;
      fs.writeFileSync(temporary, JSON.stringify([...prior, clean], null, 2) + "\n", {
        encoding: "utf8",
        mode: 0o600,
      });
      fs.renameSync(temporary, target);
    });
  }

  send_peer_message(
    senderAgent: string,
    input: {
      readonly target_agent: string;
      readonly message_type: PeerMessageType;
      readonly payload: Readonly<Record<string, unknown>>;
    },
  ): void {
    this.sendPeerMessage({
      sender_agent: senderAgent,
      ...input,
      sent_at: new Date().toISOString(),
    });
  }

  appendTeammateStream(teammateId: string, text: string): void {
    if (!/^[a-z0-9][a-z0-9._-]*$/i.test(teammateId)) throw new Error("Invalid teammate id");
    const safe = sanitizePeerText(text).slice(0, 4000);
    this.withLock(() => {
      const directory = path.join(this.teamDir, "streams");
      fs.mkdirSync(directory, { recursive: true });
      fs.appendFileSync(path.join(directory, `${teammateId}.log`), safe + "\n", {
        encoding: "utf8",
        mode: 0o600,
      });
    });
  }

  broadcastTeam(
    sender: string,
    messageType: PeerMessageType,
    payload: Readonly<Record<string, unknown>>,
  ): void {
    const targets = new Set([
      this.leadId,
      ...this.readTasks().flatMap((task) => (task.assignedTeammate ? [task.assignedTeammate] : [])),
    ]);
    for (const target of targets)
      if (target !== sender)
        this.sendPeerMessage({
          sender_agent: sender,
          target_agent: target,
          message_type: messageType,
          payload,
          sent_at: new Date().toISOString(),
        });
  }

  broadcast_team(
    sender: string,
    input: {
      readonly message_type: PeerMessageType;
      readonly payload: Readonly<Record<string, unknown>>;
    },
  ): void {
    const { message_type: messageType, payload } = input;
    this.broadcastTeam(sender, messageType, payload);
  }

  approve_teammate_plan(
    actorId: string,
    input: {
      readonly teammate_id: string;
      readonly task_id: string;
      readonly approved: boolean;
      readonly feedback?: string;
    },
  ): TeamTaskNode {
    return this.approveTeammatePlan(
      actorId,
      input.teammate_id,
      input.task_id,
      input.approved,
      input.feedback,
    );
  }

  isLead(agentId: string): boolean {
    return agentId === this.leadId;
  }

  approvedOwnedPaths(teammateId: string): readonly string[] {
    return this.readTasks()
      .filter(
        (task) =>
          task.assignedTeammate === teammateId &&
          task.status === "in_progress" &&
          task.planApprovedByLead,
      )
      .flatMap((task) => task.ownedPaths);
  }

  readInbox(agentId: string): readonly TeamPeerMessage[] {
    if (!/^[a-z0-9][a-z0-9._-]*$/i.test(agentId)) throw new Error("Invalid agent id");
    const file = path.join(this.teamDir, "inboxes", `${agentId}.json`);
    if (!fs.existsSync(file)) return [];
    const value: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!Array.isArray(value)) throw new Error(`Peer inbox '${agentId}' is invalid`);
    return value.map((message) => validatePeerMessage(message));
  }

  async spawnHypothesisTeam(options: {
    readonly bugDescription: string;
    readonly candidateHypotheses: readonly string[];
    readonly targetFiles: readonly string[];
    readonly investigate: HypothesisInvestigator;
    readonly arbitrate?: (findings: readonly TeamPeerMessage[]) => Promise<RootCauseProof>;
  }): Promise<RootCauseProof> {
    const hypotheses = options.candidateHypotheses.slice(0, 3);
    if (hypotheses.length < 2)
      throw new Error("Hypothesis team requires two or three candidate hypotheses");
    const investigators = hypotheses.map((_, index) => `investigator-${index + 1}`);
    const routes = [
      DEFAULT_HELIX_V2_ROUTING.MASTER_ORCHESTRATOR,
      DEFAULT_HELIX_V2_ROUTING.ADVERSARIAL_AUDITOR,
      DEFAULT_HELIX_V2_ROUTING.HYPOTHESIS_DEBATE_PEER,
    ];
    const initial = await Promise.all(
      hypotheses.map(async (hypothesis, index) => {
        const teammateId = investigators[index];
        if (!teammateId) throw new Error("Hypothesis investigator assignment failed");
        const route = routes[index];
        if (!route) throw new Error("Hypothesis investigator route is unavailable");
        const result = await options.investigate({
          hypothesis,
          targetFiles: options.targetFiles,
          competingFindings: [],
          teammateId,
          provider: route.harness,
          modelId: route.modelId,
          instructions: hypothesisInstruction(options.bugDescription, hypothesis),
          readOnlyToolsOnly: true,
          maxTurns: 8,
        });
        const payload = {
          bugDescription: sanitizePeerText(options.bugDescription),
          hypothesis: sanitizePeerText(hypothesis),
          evidence: result.evidence.map(sanitizePeerText),
          disproved: result.disproved === true,
        };
        for (const peer of investigators) {
          if (peer !== teammateId)
            this.sendPeerMessage({
              sender_agent: teammateId,
              target_agent: peer,
              message_type: "finding",
              payload,
              sent_at: new Date().toISOString(),
            });
        }
        return {
          sender_agent: teammateId,
          target_agent: this.leadId,
          message_type: "finding" as const,
          payload,
          sent_at: new Date().toISOString(),
        };
      }),
    );
    const findings = await Promise.all(
      hypotheses.map(async (hypothesis, index) => {
        const teammateId = investigators[index];
        const route = routes[index];
        if (!teammateId || !route) throw new Error("Hypothesis investigator assignment failed");
        const competingFindings = this.readInbox(teammateId).filter(
          (message) => message.message_type === "finding",
        );
        const result = await options.investigate({
          hypothesis,
          targetFiles: options.targetFiles,
          competingFindings,
          teammateId,
          provider: route.harness,
          modelId: route.modelId,
          instructions: hypothesisInstruction(options.bugDescription, hypothesis),
          readOnlyToolsOnly: true,
          maxTurns: 8,
        });
        const payload = {
          bugDescription: sanitizePeerText(options.bugDescription),
          hypothesis: sanitizePeerText(hypothesis),
          evidence: result.evidence.map(sanitizePeerText),
          disproved: result.disproved === true,
        };
        return {
          sender_agent: teammateId,
          target_agent: this.leadId,
          message_type: "finding" as const,
          payload,
          sent_at: new Date().toISOString(),
        };
      }),
    );
    void initial;
    const proof = options.arbitrate
      ? await options.arbitrate(findings)
      : defaultArbitrate(findings);
    if (!proof.evidence.length || proof.evidence.some((item) => !/:[0-9]+(?:\b|$)/.test(item)))
      throw new Error("Root cause proof requires reproducible file:line evidence");
    return proof;
  }
}

function sanitizePeerText(text: string): string {
  const canary = process.env.ADMIN_TEST_KEY;
  const redacted = redactSecrets(text).text;
  const canarySafe = canary
    ? redacted.split(canary).join("[REDACTED_CANARY]")
    : redacted.replace(/\bADMIN_TEST_KEY\s*[:=]\s*[^\s,;]+/g, "ADMIN_TEST_KEY=[REDACTED_CANARY]");
  return UntrustedContentHandler.detectPromptInjection(canarySafe).neutralizedText;
}

function validatePeerMessage(value: unknown): TeamPeerMessage {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new Error("Peer message must be an object");
  const record = value as Record<string, unknown>;
  const keys = ["sender_agent", "target_agent", "message_type", "payload", "sent_at"];
  if (
    Object.keys(record).length !== keys.length ||
    Object.keys(record).some((key) => !keys.includes(key))
  )
    throw new Error("Peer message has unsupported fields");
  if (
    typeof record.sender_agent !== "string" ||
    !/^[a-z0-9][a-z0-9._-]*$/i.test(record.sender_agent) ||
    typeof record.target_agent !== "string" ||
    !/^[a-z0-9][a-z0-9._-]*$/i.test(record.target_agent)
  )
    throw new Error("Peer message agent ids are invalid");
  const messageTypes: readonly unknown[] = [
    "plan",
    "question",
    "finding",
    "status",
    "answer",
    "broadcast",
  ];
  if (
    !messageTypes.includes(record.message_type) ||
    typeof record.sent_at !== "string" ||
    Number.isNaN(Date.parse(record.sent_at)) ||
    record.payload === null ||
    typeof record.payload !== "object" ||
    Array.isArray(record.payload)
  )
    throw new Error("Peer message envelope is invalid");
  const sanitize = (entry: unknown): unknown => {
    if (typeof entry === "string") return sanitizePeerText(entry);
    if (Array.isArray(entry)) return entry.map(sanitize);
    if (entry !== null && typeof entry === "object") {
      if (
        Object.getPrototypeOf(entry) !== Object.prototype &&
        Object.getPrototypeOf(entry) !== null
      )
        throw new Error("Peer message payload must contain plain JSON objects");
      const pairs = Object.entries(entry).map(
        ([key, item]) => [sanitizePeerText(key), sanitize(item)] as const,
      );
      if (new Set(pairs.map(([key]) => key)).size !== pairs.length)
        throw new Error("Peer message payload keys collide after sanitization");
      return Object.fromEntries(pairs);
    }
    if (
      entry === null ||
      typeof entry === "boolean" ||
      (typeof entry === "number" && Number.isFinite(entry))
    )
      return entry;
    throw new Error("Peer message payload must contain only JSON data");
  };
  const payload = sanitize(record.payload);
  if (
    payload === null ||
    typeof payload !== "object" ||
    Array.isArray(payload) ||
    JSON.stringify(payload).length > 20_000
  )
    throw new Error("Peer message payload must be an object below the 20 KB limit");
  return {
    sender_agent: record.sender_agent,
    target_agent: record.target_agent,
    message_type: record.message_type as PeerMessageType,
    payload: payload as Record<string, unknown>,
    sent_at: record.sent_at,
  };
}

function globMatchesPath(glob: string, pathValue: string): boolean {
  return matchPathGlob(pathValue, glob);
}

/** Decide glob intersection using a product of small wildcard NFAs. */
export function globPatternsOverlap(left: string, right: string): boolean {
  const tokenize = (pattern: string): string[] => {
    const tokens: string[] = [];
    for (let i = 0; i < pattern.length; i++) {
      if (pattern[i] === "*" && pattern[i + 1] === "*") {
        tokens.push("**");
        i++;
      } else tokens.push(pattern[i] ?? "");
    }
    return tokens;
  };
  const a = tokenize(left.replace(/\\/g, "/"));
  const b = tokenize(right.replace(/\\/g, "/"));
  const alphabet = new Set([
    "/",
    "x",
    ...a.filter((token) => token !== "*" && token !== "**" && token !== "?"),
    ...b.filter((token) => token !== "*" && token !== "**" && token !== "?"),
  ]);
  const closure = (tokens: readonly string[], initial: readonly number[]): number[] => {
    const result = new Set(initial);
    const stack = [...initial];
    while (stack.length) {
      const position = stack.pop();
      if (position === undefined || (tokens[position] !== "*" && tokens[position] !== "**"))
        continue;
      if (!result.has(position + 1)) {
        result.add(position + 1);
        stack.push(position + 1);
      }
    }
    return [...result].sort((x, y) => x - y);
  };
  const advance = (
    tokens: readonly string[],
    states: readonly number[],
    char: string,
  ): number[] => {
    const next = new Set<number>();
    for (const position of states) {
      const token = tokens[position];
      if (token === "**") next.add(position);
      else if (token === "*" && char !== "/") next.add(position);
      else if (token === "?" && char !== "/") next.add(position + 1);
      else if (token === char) next.add(position + 1);
    }
    return closure(tokens, [...next]);
  };
  const startA = closure(a, [0]);
  const startB = closure(b, [0]);
  const queue: Array<{ a: number[]; b: number[] }> = [{ a: startA, b: startB }];
  const seen = new Set<string>();
  while (queue.length) {
    const state = queue.shift();
    if (!state) continue;
    if (state.a.includes(a.length) && state.b.includes(b.length)) return true;
    const key = `${state.a.join(",")}|${state.b.join(",")}`;
    if (seen.has(key)) continue;
    seen.add(key);
    for (const char of alphabet) {
      const nextA = advance(a, state.a, char);
      const nextB = advance(b, state.b, char);
      if (nextA.length && nextB.length) queue.push({ a: nextA, b: nextB });
    }
  }
  return false;
}

function defaultArbitrate(findings: readonly TeamPeerMessage[]): RootCauseProof {
  const surviving = findings.filter(
    (finding) =>
      finding.payload.disproved !== true &&
      Array.isArray(finding.payload.evidence) &&
      finding.payload.evidence.length > 0 &&
      finding.payload.evidence.every((item) => typeof item === "string"),
  );
  if (surviving.length !== 1)
    throw new Error(
      "Hypothesis arbitration needs exactly one surviving evidence-backed hypothesis",
    );
  const winner = surviving[0];
  if (!winner) throw new Error("Hypothesis arbitration did not produce a survivor");
  const evidence = winner.payload.evidence;
  if (!Array.isArray(evidence) || evidence.some((item) => typeof item !== "string"))
    throw new Error("Hypothesis evidence must be a list of citations");
  return {
    hypothesis: String(winner.payload.hypothesis),
    evidence,
    falsifiedHypotheses: findings
      .filter((finding) => finding.payload.disproved === true)
      .map((finding) => String(finding.payload.hypothesis)),
  };
}

function hypothesisInstruction(bugDescription: string, hypothesis: string): string {
  return `Read-only investigation of: ${sanitizePeerText(bugDescription)}. Try to prove the assigned hypothesis: ${sanitizePeerText(hypothesis)}. Read peer findings from your inbox and actively falsify competing hypotheses. Cite deterministic evidence with file:line plus AST or test evidence. Do not modify files.`;
}

export class FileExecutionStateManager implements ExecutionStateManager {
  private readonly storageDir: string;
  private readonly persistImmediately: boolean;
  private readonly onEvent?: (event: ExecutionEvent) => void;
  private snapshot: ExecutionStateSnapshot;

  constructor(
    taskId: string,
    initialTier: TaskTier = "trivial",
    options: StateManagerOptions = {},
  ) {
    this.storageDir = options.storageDir
      ? path.resolve(options.storageDir)
      : path.resolve(".helix-work");
    this.persistImmediately = options.persistImmediately ?? true;
    this.onEvent = options.onEvent;

    this.snapshot = {
      taskId,
      workflowState: "INIT",
      tier: initialTier,
      retryCount: 0,
      events: [],
      updatedAt: new Date().toISOString(),
    };
  }

  getSnapshot(): ExecutionStateSnapshot {
    return {
      ...this.snapshot,
      events: [...this.snapshot.events],
    };
  }

  setTier(tier: TaskTier): void {
    this.snapshot.tier = tier;
    this.snapshot.updatedAt = new Date().toISOString();
  }

  setWorktreePath(worktreePath?: string): void {
    this.snapshot.worktreePath = worktreePath;
    this.snapshot.updatedAt = new Date().toISOString();
  }

  setRetryCount(retryCount: number): void {
    this.snapshot.retryCount = retryCount;
    this.snapshot.updatedAt = new Date().toISOString();
  }

  async recordEvent(event: Omit<ExecutionEvent, "eventId" | "timestamp">): Promise<ExecutionEvent> {
    const fullEvent: ExecutionEvent = {
      eventId: `evt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      taskId: event.taskId,
      timestamp: new Date().toISOString(),
      type: event.type as ExecutionEventType,
      workflowState: event.workflowState as WorkflowState,
      payload: event.payload || {},
    };

    this.snapshot.workflowState = fullEvent.workflowState;
    this.snapshot.updatedAt = fullEvent.timestamp;
    this.snapshot.events.push(fullEvent);

    if (fullEvent.payload.worktreePath && typeof fullEvent.payload.worktreePath === "string") {
      this.snapshot.worktreePath = fullEvent.payload.worktreePath;
    }
    if (fullEvent.payload.tier && typeof fullEvent.payload.tier === "string") {
      this.snapshot.tier = fullEvent.payload.tier as TaskTier;
    }
    if (typeof fullEvent.payload.retryCount === "number") {
      this.snapshot.retryCount = fullEvent.payload.retryCount;
    }
    if (typeof fullEvent.payload.currentStepId === "string") {
      this.snapshot.currentStepId = fullEvent.payload.currentStepId;
    }

    if (this.onEvent) {
      try {
        this.onEvent(fullEvent);
      } catch {
        // Observer exceptions must not break state tracking
      }
    }

    if (this.persistImmediately) {
      await this.persist(this.snapshot.taskId);
    }

    return fullEvent;
  }

  private getStateFilePath(taskId: string): string {
    return path.join(this.storageDir, `state-${taskId}.json`);
  }

  private getDefaultStateFilePath(): string {
    return path.join(this.storageDir, "state.json");
  }

  async persist(taskId: string): Promise<void> {
    try {
      if (!fs.existsSync(this.storageDir)) {
        fs.mkdirSync(this.storageDir, { recursive: true });
      }

      const content = JSON.stringify(this.snapshot, null, 2);
      const targetFile = this.getStateFilePath(taskId);
      const defaultFile = this.getDefaultStateFilePath();
      const tmpFile = `${targetFile}.tmp.${Date.now()}`;

      fs.writeFileSync(tmpFile, content, "utf8");
      fs.renameSync(tmpFile, targetFile);

      // Also maintain symlink or copy to default state.json for easy inspection
      try {
        fs.writeFileSync(defaultFile, content, "utf8");
      } catch {
        // Non-critical mirror write failure ignored
      }
    } catch (err) {
      // In constrained environments where disk is unwritable, keep in-memory
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[helix state] Failed to persist state for ${taskId}: ${message}\n`);
    }
  }

  async load(taskId: string): Promise<ExecutionStateSnapshot | null> {
    const candidatePaths = [this.getStateFilePath(taskId), this.getDefaultStateFilePath()];

    for (const p of candidatePaths) {
      if (fs.existsSync(p)) {
        try {
          const raw = fs.readFileSync(p, "utf8");
          const parsed = JSON.parse(raw) as ExecutionStateSnapshot;
          if (parsed && parsed.taskId === taskId) {
            this.snapshot = parsed;
            return this.getSnapshot();
          }
        } catch {
          // If corrupted or unreadable, continue
        }
      }
    }

    return null;
  }

  async cleanup(taskId: string): Promise<void> {
    const pathsToClean = [this.getStateFilePath(taskId), this.getDefaultStateFilePath()];

    for (const p of pathsToClean) {
      if (fs.existsSync(p)) {
        try {
          fs.unlinkSync(p);
        } catch {
          // Ignore cleanup errors
        }
      }
    }
  }
}
