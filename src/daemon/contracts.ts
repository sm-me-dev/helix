export type SessionEventBase = { id: number; timestamp: string };

export type SessionEvent = SessionEventBase &
  (
    | {
        type: "message.delta";
        role: "assistant" | "user";
        delta_text: string;
        reasoning_delta?: string;
      }
    | { type: "tool.call.start"; call_id: string; tool_name: string; partial_args: string }
    | {
        type: "tool.call.result";
        call_id: string;
        status: "succeeded" | "failed" | "cancelled";
        stdout: string;
        stderr: string;
        diff_patch?: string;
        duration_ms: number;
      }
    | {
        type: "approval.required";
        gate_id: string;
        action_type: string;
        command_or_path: string;
        risk_level: "low" | "medium" | "high";
        options: string[];
      }
    | {
        type: "dag.state.updated";
        spec_id: string;
        nodes: Array<{ id: string; label: string; stage: string; status: string }>;
        edges: Array<{ source: string; target: string }>;
      }
    | {
        type: "telemetry.usage";
        prompt_tokens: number;
        completion_tokens: number;
        cache_read_tokens: number;
        cache_write_tokens: number;
        context_window_pct: number;
        latency_ms: number;
        cost_usd: number;
      }
  );

export type ApprovalRequest = {
  actionType: string;
  commandOrPath: string;
  riskLevel: "low" | "medium" | "high";
  options?: string[];
};

export type ApprovalDecision = {
  gateId: string;
  decision: "approve" | "reject" | "edit";
  editedValue?: string;
};

/** Runtime-to-view contract. UI clients receive events and submit decisions over REST. */
export type UICallback = {
  requestApproval(request: ApprovalRequest): Promise<ApprovalDecision>;
  emit(event: SessionEventInput): SessionEvent;
};

export type SessionEventInput = SessionEvent extends infer Event
  ? Event extends SessionEvent
    ? Omit<Event, "id" | "timestamp">
    : never
  : never;

export type SessionSnapshot = {
  id: string;
  createdAt: string;
  status: "idle" | "running" | "waiting_approval" | "completed" | "failed" | "cancelled";
  promptCount: number;
};

export type SessionRuntime = {
  prompt(
    sessionId: string,
    prompt: string,
    callback: UICallback,
    signal: AbortSignal,
  ): Promise<void>;
  cancel?(sessionId: string): Promise<void> | void;
  rollback?(sessionId: string, taskId: string): Promise<{ rolledBack: boolean; message: string }>;
  providers?():
    | Promise<Array<{ id: string; model?: string; baseUrl?: string; configured?: boolean }>>
    | Array<{ id: string; model?: string; baseUrl?: string; configured?: boolean }>;
};

export type ExecutionEventLike = {
  taskId: string;
  type: string;
  payload: Record<string, unknown>;
};
