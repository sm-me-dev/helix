import assert from "node:assert/strict";
import test from "node:test";
import { createExecutionEventMapper } from "./execution-events.ts";

test("CLI lifecycle events produce matching tool call and DAG event discriminators", () => {
  const map = createExecutionEventMapper();
  const start = map({
    taskId: "task-1",
    type: "agent_launched",
    payload: { sessionId: "task-1-run-1", role: "builder" },
  });
  const result = map({
    taskId: "task-1",
    type: "agent_completed",
    payload: { exitCode: 0, durationMs: 23 },
  });
  const dag = map({ taskId: "task-1", type: "task_completed", payload: {} });
  assert.equal(start?.type, "tool.call.start");
  assert.equal(result?.type, "tool.call.result");
  assert.equal(result?.type === "tool.call.result" ? result.call_id : "", "task-1");
  assert.equal(dag?.type, "dag.state.updated");
});
