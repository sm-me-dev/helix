import type { SessionEvent } from "../daemon/contracts.ts";

export type TuiMessage = { role: "assistant" | "user"; content: string; id: number };
export type TuiToolCard = {
  start: Extract<SessionEvent, { type: "tool.call.start" }>;
  result?: Extract<SessionEvent, { type: "tool.call.result" }>;
};

export function projectTuiState(events: readonly SessionEvent[]): {
  messages: TuiMessage[];
  toolCards: TuiToolCard[];
  pendingApproval?: Extract<SessionEvent, { type: "approval.required" }>;
  dag?: Extract<SessionEvent, { type: "dag.state.updated" }>;
  usage?: Extract<SessionEvent, { type: "telemetry.usage" }>;
} {
  const messages: TuiMessage[] = [];
  const starts = new Map<string, TuiToolCard["start"]>();
  const results = new Map<string, TuiToolCard["result"]>();
  let pendingApproval: Extract<SessionEvent, { type: "approval.required" }> | undefined;
  let dag: Extract<SessionEvent, { type: "dag.state.updated" }> | undefined;
  let usage: Extract<SessionEvent, { type: "telemetry.usage" }> | undefined;

  for (const event of events) {
    if (event.type === "message.delta") {
      const previous = messages.at(-1);
      if (previous?.role === event.role) previous.content += event.delta_text;
      else messages.push({ role: event.role, content: event.delta_text, id: event.id });
    } else if (event.type === "tool.call.start") starts.set(event.call_id, event);
    else if (event.type === "tool.call.result") {
      const previous = results.get(event.call_id);
      results.set(event.call_id, {
        ...previous,
        ...event,
        stdout: event.stdout || previous?.stdout || "",
        stderr: event.stderr || previous?.stderr || "",
        diff_patch: event.diff_patch ?? previous?.diff_patch,
      });
    } else if (event.type === "approval.required") pendingApproval = event;
    else if (event.type === "dag.state.updated") dag = event;
    else if (event.type === "telemetry.usage") usage = event;
  }

  return {
    messages,
    toolCards: [...starts.values()].map((start) => ({ start, result: results.get(start.call_id) })),
    pendingApproval,
    dag,
    usage,
  };
}
