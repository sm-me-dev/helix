import type { ExecutionEventLike } from "./contracts.ts";
import type { SessionEventInput } from "./contracts.ts";

/** Translate existing CLI/engine lifecycle events into the shared UI vocabulary. */
export function createExecutionEventMapper(): (
  event: ExecutionEventLike,
) => SessionEventInput | undefined {
  const activeCalls = new Map<string, string>();
  return (event) => {
    const taskId = event.taskId;
    if (event.type === "agent_launched") {
      const callId = taskId;
      activeCalls.set(taskId, callId);
      return {
        type: "tool.call.start",
        call_id: callId,
        tool_name: String(event.payload.role ?? "agent"),
        partial_args: "{}",
      };
    }
    if (event.type === "agent_completed") {
      const callId = activeCalls.get(taskId) ?? taskId;
      activeCalls.delete(taskId);
      return {
        type: "tool.call.result",
        call_id: callId,
        status: Number(event.payload.exitCode ?? 1) === 0 ? "succeeded" : "failed",
        stdout: String(event.payload.stdout ?? ""),
        stderr: String(event.payload.stderr ?? ""),
        duration_ms: Number(event.payload.durationMs ?? 0),
      };
    }
    if (
      [
        "task_started",
        "task_completed",
        "task_failed",
        "gate_started",
        "gate_passed",
        "gate_failed",
      ].includes(event.type)
    ) {
      const status =
        event.type === "task_completed" || event.type === "gate_passed"
          ? "done"
          : event.type === "task_failed" || event.type === "gate_failed"
            ? "blocked"
            : "running";
      return {
        type: "dag.state.updated",
        spec_id: taskId,
        nodes: [
          {
            id: taskId,
            label: taskId,
            stage: event.type.startsWith("gate_") ? "Verification" : "Implementation",
            status,
          },
        ],
        edges: [],
      };
    }
    return undefined;
  };
}
