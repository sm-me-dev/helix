import { createCliRenderer } from "@opentui/core";
import { createRoot, useKeyboard } from "@opentui/react";
import { createElement, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import type { SessionEvent, SessionSnapshot } from "../daemon/contracts.ts";
import { projectTuiState } from "./model.ts";

type TuiOptions = { baseUrl: string; session: SessionSnapshot };
type TuiState = {
  events: SessionEvent[];
  status: string;
  providers: Array<{ id: string; model?: string; baseUrl?: string; configured?: boolean }>;
};
type TextareaHandle = { plainText: string; setText(value: string): void; focus(): void };
type ElementFactory = (
  type: string,
  props?: Record<string, unknown> | null,
  ...children: ReactNode[]
) => ReactElement;
const h = createElement as unknown as ElementFactory;

const STARTERS = [
  "Plan a new feature spec for this repository.",
  "Inspect the workspace DAG and summarize the current work.",
  "Run repository diagnostics and report actionable failures.",
];
const SLASH_COMMANDS = ["/provider", "/model", "/doctor", "/dag", "/diff", "/clear"];

export async function startTui(options: TuiOptions): Promise<void> {
  const renderer = await createCliRenderer({ exitOnCtrlC: false });
  const root = createRoot(renderer);
  await new Promise<void>((resolve) => {
    root.render(createElement(HelixApp, { ...options, onQuit: resolve }));
  });
  root.unmount();
  renderer.destroy();
}

function HelixApp({ baseUrl, session, onQuit }: TuiOptions & { onQuit: () => void }): ReactElement {
  const [events, setEvents] = useState<SessionEvent[]>([]);
  const [status, setStatus] = useState("connecting");
  const [providers, setProviders] = useState<TuiState["providers"]>([]);
  const [draft, setDraft] = useState("");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [setupOpen, setSetupOpen] = useState(false);
  const [editingApproval, setEditingApproval] = useState(false);
  const [preset, setPreset] = useState(1);
  const [inspector, setInspector] = useState("Execution details");
  const [expandedCall, setExpandedCall] = useState("");
  const [fileMatches, setFileMatches] = useState<string[]>([]);
  const [resolvedGates, setResolvedGates] = useState<string[]>([]);
  const [modelChoices, setModelChoices] = useState<string[]>([]);
  const [selectedModelIndex, setSelectedModelIndex] = useState(0);
  const [pendingProfile, setPendingProfile] = useState<
    { name: string; provider: string; base_url: string; api_key: string } | undefined
  >();
  const composer = useRef<TextareaHandle | null>(null);
  const view = useMemo(() => projectTuiState(events), [events]);
  const lastApproval = useMemo(
    () =>
      view.pendingApproval && !resolvedGates.includes(view.pendingApproval.gate_id)
        ? view.pendingApproval
        : undefined,
    [view, resolvedGates],
  );

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    void (async () => {
      try {
        const providerResponse = await fetch(`${baseUrl}/api/config/providers`, {
          signal: controller.signal,
        });
        const providerData = (await providerResponse.json()) as {
          providers: TuiState["providers"];
        };
        if (!active) return;
        setProviders(providerData.providers ?? []);
        if (!providerData.providers?.some((provider) => provider.configured)) setSetupOpen(true);

        const response = await fetch(`${baseUrl}/api/sessions/${session.id}/events`, {
          signal: controller.signal,
        });
        if (!response.ok || !response.body)
          throw new Error(`Event stream returned HTTP ${response.status}`);
        setStatus("connected");
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        while (active) {
          const chunk = await reader.read();
          if (chunk.done) break;
          buffer += decoder.decode(chunk.value, { stream: true });
          const frames = buffer.split("\n\n");
          buffer = frames.pop() ?? "";
          for (const frame of frames) {
            const dataLine = frame.split("\n").find((line) => line.startsWith("data: "));
            if (!dataLine) continue;
            const event = JSON.parse(dataLine.slice(6)) as SessionEvent;
            if (!active) break;
            setEvents((previous) => [...previous, event]);
            if (event.type === "approval.required") setSetupOpen(false);
            if (event.type === "tool.call.start") setInspector(`Running ${event.tool_name}`);
            if (event.type === "tool.call.result")
              setInspector(`${event.call_id}: ${event.status}`);
          }
        }
      } catch (error) {
        if (active && !controller.signal.aborted)
          setStatus(error instanceof Error ? error.message : "connection failed");
      }
    })();
    return () => {
      active = false;
      controller.abort();
    };
  }, [baseUrl, session.id]);

  const submit = useCallback(
    async (text: string) => {
      const prompt = text.trim();
      setDraft("");
      composer.current?.setText("");
      if (!prompt) return;
      if (lastApproval && editingApproval) {
        await fetch(`${baseUrl}/api/sessions/${session.id}/approve`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            gateId: lastApproval.gate_id,
            decision: "edit",
            editedValue: prompt,
          }),
        });
        setResolvedGates((previous) => [...previous, lastApproval.gate_id]);
        setEditingApproval(false);
        return;
      }
      if (lastApproval) return;
      if (prompt === "/clear") {
        setEvents([]);
        setInspector("Conversation cleared");
        return;
      }
      if (prompt === "/dag") {
        setInspector("Workspace DAG");
        return;
      }
      if (prompt === "/diff") {
        setInspector("Latest checkpoint diff");
        return;
      }
      if (prompt === "/provider" || prompt === "/model") {
        setSetupOpen(true);
        return;
      }
      if (prompt === "/doctor") {
        setInspector("Provider handshake is available in the setup modal");
        setSetupOpen(true);
        return;
      }
      const body = prompt.startsWith("/") ? SLASH_COMMANDS.join("  ") : prompt;
      const response = await fetch(`${baseUrl}/api/sessions/${session.id}/prompt`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: body }),
      });
      if (!response.ok) setStatus(`prompt failed: HTTP ${response.status}`);
    },
    [baseUrl, session.id, lastApproval, editingApproval],
  );

  useKeyboard((key) => {
    if (key.ctrl && key.name === "c") {
      onQuit();
      return;
    }
    if (key.ctrl && key.name === "p") {
      setPaletteOpen((open) => !open);
      return;
    }
    if (setupOpen && modelChoices.length > 0) {
      if (/^[1-9]$/.test(key.name) && Number(key.name) <= modelChoices.length)
        setSelectedModelIndex(Number(key.name) - 1);
      if (key.name.toLowerCase() === "s") void saveVerifiedModel();
      return;
    }
    if (setupOpen && /^[1-5]$/.test(key.name)) {
      setPreset(Number(key.name));
      return;
    }
    if (lastApproval && !setupOpen) {
      const decision =
        key.name.toLowerCase() === "y"
          ? "approve"
          : key.name.toLowerCase() === "n"
            ? "reject"
            : key.name.toLowerCase() === "e"
              ? "edit"
              : undefined;
      if (decision === "edit") {
        setEditingApproval(true);
        return;
      }
      if (decision)
        void resolveApproval(baseUrl, session.id, lastApproval.gate_id, decision).then(() =>
          setResolvedGates((previous) => [...previous, lastApproval.gate_id]),
        );
      return;
    }
    if (!draft && /^[1-4]$/.test(key.name)) {
      const index = Number(key.name) - 1;
      if (index < 3) void submit(STARTERS[index]!);
      else setSetupOpen(true);
    }
    if (key.name === "tab" && fileMatches.length > 0) {
      const match = draft.match(/@([^\s]*)$/);
      if (match && composer.current) {
        const prefix = draft.slice(0, match.index);
        const completed = `${prefix}@${fileMatches[0]} `;
        composer.current.setText(completed);
        setDraft(completed);
      }
    }
  });

  const updateDraft = (value: string) => {
    setDraft(value);
    const mention = value.match(/@([^\s]*)$/);
    if (!mention) {
      setFileMatches([]);
      return;
    }
    void fetch(`${baseUrl}/api/workspace/files?q=${encodeURIComponent(mention[1] ?? "")}`)
      .then((response) => (response.ok ? response.json() : { files: [] }))
      .then((body: unknown) => setFileMatches((body as { files?: string[] }).files ?? []))
      .catch(() => setFileMatches([]));
  };

  const verifyAndSave = async (entry: string) => {
    const fields = entry.split("|");
    const chosen =
      preset === 1
        ? { provider: "openai", name: "openai" }
        : preset === 2
          ? { provider: "local", name: "ollama" }
          : preset === 3
            ? { provider: "generic", name: "vllm" }
            : preset === 4
              ? { provider: "generic", name: "litellm" }
              : { provider: "generic", name: "custom" };
    const base_url =
      fields[0]?.trim() ||
      (preset === 1
        ? "https://api.openai.com/v1"
        : preset === 2
          ? "http://localhost:11434/v1"
          : "");
    const api_key = fields[1]?.trim() ?? "";
    const model =
      fields[2]?.trim() || (preset === 2 ? "llama3.2" : preset === 1 ? "gpt-4.1-mini" : "");
    try {
      const verification = await fetch(`${baseUrl}/api/config/providers/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: chosen.provider, base_url, api_key, model }),
      });
      const diagnostic = (await verification.json()) as {
        ok?: boolean;
        models?: Array<{ id: string }>;
      };
      if (!verification.ok || !diagnostic.ok) {
        setInspector(`Provider check failed: ${JSON.stringify(diagnostic)}`);
        return;
      }
      const models = (diagnostic.models ?? []).map((entry) => entry.id);
      setPendingProfile({ name: chosen.name, provider: chosen.provider, base_url, api_key });
      setModelChoices(models.length ? models : [model]);
      setSelectedModelIndex(0);
      setInspector(`Provider verified · ${models.length || 1} model(s) fetched`);
    } catch (error) {
      setInspector(error instanceof Error ? error.message : "Provider setup failed");
    }
  };

  async function saveVerifiedModel(): Promise<void> {
    if (!pendingProfile) return;
    const model = modelChoices[selectedModelIndex];
    if (!model) return;
    const saved = await fetch(`${baseUrl}/api/config/providers`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...pendingProfile, model, make_default: true }),
    });
    if (!saved.ok) {
      setInspector(`Saving provider returned HTTP ${saved.status}`);
      return;
    }
    setProviders([
      { id: pendingProfile.provider, model, baseUrl: pendingProfile.base_url, configured: true },
    ]);
    setSetupOpen(false);
    setModelChoices([]);
    setInspector(`Connected to ${pendingProfile.name} · ${model}`);
  }

  const telemetry = view.usage
    ? `CTX ${"█".repeat(Math.max(0, Math.min(10, Math.round(view.usage.context_window_pct / 10))))}${"░".repeat(Math.max(0, 10 - Math.min(10, Math.round(view.usage.context_window_pct / 10))))} ${Math.round(view.usage.context_window_pct)}%   ${view.usage.prompt_tokens} in / ${view.usage.completion_tokens} out   ${view.usage.latency_ms}ms   $${view.usage.cost_usd.toFixed(4)}`
    : "CTX —   tokens —   latency —";
  const usageHistory = events
    .filter(
      (event): event is Extract<SessionEvent, { type: "telemetry.usage" }> =>
        event.type === "telemetry.usage",
    )
    .slice(-10);
  const latencySparkline = usageHistory
    .map((event) => "▁▂▃▄▅▆▇█"[Math.min(7, Math.floor(event.latency_ms / 500))])
    .join("");
  const provider = providers[0];
  const pane = (title: string, style: Record<string, unknown>, children: ReactNode[]) =>
    h(
      "box",
      { title, style: { border: true, flexDirection: "column", padding: 1, gap: 1, ...style } },
      ...children,
    );
  const messageLines = view.messages
    .slice(-14)
    .map((event) =>
      event.role === "assistant"
        ? h("markdown", { key: `m-${event.id}`, content: event.content, style: { flexGrow: 0 } })
        : h("text", { key: `m-${event.id}`, fg: "#7dd3fc" }, `You: ${event.content}`),
    );
  const toolLines = view.toolCards.map(({ start, result }) =>
    h(
      "text",
      {
        key: start.call_id,
        fg: result?.status === "failed" ? "#fb7185" : result ? "#86efac" : "#facc15",
        onClick: () =>
          setExpandedCall((current) => (current === start.call_id ? "" : start.call_id)),
      },
      `${result ? (result.status === "succeeded" ? "✓ Done" : "✗ Failed") : "◌ Running"} ${start.tool_name}${expandedCall === start.call_id && result ? ` · ${result.stdout || result.stderr}` : ""}`,
    ),
  );
  const dagLines = (view.dag?.nodes ?? []).map((node, index) =>
    h(
      "text",
      {
        key: node.id,
        fg: node.status === "done" ? "#86efac" : node.status === "blocked" ? "#fb7185" : "#facc15",
      },
      `${index > 0 ? "  |\n" : ""}${node.status === "done" ? "[x]" : node.status === "blocked" ? "[!]" : "[~]"} ${node.label}`,
    ),
  );

  const providerBadge = `${provider?.id ?? "provider?"}:${provider?.model ?? "model?"}${provider?.baseUrl ? ` · ${provider.baseUrl}` : ""}`;
  const children: ReactNode[] = [
    h(
      "text",
      { key: "telemetry", fg: "#67e8f9" },
      `HELIX  ${providerBadge}     ${telemetry}  ${latencySparkline}     ${status}`,
    ),
    h(
      "box",
      { key: "panes", style: { flexDirection: "row", flexGrow: 1, gap: 1 } },
      pane(
        "TASK DAG",
        { width: "24%" },
        dagLines.length ? dagLines : [h("text", { key: "empty-dag" }, "{ o }  No task yet")],
      ),
      pane("CHAT · TOOL CALLS", { flexGrow: 1 }, [
        ...(messageLines.length
          ? messageLines
          : [
              h(
                "text",
                { key: "empty" },
                "Helix helps run bounded coding tasks with isolated worktrees and mechanical gates.",
              ),
            ]),
        ...toolLines,
        ...(lastApproval
          ? [
              h(
                "text",
                { key: "approval", fg: "#fbbf24" },
                `APPROVAL REQUIRED · ${lastApproval.command_or_path}   [Y] Approve  [N] Reject  [E] Edit`,
              ),
            ]
          : []),
      ]),
      pane("INSPECTOR", { width: "24%" }, [
        h("text", { key: "inspector" }, inspector),
        h("text", { key: "nav", fg: "#94a3b8" }, "/dag  /diff  /doctor"),
        ...(paletteOpen
          ? [
              h(
                "text",
                { key: "palette", fg: "#c4b5fd" },
                "COMMAND PALETTE\n/provider  /model  /doctor  /dag  /diff  /clear",
              ),
            ]
          : []),
        ...(setupOpen
          ? [
              h(
                "text",
                { key: "setup", fg: "#f0abfc" },
                `PROVIDER SETUP · choose [1] OpenAI [2] Ollama [3] vLLM [4] LiteLLM [5] Custom\nSelected preset: ${preset}\nEnter base_url | api_key | model below; submit to verify and save.`,
              ),
            ]
          : []),
        ...(fileMatches.length
          ? [
              h(
                "text",
                { key: "files", fg: "#a5b4fc" },
                `@ files · Tab to attach\n${fileMatches.slice(0, 5).join("\n")}`,
              ),
            ]
          : []),
        ...(draft.startsWith("/")
          ? [
              h(
                "text",
                { key: "autocomplete", fg: "#c4b5fd" },
                SLASH_COMMANDS.filter((command) =>
                  command.startsWith(draft.split(/\s/)[0] ?? ""),
                ).join("  "),
              ),
            ]
          : []),
      ]),
    ),
    h(
      "box",
      {
        key: "composer-wrap",
        title: "MESSAGE · Ctrl+Enter to send",
        style: { height: 6, border: true, paddingX: 1 },
      },
      h("textarea", {
        ref: composer,
        focused: true,
        placeholder: editingApproval
          ? "Enter the edited command or path"
          : setupOpen
            ? "base_url | api_key | model"
            : "Ask Helix…  / commands · @ attach files",
        onContentChange: () => updateDraft(composer.current?.plainText ?? ""),
        onSubmit: () => {
          void (setupOpen ? verifyAndSave(draft) : submit(draft));
        },
      }),
    ),
    h(
      "text",
      { key: "footer", fg: "#94a3b8" },
      "[1–3] start   [4] provider   Ctrl+P palette   / commands   @ files   Ctrl+C quit",
    ),
  ];
  return h(
    "box",
    {
      style: {
        flexDirection: "column",
        flexGrow: 1,
        backgroundColor: "#0b1220",
        padding: 1,
        gap: 1,
      },
    },
    ...children,
    ...(lastApproval
      ? [
          h(
            "box",
            {
              key: "approval-modal",
              title: "APPROVAL REQUIRED",
              style: {
                position: "absolute",
                left: "25%",
                top: "35%",
                width: "50%",
                border: true,
                padding: 2,
                backgroundColor: "#451a03",
                flexDirection: "column",
                gap: 1,
              },
            },
            h(
              "text",
              { fg: "#fef3c7" },
              `${lastApproval.action_type}: ${lastApproval.command_or_path}`,
            ),
            h(
              "text",
              { fg: "#fde68a" },
              `Risk: ${lastApproval.risk_level}   [Y] Approve   [N] Reject   [E] Edit`,
            ),
          ),
        ]
      : []),
    ...(setupOpen
      ? [
          h(
            "box",
            {
              key: "setup-modal",
              title: "PROVIDER SETUP",
              style: {
                position: "absolute",
                left: "20%",
                top: "25%",
                width: "60%",
                border: true,
                padding: 2,
                backgroundColor: "#312e81",
                flexDirection: "column",
                gap: 1,
              },
            },
            h(
              "text",
              { fg: "#e0e7ff" },
              `Pick preset [1] OpenAI [2] Ollama [3] vLLM [4] LiteLLM [5] Custom · selected ${preset}`,
            ),
            h(
              "text",
              { fg: "#e0e7ff" },
              modelChoices.length
                ? `Models fetched · choose [1-${Math.min(9, modelChoices.length)}], then [S] save\n${modelChoices
                    .slice(0, 9)
                    .map(
                      (model, index) =>
                        `${index === selectedModelIndex ? "›" : " "} [${index + 1}] ${model}`,
                    )
                    .join("\n")}`
                : "Enter base_url | api_key | model below; Helix verifies before saving.",
            ),
          ),
        ]
      : []),
  );
}

async function resolveApproval(
  baseUrl: string,
  sessionId: string,
  gateId: string,
  decision: "approve" | "reject" | "edit",
): Promise<void> {
  await fetch(`${baseUrl}/api/sessions/${sessionId}/approve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ gateId, decision }),
  });
}
