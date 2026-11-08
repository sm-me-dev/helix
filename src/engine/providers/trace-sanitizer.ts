import type { LLMMessage } from "./llm-client.ts";

const INTERRUPTED_TOOL_RESULT =
  "Helix error: this tool call was interrupted before a result was recorded.";

/** Keep tool-call/result pairs valid before each provider request. */
export function sanitizeConversationTrace(messages: readonly LLMMessage[]): LLMMessage[] {
  const result: LLMMessage[] = [];
  const pending = new Map<string, string>();
  const appendInterrupted = () => {
    for (const [toolCallId, name] of pending) {
      result.push({ role: "tool", toolCallId, name, content: INTERRUPTED_TOOL_RESULT });
    }
    pending.clear();
  };

  for (const message of messages) {
    if (message.role === "tool") {
      if (!message.toolCallId || !pending.has(message.toolCallId)) continue;
      pending.delete(message.toolCallId);
      result.push({ ...message });
      continue;
    }
    if (pending.size > 0) appendInterrupted();
    result.push({
      ...message,
      toolCalls: message.toolCalls?.map((call) => ({ ...call, function: { ...call.function } })),
    });
    if (message.role === "assistant") {
      for (const call of message.toolCalls ?? []) {
        if (call.id) pending.set(call.id, call.function.name);
      }
    }
  }
  if (pending.size > 0) appendInterrupted();
  return result;
}

export function toWireMessages(messages: readonly LLMMessage[]): Array<Record<string, unknown>> {
  return sanitizeConversationTrace(messages).map((message) => ({
    role: message.role,
    content: message.content,
    ...(message.toolCallId ? { tool_call_id: message.toolCallId } : {}),
    ...(message.name ? { name: message.name } : {}),
    ...(message.toolCalls ? { tool_calls: message.toolCalls } : {}),
  }));
}
