import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, extname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  ApprovalDecision,
  ApprovalRequest,
  SessionEvent,
  SessionEventInput,
  SessionRuntime,
  SessionSnapshot,
  UICallback,
} from "./contracts.ts";
import {
  getGlobalProviderProfile,
  listGlobalProviderProfiles,
  saveGlobalProviderProfile,
  resolveAndSanitizeBaseUrl,
} from "../engine/config-loader.ts";
import { createLLMClient } from "../engine/providers/factory.ts";
import { doctorHandshake } from "../engine/doctor.ts";
import type { ProviderId } from "../engine/types.ts";

type SessionRecord = {
  snapshot: SessionSnapshot;
  events: SessionEvent[];
  listeners: Set<(event: SessionEvent) => void>;
  pendingApprovals: Map<string, (decision: ApprovalDecision) => void>;
  controller?: AbortController;
};

export type HelixDaemonOptions = {
  host?: string;
  port?: number;
  runtime?: SessionRuntime;
  webRoot?: string;
  workspaceRoot?: string;
};
export type RunningHelixDaemon = {
  server: Server;
  host: string;
  port: number;
  close(): Promise<void>;
};

export class SessionStore {
  private readonly sessions = new Map<string, SessionRecord>();

  create(): SessionSnapshot {
    const snapshot: SessionSnapshot = {
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      status: "idle",
      promptCount: 0,
    };
    this.sessions.set(snapshot.id, {
      snapshot,
      events: [],
      listeners: new Set(),
      pendingApprovals: new Map(),
    });
    return { ...snapshot };
  }

  get(sessionId: string): SessionSnapshot | undefined {
    const record = this.sessions.get(sessionId);
    return record ? { ...record.snapshot } : undefined;
  }

  list(): SessionSnapshot[] {
    return [...this.sessions.values()].map(({ snapshot }) => ({ ...snapshot }));
  }

  emit(sessionId: string, input: SessionEventInput): SessionEvent {
    const record = this.require(sessionId);
    const event = deepFreeze({
      ...structuredClone(input),
      id: record.events.length + 1,
      timestamp: new Date().toISOString(),
    }) as SessionEvent;
    record.events.push(event);
    for (const listener of record.listeners) listener(event);
    return event;
  }

  replay(sessionId: string, afterId = 0): SessionEvent[] {
    return this.require(sessionId).events.filter((event) => event.id > afterId);
  }

  subscribe(sessionId: string, listener: (event: SessionEvent) => void): () => void {
    const listeners = this.require(sessionId).listeners;
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  setStatus(sessionId: string, status: SessionSnapshot["status"]): void {
    this.require(sessionId).snapshot.status = status;
  }

  incrementPrompt(sessionId: string): void {
    const record = this.require(sessionId);
    record.snapshot.promptCount++;
  }

  setController(sessionId: string, controller?: AbortController): void {
    this.require(sessionId).controller = controller;
  }

  waitForApproval(sessionId: string, request: ApprovalRequest): Promise<ApprovalDecision> {
    const record = this.require(sessionId);
    const gateId = randomUUID();
    this.setStatus(sessionId, "waiting_approval");
    this.emit(sessionId, {
      type: "approval.required",
      gate_id: gateId,
      action_type: request.actionType,
      command_or_path: request.commandOrPath,
      risk_level: request.riskLevel,
      options: request.options ?? ["approve", "reject", "edit"],
    });
    return new Promise((resolve) => record.pendingApprovals.set(gateId, resolve));
  }

  resolveApproval(sessionId: string, decision: ApprovalDecision): boolean {
    const record = this.require(sessionId);
    const resolve = record.pendingApprovals.get(decision.gateId);
    if (!resolve) return false;
    record.pendingApprovals.delete(decision.gateId);
    resolve(decision);
    if (record.pendingApprovals.size === 0 && record.snapshot.status === "waiting_approval") {
      record.snapshot.status = "running";
    }
    return true;
  }

  cancel(sessionId: string): void {
    const record = this.require(sessionId);
    record.controller?.abort();
    for (const [gateId, resolve] of record.pendingApprovals) {
      resolve({ gateId, decision: "reject" });
      record.pendingApprovals.delete(gateId);
    }
    record.snapshot.status = "cancelled";
  }

  private require(sessionId: string): SessionRecord {
    const record = this.sessions.get(sessionId);
    if (!record) throw new HttpError(404, "Session not found");
    return record;
  }
}

export async function startHelixDaemon(
  options: HelixDaemonOptions = {},
): Promise<RunningHelixDaemon> {
  const host = options.host ?? "127.0.0.1";
  const requestedPort = options.port ?? 3000;
  const store = new SessionStore();
  const webRoot = options.webRoot ?? findBuiltWebRoot();
  const workspaceRoot = resolve(options.workspaceRoot ?? process.cwd());
  const server = createServer((request, response) => {
    void route(request, response, store, options.runtime, webRoot, host, workspaceRoot);
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(requestedPort, host, () => {
      server.removeListener("error", reject);
      resolve();
    });
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : requestedPort;
  return {
    server,
    host,
    port,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}

async function route(
  request: IncomingMessage,
  response: ServerResponse,
  store: SessionStore,
  runtime?: SessionRuntime,
  webRoot?: string,
  daemonHost = "127.0.0.1",
  workspaceRoot = process.cwd(),
): Promise<void> {
  try {
    if (!isAllowedHost(request.headers.host, daemonHost)) {
      return json(response, 403, { error: "Forbidden" });
    }
    const method = request.method ?? "GET";
    const origin = request.headers.origin;
    if (
      ["POST", "PUT", "PATCH", "DELETE"].includes(method) &&
      origin !== undefined &&
      !isAllowedOrigin(origin, daemonHost)
    ) {
      return json(response, 403, { error: "Forbidden" });
    }
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
    if (method === "GET" && url.pathname === "/health") return json(response, 200, { ok: true });
    if (method === "GET" && url.pathname === "/api/sessions")
      return json(response, 200, { sessions: store.list() });
    if (method === "POST" && url.pathname === "/api/sessions")
      return json(response, 201, { session: store.create() });
    if (method === "GET" && url.pathname === "/api/config/providers") {
      return json(response, 200, {
        providers: (await runtime?.providers?.()) ?? [],
        profiles: listGlobalProviderProfiles(),
      });
    }
    if (method === "GET" && url.pathname === "/api/workspace/files") {
      return json(response, 200, {
        files: findWorkspaceFiles(url.searchParams.get("q") ?? "", workspaceRoot),
      });
    }
    if (method === "POST" && url.pathname === "/api/config/providers/verify") {
      const body = (await readJson(request)) as Record<string, unknown>;
      const profileName = typeof body.name === "string" ? body.name : "";
      const saved = profileName ? getGlobalProviderProfile(profileName) : undefined;
      const provider = parseProviderId(body.provider ?? saved?.provider);
      const savedBaseUrl =
        saved?.base_url ?? (saved?.base_url_env ? process.env[saved.base_url_env] : undefined);
      const rawBaseUrl =
        typeof body.base_url === "string" && body.base_url.trim() ? body.base_url : savedBaseUrl;
      const baseUrl = resolveAndSanitizeBaseUrl(rawBaseUrl).baseUrl;
      const savedApiKey =
        saved?.api_key ?? (saved?.api_key_env ? process.env[saved.api_key_env] : undefined);
      const config = {
        providerId: provider,
        model: requiredString(body.model ?? saved?.model, "model"),
        baseUrl,
        apiKey: typeof body.api_key === "string" && body.api_key ? body.api_key : savedApiKey,
        defaultHeaders: parseHeaders(body.default_headers) ?? saved?.default_headers,
      };
      return json(
        response,
        200,
        await doctorHandshake(createLLMClient({ ...config, source: "runtime" })),
      );
    }
    if (method === "POST" && url.pathname === "/api/config/providers") {
      const body = (await readJson(request)) as Record<string, unknown>;
      const name = requiredString(body.name, "name");
      const provider = parseProviderId(body.provider);
      const baseUrl = resolveAndSanitizeBaseUrl(
        typeof body.base_url === "string" ? body.base_url : undefined,
      ).baseUrl;
      const profile = {
        provider,
        base_url: baseUrl,
        base_url_env: undefined,
        model: requiredString(body.model, "model"),
        ...(typeof body.api_key === "string" && body.api_key.length > 0
          ? { api_key: body.api_key, api_key_env: undefined }
          : {}),
        ...(parseHeaders(body.default_headers)
          ? { default_headers: parseHeaders(body.default_headers) }
          : {}),
      };
      const filePath = saveGlobalProviderProfile(name, profile, {
        makeDefault: body.make_default !== false,
      });
      return json(response, 201, {
        saved: true,
        name,
        provider,
        model: profile.model,
        base_url: profile.base_url,
        filePath,
      });
    }

    if (method === "GET" && !url.pathname.startsWith("/api/")) {
      if (serveWebAsset(url.pathname, request.headers.accept, response, webRoot)) return;
      return json(response, 404, {
        error: webRoot ? "Web asset not found" : "Web UI is not built; run npm run build:web",
      });
    }

    const match = url.pathname.match(
      /^\/api\/sessions\/([^/]+)(?:\/(events|prompt|approve|cancel|rollback))?$/,
    );
    if (!match) return json(response, 404, { error: "Route not found" });
    const sessionId = decodeURIComponent(match[1]!);
    const action = match[2];
    const snapshot = store.get(sessionId);
    if (!snapshot) return json(response, 404, { error: "Session not found" });
    if (!action && method === "GET") return json(response, 200, { session: snapshot });
    if (action === "events" && method === "GET")
      return streamEvents(request, response, store, sessionId, url);
    if (action === "prompt" && method === "POST") {
      if (!runtime) return json(response, 503, { error: "No session runtime is configured" });
      if (snapshot.status === "running" || snapshot.status === "waiting_approval")
        return json(response, 409, { error: "Session is already active" });
      const body = (await readJson(request)) as { prompt?: unknown };
      if (typeof body.prompt !== "string" || body.prompt.trim().length === 0)
        return json(response, 400, { error: "prompt must be a non-empty string" });
      const controller = new AbortController();
      store.setController(sessionId, controller);
      store.incrementPrompt(sessionId);
      store.setStatus(sessionId, "running");
      const callback: UICallback = {
        emit: (event) => store.emit(sessionId, event),
        requestApproval: (approval) => store.waitForApproval(sessionId, approval),
      };
      callback.emit({ type: "message.delta", role: "user", delta_text: body.prompt.trim() });
      void runtime.prompt(sessionId, body.prompt, callback, controller.signal).then(
        () => {
          if (!controller.signal.aborted) store.setStatus(sessionId, "completed");
        },
        () => {
          if (!controller.signal.aborted) store.setStatus(sessionId, "failed");
        },
      );
      return json(response, 202, { session: store.get(sessionId) });
    }
    if (action === "approve" && method === "POST") {
      const body = (await readJson(request)) as Partial<ApprovalDecision>;
      if (
        typeof body.gateId !== "string" ||
        !["approve", "reject", "edit"].includes(String(body.decision))
      )
        return json(response, 400, { error: "gateId and a valid decision are required" });
      if (
        body.decision === "edit" &&
        (typeof body.editedValue !== "string" || body.editedValue.trim().length === 0)
      )
        return json(response, 400, { error: "editedValue is required for an edit decision" });
      const resolved = store.resolveApproval(sessionId, body as ApprovalDecision);
      return resolved
        ? json(response, 200, { resolved: true })
        : json(response, 404, { error: "Approval gate not found or already resolved" });
    }
    if (action === "cancel" && method === "POST") {
      store.cancel(sessionId);
      await runtime?.cancel?.(sessionId);
      return json(response, 200, { cancelled: true });
    }
    if (action === "rollback" && method === "POST") {
      if (!runtime?.rollback)
        return json(response, 501, { error: "Task rollback is not available in this runtime" });
      const body = (await readJson(request)) as { taskId?: unknown };
      if (typeof body.taskId !== "string" || !/^[A-Za-z0-9_-]{1,120}$/.test(body.taskId)) {
        return json(response, 400, {
          error: "taskId must contain only letters, digits, underscores, or hyphens",
        });
      }
      const completedInSession = store
        .replay(sessionId)
        .some(
          (event) =>
            event.type === "dag.state.updated" &&
            event.nodes.some((node) => node.id === body.taskId && node.status === "done"),
        );
      if (!completedInSession)
        return json(response, 404, {
          error: "No completed task checkpoint exists in this session",
        });
      return json(response, 200, await runtime.rollback(sessionId, body.taskId));
    }
    return json(response, 405, { error: "Method not allowed" });
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    if (!response.headersSent)
      json(response, status, { error: error instanceof Error ? error.message : String(error) });
    else response.end();
  }
}

function findBuiltWebRoot(): string | undefined {
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const candidates = [resolve(moduleDir, "../../web"), resolve(moduleDir, "../../dist/web")];
  return candidates.find(
    (candidate) =>
      existsSync(resolve(candidate, "index.html")) && existsSync(resolve(candidate, "assets")),
  );
}

function serveWebAsset(
  pathname: string,
  accept: string | undefined,
  response: ServerResponse,
  webRoot?: string,
): boolean {
  if (!webRoot) return false;
  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(pathname);
  } catch {
    json(response, 400, { error: "Invalid URL path" });
    return true;
  }
  const root = resolve(webRoot);
  let filePath = resolve(root, "." + decodedPath);
  if (filePath !== root && !filePath.startsWith(root + sep)) {
    json(response, 403, { error: "Path is outside the web root" });
    return true;
  }
  if (!existsSync(filePath) || (existsSync(filePath) && statSync(filePath).isDirectory())) {
    if (decodedPath !== "/" && (extname(decodedPath) || (accept && !accept.includes("text/html"))))
      return false;
    filePath = resolve(root, "index.html");
  }
  if (!existsSync(filePath) || !statSync(filePath).isFile()) return false;
  const contentTypes: Record<string, string> = {
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".ico": "image/x-icon",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".map": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
  };
  response.writeHead(200, {
    "Content-Type": contentTypes[extname(filePath)] ?? "application/octet-stream",
    "Cache-Control": "no-cache",
  });
  response.end(readFileSync(filePath));
  return true;
}

function streamEvents(
  request: IncomingMessage,
  response: ServerResponse,
  store: SessionStore,
  sessionId: string,
  url: URL,
): void {
  const afterId = Number(request.headers["last-event-id"] ?? url.searchParams.get("after") ?? 0);
  response.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  response.write(": connected\n\n");
  const send = (event: SessionEvent) =>
    response.write(`id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
  for (const event of store.replay(sessionId, Number.isFinite(afterId) ? afterId : 0)) send(event);
  const unsubscribe = store.subscribe(sessionId, send);
  const heartbeat = setInterval(() => response.write(": keepalive\n\n"), 15_000);
  const close = () => {
    clearInterval(heartbeat);
    unsubscribe();
  };
  request.on("close", close);
  response.on("close", close);
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += Buffer.byteLength(chunk);
    if (size > 1_000_000) throw new HttpError(413, "Request body exceeds 1 MB");
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "Request body must be valid JSON");
  }
}

function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(body));
}

function parseProviderId(value: unknown): ProviderId {
  if (
    value === "anthropic" ||
    value === "openai" ||
    value === "google" ||
    value === "local" ||
    value === "generic"
  )
    return value;
  throw new HttpError(400, "provider must be anthropic, openai, google, local, or generic");
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0)
    throw new HttpError(400, `${label} must be a non-empty string`);
  return value.trim();
}

function parseHeaders(value: unknown): Record<string, string> | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new HttpError(400, "default_headers must be an object of strings");
  const headers: Record<string, string> = {};
  for (const [key, headerValue] of Object.entries(value)) {
    if (typeof headerValue !== "string" || /[\r\n]/.test(key + headerValue))
      throw new HttpError(400, "default_headers must contain safe string values");
    headers[key] = headerValue;
  }
  return headers;
}

function isAllowedHost(authority: string | undefined, daemonHost: string): boolean {
  if (!authority || /[\s/@?#]/u.test(authority)) return false;
  try {
    const parsed = new URL(`http://${authority}`);
    if (
      parsed.username ||
      parsed.password ||
      parsed.pathname !== "/" ||
      parsed.search ||
      parsed.hash
    )
      return false;
    return isAllowedHostname(parsed.hostname, daemonHost);
  } catch {
    return false;
  }
}

function isAllowedOrigin(origin: string, daemonHost: string): boolean {
  try {
    const parsed = new URL(origin);
    if (
      (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
      parsed.username ||
      parsed.password ||
      parsed.pathname !== "/" ||
      parsed.search ||
      parsed.hash
    ) {
      return false;
    }
    return isAllowedHostname(parsed.hostname, daemonHost);
  } catch {
    return false;
  }
}

function isAllowedHostname(hostname: string, daemonHost: string): boolean {
  const normalize = (value: string) => value.toLowerCase().replace(/^\[|\]$/gu, "");
  const host = normalize(hostname);
  const configured = normalize(daemonHost);
  return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === configured;
}

function findWorkspaceFiles(query: string, workspaceRoot: string): string[] {
  const root = resolve(workspaceRoot);
  const ignored = new Set([".git", "node_modules", ".helix-work", "dist", "coverage"]);
  const matches: string[] = [];
  let visited = 0;
  const walk = (directory: string) => {
    if (visited >= 10_000 || matches.length >= 100) return;
    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (visited++ >= 10_000 || matches.length >= 100) return;
      if (entry.isDirectory() && ignored.has(entry.name)) continue;
      const absolute = resolve(directory, entry.name);
      if (entry.isDirectory()) walk(absolute);
      else if (entry.isFile()) {
        const file = relative(root, absolute).split(sep).join("/");
        if (fuzzyMatch(file.toLowerCase(), query.toLowerCase())) matches.push(file);
      }
    }
  };
  walk(root);
  return matches.sort((a, b) => a.length - b.length || a.localeCompare(b)).slice(0, 40);
}

function fuzzyMatch(value: string, query: string): boolean {
  if (!query) return true;
  let queryIndex = 0;
  for (const character of value) if (character === query[queryIndex]) queryIndex++;
  return queryIndex === query.length;
}

function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
