import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import {
  AuiIf,
  AssistantRuntimeProvider,
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  useExternalStoreRuntime,
  type AppendMessage,
  type ThreadMessageLike,
} from "@assistant-ui/react";
import {
  Background,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  type Edge,
  type Node,
} from "@xyflow/react";
import dagre from "dagre";
import type { SessionEvent, SessionSnapshot } from "../../src/daemon/contracts.ts";

const ReactDiffViewer = lazy(() => import("react-diff-viewer-continued"));

type ChatMessage = { id: number; role: "assistant" | "user"; content: string; timestamp: string };
type ProviderInfo = { id: string; model?: string; baseUrl?: string; configured?: boolean };
type ProviderProfile = {
  name: string;
  provider: string;
  base_url?: string;
  model?: string;
  default_header_names: string[];
  has_api_key: boolean;
  is_default: boolean;
};
type ProviderForm = {
  name: string;
  provider: string;
  base_url: string;
  api_key: string;
  model: string;
  default_headers: string;
};
type Diagnostic = {
  stage: string;
  method: string;
  endpoint: string;
  status?: number;
  latencyMs: number;
  ok: boolean;
  rawBody?: string;
  remediationHint?: string;
  error?: string;
};
type ProviderCheck = {
  ok: boolean;
  models: Array<{ id: string }>;
  diagnostics: Diagnostic[];
  remediationHint?: string;
};
type AppSession = SessionSnapshot & { label: string };

const EVENT_TYPES = [
  "message.delta",
  "tool.call.start",
  "tool.call.result",
  "approval.required",
  "dag.state.updated",
  "telemetry.usage",
] as const;
const STARTERS = [
  {
    number: "1",
    title: "Plan a feature",
    prompt:
      "Plan a new feature for this repository. Inspect the project and outline a small implementation plan.",
  },
  {
    number: "2",
    title: "Inspect the DAG",
    prompt: "Inspect the current workspace and summarize the task DAG and outstanding work.",
  },
  {
    number: "3",
    title: "Run diagnostics",
    prompt: "Run repo diagnostics and explain any issues you find.",
  },
];
const STAGES = ["Backlog", "Design", "Implementation", "Done"];

function createMessages(events: SessionEvent[]): ChatMessage[] {
  const messages: ChatMessage[] = [];
  for (const event of events) {
    if (event.type !== "message.delta") continue;
    const previous = messages.at(-1);
    if (previous?.role === event.role) previous.content += event.delta_text;
    else
      messages.push({
        id: event.id,
        role: event.role,
        content: event.delta_text,
        timestamp: event.timestamp,
      });
  }
  return messages;
}

type TaskData = { label: string; stage: string; status: string };
function layoutDag(
  nodes: Node<TaskData>[],
  edges: Edge[],
): { nodes: Node<TaskData>[]; edges: Edge[] } {
  if (!nodes.length) return { nodes, edges };
  const graph = new dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}));
  graph.setGraph({ rankdir: "LR", nodesep: 38, ranksep: 72, marginx: 20, marginy: 20 });
  for (const node of nodes) graph.setNode(node.id, { width: 176, height: 68 });
  for (const edge of edges) graph.setEdge(edge.source, edge.target);
  dagre.layout(graph);
  return {
    nodes: nodes.map((node) => {
      const position = graph.node(node.id);
      return {
        ...node,
        position: { x: position.x - 88, y: position.y - 34 },
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
      };
    }),
    edges,
  };
}

function TaskNode({ data }: { data: { label: string; stage: string; status: string } }) {
  const tone =
    data.status === "done"
      ? "task-done"
      : data.status === "blocked"
        ? "task-blocked"
        : data.status === "running"
          ? "task-running"
          : "task-backlog";
  const mark =
    data.status === "done"
      ? "✓"
      : data.status === "blocked"
        ? "!"
        : data.status === "running"
          ? "◌"
          : "○";
  return (
    <div className={"task-node " + tone}>
      <Handle type="target" position={Position.Left} />
      <span className="task-node-stage">{data.stage}</span>
      <span>
        {mark} {data.label}
      </span>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

const NODE_TYPES = { task: TaskNode };

function DagPanel({
  events,
  onRollback,
  rollbackMessage,
}: {
  events: SessionEvent[];
  onRollback: (taskId: string) => void;
  rollbackMessage: string;
}) {
  const dagUpdates = events.filter(
    (event): event is Extract<SessionEvent, { type: "dag.state.updated" }> =>
      event.type === "dag.state.updated",
  );
  const projectedDag = useMemo(() => {
    const nodeMap = new Map<string, (typeof dagUpdates)[number]["nodes"][number]>();
    const edgeMap = new Map<string, (typeof dagUpdates)[number]["edges"][number]>();
    for (const update of dagUpdates) {
      for (const node of update.nodes) nodeMap.set(node.id, node);
      for (const edge of update.edges) edgeMap.set(edge.source + "->" + edge.target, edge);
    }
    return { nodes: [...nodeMap.values()], edges: [...edgeMap.values()] };
  }, [dagUpdates]);
  const dagNodes = projectedDag.nodes;
  const graph = useMemo(
    () =>
      layoutDag(
        dagNodes.map((node) => ({
          id: node.id,
          type: "task",
          data: { label: node.label, stage: node.stage, status: node.status },
          position: { x: 0, y: 0 },
        })),
        projectedDag.edges.map((edge, index) => ({
          id: "edge-" + index,
          source: edge.source,
          target: edge.target,
          animated: true,
        })),
      ),
    [projectedDag],
  );
  const doneTaskIds = [
    ...new Set(dagNodes.filter((node) => node.status === "done").map((node) => node.id)),
  ];

  return (
    <aside className="left-rail panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">WORKSPACE MAP</span>
          <h2>Execution DAG</h2>
        </div>
        <span className="live-dot" />
      </div>
      <div className="stage-strip">
        {STAGES.map((stage) => (
          <span key={stage}>{stage}</span>
        ))}
      </div>
      <div className="dag-canvas">
        {graph.nodes.length ? (
          <ReactFlowProvider>
            <ReactFlow
              nodes={graph.nodes}
              edges={graph.edges}
              nodeTypes={NODE_TYPES}
              fitView
              fitViewOptions={{ padding: 0.2 }}
              minZoom={0.2}
              maxZoom={1.2}
              proOptions={{ hideAttribution: true }}
              nodesDraggable={false}
              nodesConnectable={false}
              elementsSelectable={false}
            >
              <Background color="#253141" gap={22} size={1} />
              <MiniMap
                pannable
                zoomable
                nodeColor={(node) =>
                  node.data.status === "done"
                    ? "#51d6a1"
                    : node.data.status === "blocked"
                      ? "#ff7888"
                      : "#4f91ff"
                }
              />
              <Controls showInteractive={false} />
            </ReactFlow>
          </ReactFlowProvider>
        ) : (
          <div className="dag-empty">
            <span className="dag-empty-mark">{"{  o  }"}</span>
            <b>Your workspace map appears here</b>
            <p>Start a task to see its stages and dependencies.</p>
          </div>
        )}
      </div>
      <div className="rollback-list">
        <div className="eyebrow">CHECKPOINTS</div>
        {doneTaskIds.length ? (
          doneTaskIds.map((taskId) => (
            <button className="checkpoint-row" key={taskId} onClick={() => onRollback(taskId)}>
              <span>
                <i className="status-check">✓</i>
                {taskId}
              </span>
              <span>Discard branch ↗</span>
            </button>
          ))
        ) : (
          <p className="quiet-copy">Passed tasks will appear here for rollback.</p>
        )}
        {rollbackMessage && <p className="feedback-copy">{rollbackMessage}</p>}
      </div>
    </aside>
  );
}

function ChatRuntime({
  messages,
  sessionId,
  baseUrl,
  isRunning,
  onPromptAccepted,
  onError,
  session,
}: {
  messages: ChatMessage[];
  sessionId: string;
  baseUrl: string;
  isRunning: boolean;
  onPromptAccepted: () => void;
  onError: (message: string) => void;
  session: AppSession;
}) {
  const converted = useMemo<ThreadMessageLike[]>(
    () =>
      messages.map((message) => ({
        id: String(message.id),
        role: message.role,
        content: message.content,
        createdAt: new Date(message.timestamp),
      })),
    [messages],
  );
  const onNew = useCallback(
    async (message: AppendMessage) => {
      const prompt = message.content
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("")
        .trim();
      if (!prompt) return;
      const response = await fetch(baseUrl + "/api/sessions/" + sessionId + "/prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      });
      if (!response.ok) {
        const body = await response.text();
        onError("Prompt failed · HTTP " + response.status + (body ? " · " + body : ""));
        throw new Error("Prompt failed with HTTP " + response.status);
      }
      onPromptAccepted();
    },
    [baseUrl, onError, onPromptAccepted, sessionId],
  );
  const runtime = useExternalStoreRuntime<ThreadMessageLike>({
    messages: converted,
    convertMessage: (message) => message,
    onNew,
    isRunning,
    isSendDisabled: session.status === "waiting_approval",
  });

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ThreadPrimitive.Root className="thread-root">
        <ThreadPrimitive.Viewport className="thread-viewport">
          <AuiIf condition={(state) => state.thread.isEmpty}>
            <div className="welcome-card">
              <span className="eyebrow">BOUNDED CODING AGENT</span>
              <h2>
                Give Helix a task.
                <br />
                <em>Keep the work inspectable.</em>
              </h2>
              <p>
                Helix works in an isolated workspace, runs mechanical gates, and streams each step
                here.
              </p>
            </div>
          </AuiIf>
          <ThreadPrimitive.Messages>
            {({ message }) => (
              <MessagePrimitive.Root
                className={
                  "chat-message " + (message.role === "user" ? "chat-user" : "chat-assistant")
                }
              >
                <div className="message-meta">
                  {message.role === "user" ? "YOU" : "HELIX"}
                  <span>
                    {message.createdAt?.toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </div>
                <div className="message-content">
                  <MessagePrimitive.Parts />
                </div>
              </MessagePrimitive.Root>
            )}
          </ThreadPrimitive.Messages>
          <ThreadPrimitive.ViewportFooter className="composer-dock">
            <ComposerPrimitive.Root className="composer-box">
              <ComposerPrimitive.Input
                placeholder={
                  session.status === "waiting_approval"
                    ? "Resolve the approval request to continue"
                    : "Describe the work · Enter to send"
                }
                rows={2}
              />
              <div className="composer-actions">
                <span>Enter to send · Shift+Enter for a new line</span>
                <ComposerPrimitive.Send className="send-button">
                  Send <span>↗</span>
                </ComposerPrimitive.Send>
              </div>
            </ComposerPrimitive.Root>
          </ThreadPrimitive.ViewportFooter>
        </ThreadPrimitive.Viewport>
      </ThreadPrimitive.Root>
    </AssistantRuntimeProvider>
  );
}

function ToolInspector({ events }: { events: SessionEvent[] }) {
  const starts = events.filter(
    (event): event is Extract<SessionEvent, { type: "tool.call.start" }> =>
      event.type === "tool.call.start",
  );
  const results = new Map<string, Extract<SessionEvent, { type: "tool.call.result" }>>();
  for (const event of events) {
    if (event.type !== "tool.call.result") continue;
    const previous = results.get(event.call_id);
    results.set(event.call_id, {
      ...previous,
      ...event,
      stdout: event.stdout || previous?.stdout || "",
      stderr: event.stderr || previous?.stderr || "",
      diff_patch: event.diff_patch ?? previous?.diff_patch,
    });
  }
  const [expanded, setExpanded] = useState<string[]>([]);
  return (
    <div className="tool-list">
      {starts.length ? (
        starts.map((start) => {
          const result = results.get(start.call_id);
          const open = expanded.includes(start.call_id);
          return (
            <article key={start.call_id} className="tool-card">
              <button
                className="tool-card-head"
                onClick={() =>
                  setExpanded((items) =>
                    open ? items.filter((id) => id !== start.call_id) : [...items, start.call_id],
                  )
                }
              >
                <span
                  className={
                    "tool-state " +
                    (result?.status === "failed" ? "failed" : result ? "done" : "running")
                  }
                >
                  {result?.status === "failed" ? "!" : result ? "✓" : "◌"}
                </span>
                <span className="tool-name">{start.tool_name}</span>
                <span className="tool-duration">
                  {result ? result.duration_ms + " ms" : "running"}
                </span>
                <span className="tool-chevron">{open ? "−" : "+"}</span>
              </button>
              {open && (
                <div className="tool-details">
                  <pre>{start.partial_args || "{}"}</pre>
                  {result && (
                    <>
                      <div className="tool-status-line">
                        {result.status === "succeeded" ? "Completed" : "Ended · " + result.status}
                      </div>
                      {(result.stdout || result.stderr) && (
                        <details>
                          <summary>Terminal output</summary>
                          <pre>
                            {result.stdout}
                            {result.stderr ? "\n" + result.stderr : ""}
                          </pre>
                        </details>
                      )}
                      {result.diff_patch && (
                        <details open>
                          <summary>Diff · checkpoint inspector</summary>
                          <div className="diff-box">
                            <Suspense fallback={<pre>Loading diff viewer…</pre>}>
                              <ReactDiffViewer
                                oldValue=""
                                newValue={result.diff_patch}
                                splitView={false}
                                useDarkTheme
                                disableWorker
                                highlightLanguage="typescript"
                              />
                            </Suspense>
                          </div>
                        </details>
                      )}
                    </>
                  )}
                </div>
              )}
            </article>
          );
        })
      ) : (
        <div className="inspector-empty">
          <span className="tiny-orbit">◌</span>
          <p>Tool calls, output, and task diffs will show up here as Helix works.</p>
        </div>
      )}
    </div>
  );
}

function SettingsDrawer({
  open,
  onClose,
  baseUrl,
  providers,
  profiles,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  baseUrl: string;
  providers: ProviderInfo[];
  profiles: ProviderProfile[];
  onSaved: (provider: ProviderInfo) => void;
}) {
  const [form, setForm] = useState<ProviderForm>({
    name: "My gateway",
    provider: "openai",
    base_url: "https://api.openai.com/v1",
    api_key: "",
    model: "",
    default_headers: "{}",
  });
  const [check, setCheck] = useState<ProviderCheck | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [initialized, setInitialized] = useState(false);
  useEffect(() => {
    const current = providers[0];
    if (!initialized && current) {
      setForm((value) => ({
        ...value,
        provider: current.id,
        base_url: current.baseUrl ?? value.base_url,
        model: current.model ?? value.model,
      }));
      setInitialized(true);
    }
  }, [initialized, providers]);
  if (!open) return null;
  const update = (key: keyof ProviderForm, value: string) =>
    setForm((current) => ({ ...current, [key]: value }));
  const chooseProfile = (name: string) => {
    const profile = profiles.find((entry) => entry.name === name);
    setCheck(null);
    setError("");
    if (!profile) {
      setForm({
        name: "My gateway",
        provider: "openai",
        base_url: "https://api.openai.com/v1",
        api_key: "",
        model: "",
        default_headers: "{}",
      });
      return;
    }
    setForm({
      name: profile.name,
      provider: profile.provider,
      base_url: profile.base_url ?? "",
      api_key: "",
      model: profile.model ?? "",
      default_headers: "",
    });
  };
  const verify = async () => {
    setBusy(true);
    setError("");
    setCheck(null);
    try {
      const headers = form.default_headers.trim()
        ? (JSON.parse(form.default_headers) as Record<string, string>)
        : undefined;
      const response = await fetch(baseUrl + "/api/config/providers/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          provider: form.provider,
          base_url: form.base_url,
          api_key: form.api_key,
          model: form.model || "probe",
          ...(headers ? { default_headers: headers } : {}),
        }),
      });
      const body = (await response.json()) as Partial<ProviderCheck> & { error?: string };
      const result: ProviderCheck = {
        ok: body.ok ?? false,
        models: body.models ?? [],
        diagnostics: body.diagnostics ?? [],
        remediationHint: body.remediationHint,
      };
      setCheck(result);
      if (!response.ok || !result.ok)
        setError(
          result.remediationHint ?? body.error ?? "Verification failed · HTTP " + response.status,
        );
      else if (result.models.length) update("model", result.models[0]!.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not verify this provider");
    } finally {
      setBusy(false);
    }
  };
  const save = async () => {
    setBusy(true);
    setError("");
    try {
      const headers = form.default_headers.trim()
        ? (JSON.parse(form.default_headers) as Record<string, string>)
        : undefined;
      const response = await fetch(baseUrl + "/api/config/providers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          provider: form.provider,
          base_url: form.base_url,
          api_key: form.api_key,
          model: form.model,
          ...(headers ? { default_headers: headers } : {}),
          make_default: true,
        }),
      });
      const body = (await response.json()) as {
        model?: string;
        base_url?: string;
        provider?: string;
        error?: string;
      };
      if (!response.ok) throw new Error(body.error ?? "Save failed · HTTP " + response.status);
      onSaved({
        id: body.provider ?? form.provider,
        model: body.model ?? form.model,
        baseUrl: body.base_url ?? form.base_url,
        configured: true,
      });
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save this provider");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="drawer-layer">
      <button className="drawer-scrim" aria-label="Close provider settings" onClick={onClose} />
      <aside className="settings-drawer">
        <div className="drawer-head">
          <div>
            <span className="eyebrow">CONNECTION SETTINGS</span>
            <h2>AI gateway</h2>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <p className="drawer-intro">
          Connect Helix to an OpenAI-compatible endpoint. Credentials stay in your local provider
          profile.
        </p>
        <label>
          Saved provider profile
          <select
            value={profiles.some((profile) => profile.name === form.name) ? form.name : ""}
            onChange={(event) => chooseProfile(event.target.value)}
          >
            <option value="">＋ New provider profile</option>
            {profiles.map((profile) => (
              <option value={profile.name} key={profile.name}>
                {profile.name}
                {profile.is_default ? " · default" : ""}
              </option>
            ))}
          </select>
        </label>
        <label>
          Profile name
          <input value={form.name} onChange={(event) => update("name", event.target.value)} />
        </label>
        <label>
          Provider type
          <select
            value={form.provider}
            onChange={(event) => update("provider", event.target.value)}
          >
            <option value="openai">OpenAI-compatible</option>
            <option value="local">Local inference</option>
            <option value="generic">Generic</option>
          </select>
        </label>
        <label>
          Base URL
          <input
            value={form.base_url}
            onChange={(event) => update("base_url", event.target.value)}
            placeholder="http://localhost:11434/v1"
          />
        </label>
        <label>
          API token
          <input
            type="password"
            value={form.api_key}
            onChange={(event) => update("api_key", event.target.value)}
            placeholder="Local gateways can leave this blank"
            autoComplete="new-password"
          />
        </label>
        <label>
          Model
          <input
            value={form.model}
            onChange={(event) => update("model", event.target.value)}
            placeholder="Choose after verification"
            list="model-options"
          />
          <datalist id="model-options">
            {check?.models.map((model) => (
              <option key={model.id} value={model.id} />
            ))}
          </datalist>
        </label>
        {check?.models.length ? (
          <label>
            Fetched models
            <select value={form.model} onChange={(event) => update("model", event.target.value)}>
              {check.models.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.id}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label>
          Default headers · JSON
          <textarea
            className="header-json"
            value={form.default_headers}
            onChange={(event) => update("default_headers", event.target.value)}
            placeholder="Leave blank to keep saved headers unchanged"
            rows={3}
            spellCheck={false}
          />
          <small className="field-help">
            {profiles
              .find((profile) => profile.name === form.name)
              ?.default_header_names.join(", ") || "Custom gateway headers are optional."}
          </small>
        </label>
        <div className="drawer-actions">
          <button className="button-secondary" disabled={busy} onClick={() => void verify()}>
            {busy ? "Checking…" : "Verify & Fetch Models"}
          </button>
          {check?.ok && (
            <button
              className="button-primary"
              disabled={busy || !form.model}
              onClick={() => void save()}
            >
              Save provider
            </button>
          )}
        </div>
        {error && <p className="error-callout">{error}</p>}
        {check && (
          <div className="diagnostic-log">
            <div className="diagnostic-title">
              <span>HTTP DIAGNOSTICS</span>
              <span className={check.ok ? "diagnostic-ok" : "diagnostic-fail"}>
                {check.ok ? "CONNECTED" : "NEEDS ATTENTION"}
              </span>
            </div>
            {check.diagnostics.map((item, index) => (
              <div className="diagnostic-row" key={item.stage + "-" + index}>
                <div>
                  <b>
                    {item.method} {item.endpoint}
                  </b>
                  <span>
                    {item.stage} · {item.latencyMs} ms · HTTP {item.status ?? "—"}
                  </span>
                </div>
                <i className={item.ok ? "diagnostic-ok" : "diagnostic-fail"}>
                  {item.ok ? "OK" : "FAIL"}
                </i>
                {item.rawBody && <pre>{item.rawBody}</pre>}
              </div>
            ))}
          </div>
        )}
      </aside>
    </div>
  );
}

export function App() {
  const baseUrl = window.location.origin;
  const [sessions, setSessions] = useState<AppSession[]>([]);
  const [sessionId, setSessionId] = useState("");
  const [session, setSession] = useState<AppSession | null>(null);
  const [events, setEvents] = useState<SessionEvent[]>([]);
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [profiles, setProfiles] = useState<ProviderProfile[]>([]);
  const [connection, setConnection] = useState("connecting");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const [rollbackMessage, setRollbackMessage] = useState("");
  const messages = useMemo(() => createMessages(events), [events]);
  const toolCalls = events.filter((event) => event.type === "tool.call.start").length;
  const latestUsage = [...events].reverse().find((event) => event.type === "telemetry.usage");
  const pendingApproval = [...events]
    .reverse()
    .find(
      (event): event is Extract<SessionEvent, { type: "approval.required" }> =>
        event.type === "approval.required",
    );
  const hasResolvedApproval =
    pendingApproval &&
    events.some((event) => event.id > pendingApproval.id && event.type === "message.delta");
  const activeApproval =
    pendingApproval && !hasResolvedApproval && session?.status === "waiting_approval"
      ? pendingApproval
      : undefined;
  const usage = latestUsage?.type === "telemetry.usage" ? latestUsage : undefined;
  const cacheHit =
    usage && usage.prompt_tokens + usage.cache_read_tokens > 0
      ? Math.round(
          (100 * usage.cache_read_tokens) / (usage.prompt_tokens + usage.cache_read_tokens),
        )
      : 0;
  const velocity =
    usage && usage.latency_ms > 0
      ? Math.round(usage.completion_tokens / (usage.latency_ms / 1000))
      : 0;
  const usageHistory = events
    .filter(
      (event): event is Extract<SessionEvent, { type: "telemetry.usage" }> =>
        event.type === "telemetry.usage",
    )
    .slice(-10);
  const usageRates = usageHistory.map((event) =>
    event.latency_ms > 0 ? event.completion_tokens / (event.latency_ms / 1000) : 0,
  );
  const maxUsageRate = Math.max(1, ...usageRates);
  const usageSparkline = usageRates
    .map((rate) => "▁▂▃▄▅▆▇█"[Math.min(7, Math.round((rate / maxUsageRate) * 7))])
    .join("");

  const refreshSessions = useCallback(async (): Promise<AppSession[]> => {
    const [sessionResponse, providerResponse] = await Promise.all([
      fetch(baseUrl + "/api/sessions"),
      fetch(baseUrl + "/api/config/providers"),
    ]);
    if (!sessionResponse.ok) throw new Error("Daemon returned HTTP " + sessionResponse.status);
    const sessionData = (await sessionResponse.json()) as { sessions: AppSession[] };
    const normalized = sessionData.sessions.map((item) => ({
      ...item,
      label:
        new Date(item.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) +
        " · " +
        item.id.slice(0, 8),
    }));
    setSessions(normalized);
    if (providerResponse.ok) {
      const providerData = (await providerResponse.json()) as {
        providers: ProviderInfo[];
        profiles?: ProviderProfile[];
      };
      setProviders(providerData.providers ?? []);
      setProfiles(providerData.profiles ?? []);
    }
    return normalized;
  }, [baseUrl]);

  const createSession = useCallback(async () => {
    const response = await fetch(baseUrl + "/api/sessions", { method: "POST" });
    if (!response.ok) throw new Error("Could not create a session · HTTP " + response.status);
    const data = (await response.json()) as { session: SessionSnapshot };
    setSessionId(data.session.id);
    await refreshSessions();
  }, [baseUrl, refreshSessions]);

  useEffect(() => {
    let active = true;
    void refreshSessions()
      .then(async (loadedSessions) => {
        if (!active) return;
        setConnection("connected");
        const urlSession = new URLSearchParams(window.location.search).get("session");
        const existing =
          urlSession && loadedSessions.some((item) => item.id === urlSession) ? urlSession : "";
        const mostRecent =
          [...loadedSessions]
            .reverse()
            .find((item) => item.status === "running" || item.status === "waiting_approval") ??
          loadedSessions.at(-1);
        if (existing || mostRecent) setSessionId(existing || mostRecent!.id);
        else {
          const response = await fetch(baseUrl + "/api/sessions", { method: "POST" });
          const data = (await response.json()) as { session: SessionSnapshot };
          if (active) {
            setSessionId(data.session.id);
            void refreshSessions();
          }
        }
      })
      .catch((error: unknown) => {
        if (active) {
          setConnection(error instanceof Error ? error.message : "disconnected");
          setNotice("Could not connect to helixd. Start it with helix serve and reload this page.");
        }
      });
    const timer = window.setInterval(() => {
      void refreshSessions().catch(() => setConnection("reconnecting"));
    }, 2500);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [baseUrl, refreshSessions]);

  useEffect(() => {
    if (!sessionId) {
      setSession(null);
      setEvents([]);
      return;
    }
    let active = true;
    const pageUrl = new URL(window.location.href);
    pageUrl.searchParams.set("session", sessionId);
    window.history.replaceState(null, "", pageUrl);
    setEvents([]);
    const updateSession = async () => {
      const response = await fetch(baseUrl + "/api/sessions/" + encodeURIComponent(sessionId));
      if (response.ok && active) {
        const data = (await response.json()) as { session: AppSession };
        setSession({ ...data.session, label: data.session.id.slice(0, 8) });
      }
    };
    void updateSession();
    const source = new EventSource(
      baseUrl + "/api/sessions/" + encodeURIComponent(sessionId) + "/events",
    );
    source.onopen = () => setConnection("connected");
    source.onerror = () => setConnection("reconnecting");
    const onEvent = (event: Event) => {
      const message = event as MessageEvent<string>;
      try {
        const value = JSON.parse(message.data) as SessionEvent;
        if (active)
          setEvents((previous) =>
            previous.some((item) => item.id === value.id) ? previous : [...previous, value],
          );
      } catch {
        setNotice("A malformed event arrived from the daemon; the stream remains connected.");
      }
    };
    for (const type of EVENT_TYPES) source.addEventListener(type, onEvent);
    const poll = window.setInterval(() => {
      void updateSession();
    }, 1500);
    return () => {
      active = false;
      source.close();
      window.clearInterval(poll);
    };
  }, [baseUrl, sessionId]);

  const submitPrompt = useCallback(
    async (prompt: string) => {
      if (!sessionId) return;
      const response = await fetch(baseUrl + "/api/sessions/" + sessionId + "/prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      });
      if (!response.ok) setNotice("Prompt failed · HTTP " + response.status);
    },
    [baseUrl, sessionId],
  );
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSettingsOpen(false);
      if (event.key.toLowerCase() === "p" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setSettingsOpen(true);
      }
      const target = event.target as HTMLElement | null;
      if (
        !messages.length &&
        !target?.closest("input, textarea, select") &&
        /^[1-3]$/.test(event.key)
      ) {
        const starter = STARTERS[Number(event.key) - 1];
        if (starter) void submitPrompt(starter.prompt);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [messages.length, submitPrompt]);

  const resolveApproval = async (decision: "approve" | "reject") => {
    if (!activeApproval || !sessionId) return;
    const response = await fetch(baseUrl + "/api/sessions/" + sessionId + "/approve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ gateId: activeApproval.gate_id, decision }),
    });
    if (!response.ok) setNotice("Approval update failed · HTTP " + response.status);
  };
  const cancelSession = async () => {
    if (!sessionId) return;
    const response = await fetch(baseUrl + "/api/sessions/" + sessionId + "/cancel", {
      method: "POST",
    });
    if (!response.ok) setNotice("Cancel failed · HTTP " + response.status);
  };
  const rollbackTask = async (taskId: string) => {
    if (!sessionId || !window.confirm("Discard the retained Helix branch for " + taskId + "?"))
      return;
    const response = await fetch(baseUrl + "/api/sessions/" + sessionId + "/rollback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskId }),
    });
    const data = (await response.json()) as { message?: string; error?: string };
    setRollbackMessage(
      response.ok
        ? (data.message ?? "Task branch discarded")
        : (data.error ?? "Rollback failed · HTTP " + response.status),
    );
  };

  const sessionLabel = session
    ? session.id.slice(0, 8) + " · " + session.promptCount + " prompts"
    : "Starting session…";
  const provider = providers[0];
  const contextPercent = Math.max(0, Math.min(100, usage?.context_window_pct ?? 0));

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">H</span>
          <div>
            <b>HELIX</b>
            <small>CODING HARNESS</small>
          </div>
        </div>
        <div className="session-control">
          <span className="eyebrow">SESSION</span>
          <select
            value={sessionId}
            onChange={(event) => setSessionId(event.target.value)}
            aria-label="Select session"
          >
            {sessions.map((item) => (
              <option value={item.id} key={item.id}>
                {item.label}
              </option>
            ))}
          </select>
          <button className="new-session" onClick={() => void createSession()}>
            ＋ New
          </button>
        </div>
        <div className="topbar-right">
          <span
            className={"connection-pill " + (connection === "connected" ? "online" : "offline")}
          >
            <i />
            {connection}
          </span>
          <span className="provider-pill">
            {provider?.id ?? "no provider"}
            <b>{provider?.model ?? "configure"}</b>
          </span>
          <button className="settings-trigger" onClick={() => setSettingsOpen(true)}>
            <span>⚙</span> AI gateway <kbd>⌘ P</kbd>
          </button>
        </div>
      </header>
      <section className="telemetry-strip">
        <div className="telemetry-title">
          <span className="signal-mark">⌁</span>
          <span>LIVE TELEMETRY</span>
        </div>
        <div className="telemetry-stat">
          <span>GENERATION</span>
          <b>
            {velocity || "—"}
            <small> tok/s</small>
          </b>
        </div>
        <div className="telemetry-stat">
          <span>CONTEXT WINDOW</span>
          <b>{usage && usage.context_window_pct > 0 ? Math.round(contextPercent) + "%" : "—"}</b>
          <div className="context-track">
            <i
              style={{ width: usage && usage.context_window_pct > 0 ? contextPercent + "%" : "0%" }}
            />
          </div>
        </div>
        <div className="telemetry-stat">
          <span>CACHE HIT</span>
          <b>
            {usage && usage.cache_read_tokens + usage.cache_write_tokens > 0 ? cacheHit + "%" : "—"}
          </b>
        </div>
        <div className="telemetry-stat">
          <span>SESSION COST</span>
          <b>{usage ? "$" + usage.cost_usd.toFixed(4) : "—"}</b>
        </div>
        <div className="telemetry-stat">
          <span>LATENCY</span>
          <b>{usage ? usage.latency_ms + " ms" : "—"}</b>
        </div>
        <div className="telemetry-spark">
          <span>{usageSparkline || "▁▂▁▃▂▅▃▆"}</span>
          <small>OUTPUT TOKENS / SEC</small>
        </div>
      </section>
      <div className="workspace-grid">
        <DagPanel
          events={events}
          onRollback={(taskId) => void rollbackTask(taskId)}
          rollbackMessage={rollbackMessage}
        />
        <section className="conversation panel">
          <div className="conversation-heading">
            <div>
              <span className="eyebrow">LIVE WORKSPACE</span>
              <h1>{sessionLabel}</h1>
            </div>
            <div className="conversation-actions">
              <span className={"run-status " + (session?.status ?? "idle")}>
                <i />
                {session?.status ?? "idle"}
              </span>
              {session?.status === "running" || session?.status === "waiting_approval" ? (
                <button className="cancel-button" onClick={() => void cancelSession()}>
                  Cancel run
                </button>
              ) : null}
            </div>
          </div>
          {notice && (
            <div className="notice-bar">
              <span>{notice}</span>
              <button onClick={() => setNotice("")}>×</button>
            </div>
          )}
          <div className="conversation-body">
            {!messages.length && (
              <div className="starter-grid">
                {STARTERS.map((starter) => (
                  <button key={starter.number} onClick={() => void submitPrompt(starter.prompt)}>
                    <kbd>{starter.number}</kbd>
                    <span>
                      <b>{starter.title}</b>
                      <small>{starter.prompt}</small>
                    </span>
                    <i>↗</i>
                  </button>
                ))}
                <button className="starter-provider" onClick={() => setSettingsOpen(true)}>
                  <kbd>4</kbd>
                  <span>
                    <b>Configure AI provider</b>
                    <small>Connect OpenAI, Ollama, vLLM, LiteLLM, or a custom gateway.</small>
                  </span>
                  <i>↗</i>
                </button>
              </div>
            )}
            <ChatRuntime
              messages={messages}
              sessionId={sessionId}
              baseUrl={baseUrl}
              isRunning={session?.status === "running" || session?.status === "waiting_approval"}
              onPromptAccepted={() => setNotice("")}
              onError={setNotice}
              session={
                session ?? {
                  id: sessionId,
                  createdAt: new Date().toISOString(),
                  status: "idle",
                  promptCount: 0,
                  label: "",
                }
              }
            />
          </div>
          {activeApproval && (
            <div className="approval-banner">
              <div className="approval-icon">!</div>
              <div className="approval-copy">
                <span className="eyebrow">
                  APPROVAL REQUIRED · {activeApproval.risk_level} RISK
                </span>
                <b>
                  {activeApproval.action_type}: {activeApproval.command_or_path}
                </b>
                <small>Helix is waiting for your decision before continuing.</small>
              </div>
              <div className="approval-actions">
                <button className="button-secondary" onClick={() => void resolveApproval("reject")}>
                  Reject
                </button>
                <button className="button-primary" onClick={() => void resolveApproval("approve")}>
                  Approve <kbd>Y</kbd>
                </button>
              </div>
            </div>
          )}
        </section>
        <aside className="right-rail panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">OBSERVABILITY</span>
              <h2>Execution details</h2>
            </div>
            <span className="event-count">{toolCalls.toString().padStart(2, "0")}</span>
          </div>
          <div className="inspector-summary">
            <span className="eyebrow">CURRENT SESSION</span>
            <p>{session?.id ?? "Connecting to daemon…"}</p>
            <div className="summary-metrics">
              <span>
                <b>{messages.length}</b> messages
              </span>
              <span>
                <b>{toolCalls}</b> tool calls
              </span>
            </div>
          </div>
          <div className="section-label">
            <span>TOOL EXECUTIONS</span>
            <span>{toolCalls}</span>
          </div>
          <ToolInspector events={events} />
          <div className="inspector-footer">
            <span>EVENT STREAM</span>
            <span className="stream-state">
              <i />
              {connection}
            </span>
            <p>Immutable events · replay resumes automatically</p>
          </div>
        </aside>
      </div>
      <SettingsDrawer
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        baseUrl={baseUrl}
        providers={providers}
        profiles={profiles}
        onSaved={(saved) => {
          setProviders([saved]);
          setNotice("Connected to " + saved.id + " · " + (saved.model ?? "provider saved"));
        }}
      />
    </main>
  );
}
