import assert from "node:assert/strict";
import test from "node:test";
import { projectTuiState } from "./model.ts";
import type { SessionEvent } from "../daemon/contracts.ts";

test("TUI projection streams messages and changes tool cards from running to complete", () => {
  const start: SessionEvent = {
    id: 3,
    timestamp: "t3",
    type: "tool.call.start",
    call_id: "c1",
    tool_name: "read_file",
    partial_args: '{"path":',
  };
  const running = projectTuiState([
    { id: 1, timestamp: "t1", type: "message.delta", role: "assistant", delta_text: "Inspect" },
    { id: 2, timestamp: "t2", type: "message.delta", role: "assistant", delta_text: "ing" },
    start,
  ]);
  assert.equal(running.messages[0]?.content, "Inspecting");
  assert.equal(running.toolCards[0]?.result, undefined);

  const completed = projectTuiState([
    start,
    {
      id: 4,
      timestamp: "t4",
      type: "tool.call.result",
      call_id: "c1",
      status: "succeeded",
      stdout: "file",
      stderr: "",
      duration_ms: 4,
    },
    {
      id: 5,
      timestamp: "t5",
      type: "tool.call.result",
      call_id: "c1",
      status: "succeeded",
      stdout: "",
      stderr: "",
      diff_patch: "+new line",
      duration_ms: 4,
    },
  ]);
  assert.equal(completed.toolCards[0]?.result?.status, "succeeded");
  assert.equal(completed.toolCards[0]?.result?.stdout, "file");
  assert.equal(completed.toolCards[0]?.result?.diff_patch, "+new line");
});

test("TUI projection exposes the newest approval and DAG state", () => {
  const projected = projectTuiState([
    {
      id: 1,
      timestamp: "t1",
      type: "approval.required",
      gate_id: "g1",
      action_type: "shell",
      command_or_path: "npm test",
      risk_level: "medium",
      options: ["approve", "reject"],
    },
    {
      id: 2,
      timestamp: "t2",
      type: "dag.state.updated",
      spec_id: "s1",
      nodes: [{ id: "n1", label: "Build", stage: "Implementation", status: "running" }],
      edges: [],
    },
  ]);
  assert.equal(projected.pendingApproval?.gate_id, "g1");
  assert.equal(projected.dag?.nodes[0]?.status, "running");
});
