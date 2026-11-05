import assert from "node:assert/strict";
import test from "node:test";
import { sanitizeConversationTrace, toWireMessages } from "./trace-sanitizer.ts";

test("trace sanitizer strips orphan tool results and closes interrupted calls before the next turn", () => {
  const messages = sanitizeConversationTrace([
    { role: "tool", toolCallId: "orphan", content: "unmatched" },
    {
      role: "assistant",
      content: "",
      toolCalls: [
        { id: "done", type: "function", function: { name: "read", arguments: "{}" } },
        { id: "cut", type: "function", function: { name: "write", arguments: "{}" } },
      ],
    },
    { role: "tool", toolCallId: "done", content: "file content" },
    { role: "user", content: "continue" },
  ]);
  assert.equal(
    messages.some((message) => message.toolCallId === "orphan"),
    false,
  );
  assert.deepEqual(
    messages.filter((message) => message.role === "tool").map((message) => message.toolCallId),
    ["done", "cut"],
  );
  assert.match(messages.find((message) => message.toolCallId === "cut")!.content, /interrupted/);
  assert.equal(messages.at(-1)?.role, "user");
});

test("wire conversion uses OpenAI tool field names after trace repair", () => {
  const wire = toWireMessages([
    {
      role: "assistant",
      content: "",
      toolCalls: [{ id: "t1", type: "function", function: { name: "x", arguments: "{}" } }],
    },
  ]);
  assert.deepEqual(wire[0]?.tool_calls, [
    { id: "t1", type: "function", function: { name: "x", arguments: "{}" } },
  ]);
  assert.equal(wire[1]?.tool_call_id, "t1");
});
