// Helix Execution State Management (Phase 03)
import fs from "node:fs";
import path from "node:path";
import type { TaskTier, WorkflowState } from "../workflow.ts";
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
      workflowState: "classified",
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
