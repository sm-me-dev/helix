import measurements from "./mcp-measurements.json" with { type: "json" };
import type { McpId } from "./types";

export type McpStdio = { kind: "stdio"; command: string; args: string[] };
export type McpRemote = { kind: "remote"; url: string; headers?: Record<string, string> };
export type McpServerConfig = McpStdio | McpRemote;

export type Mcp = {
  id: McpId;
  name: string;
  maintainer: string;
  job: string;
  tools: string[];
  schemaTokens: number;
  skipIf: string;
  defaultOn: boolean;
  /** Structured server configs. Serializers per platform build the JSON/TOML. */
  servers: Record<string, McpServerConfig>;
  /** Vendor docs URL for this server's install shape. */
  source: string;
  /** Date the shape/version below was checked. Null = carried over, not re-checked. */
  verifiedAt: string | null;
};

const V = "2026-10-07";

export const MCPS: Mcp[] = [
  {
    id: "graphify",
    name: "Graphify",
    maintainer: "Graphify Labs",
    job: "Code + docs knowledge graph. Who calls this, what a change reaches, without loading the repo.",
    tools: [
      "query_graph",
      "get_node",
      "get_neighbors",
      "shortest_path",
      "explain",
      "list_prs",
      "get_pr_impact",
      "triage_prs",
    ],
    schemaTokens: 980,
    skipIf: "The repo is under ~20 files and already fits in one read.",
    defaultOn: true,
    servers: {
      graphify: {
        kind: "stdio",
        command: "uvx",
        args: ["--from", "graphifyy[mcp]", "graphify-mcp"],
      },
    },
    source: "carried over from previous catalog; install shape not re-checked against vendor docs",
    verifiedAt: null,
  },
  {
    id: "context7",
    name: "Context7",
    maintainer: "Upstash",
    job: "Version-accurate library docs so the model stops quoting last year's API.",
    tools: ["resolve-library-id", "query-docs"],
    schemaTokens: 420,
    skipIf: "The stack is frozen and the in-repo examples are enough.",
    defaultOn: true,
    servers: {
      context7: { kind: "remote", url: "https://mcp.context7.com/mcp" },
    },
    source:
      "carried over from previous catalog; endpoint not re-fetched (identifier only, no network in pack)",
    verifiedAt: null,
  },
  {
    id: "playwright",
    name: "Playwright",
    maintainer: "Microsoft",
    job: "A real browser for the Prover and Auditor. Compiling is not the same as the flow working.",
    tools: ["navigate", "click", "fill", "snapshot", "console"],
    schemaTokens: 1320,
    skipIf: "No UI, or tests already drive the browser in CI.",
    defaultOn: true,
    servers: {
      playwright: { kind: "stdio", command: "npx", args: ["@playwright/mcp@0.0.83"] },
    },
    source: "https://www.npmjs.com/package/@playwright/mcp (version lookup)",
    verifiedAt: V,
  },
  {
    id: "github",
    name: "GitHub",
    maintainer: "GitHub",
    job: "Issues, PRs, and Actions. Read-only toolsets by default — the full catalog is expensive.",
    tools: ["issues", "pull_requests", "actions"],
    schemaTokens: 1680,
    skipIf: "You already have `gh` and a single local repo.",
    defaultOn: false,
    servers: {
      github: {
        kind: "remote",
        url: "https://api.githubcopilot.com/mcp/",
        headers: { "X-MCP-Toolsets": "issues,pull_requests" },
      },
    },
    source: "carried over from previous catalog; read-only toolsets kept, endpoint not re-fetched",
    verifiedAt: null,
  },
  {
    id: "serena",
    name: "Serena",
    maintainer: "Oraios",
    job: "LSP as tools: go-to-def, refs, rename. Complements Graphify on symbol-precise edits.",
    tools: ["find_symbol", "find_referencing_symbols", "rename"],
    schemaTokens: 860,
    skipIf: "Graphify neighbors already give you the call sites.",
    defaultOn: false,
    servers: {
      serena: {
        kind: "stdio",
        command: "uvx",
        args: [
          "--from",
          "git+https://github.com/oraios/serena@v1.7.0",
          "serena",
          "start-mcp-server",
        ],
      },
    },
    source: "https://github.com/oraios/serena (latest tag lookup)",
    verifiedAt: V,
  },
  {
    id: "chrome-devtools",
    name: "Chrome DevTools",
    maintainer: "Google",
    job: "Performance traces, console, and network for front-end debugging.",
    tools: ["performance", "console", "network"],
    schemaTokens: 1100,
    skipIf: "You are not chasing a runtime or perf bug in the browser.",
    defaultOn: false,
    servers: {
      "chrome-devtools": { kind: "stdio", command: "npx", args: ["chrome-devtools-mcp@1.10.1"] },
    },
    source: "https://www.npmjs.com/package/chrome-devtools-mcp (version lookup)",
    verifiedAt: V,
  },
  {
    id: "sentry",
    name: "Sentry",
    maintainer: "Sentry",
    job: "Production error context so the Scout starts from a real stack, not a guess.",
    tools: ["list_issues", "get_issue", "seer"],
    schemaTokens: 940,
    skipIf: "You are not diagnosing production failures.",
    defaultOn: false,
    servers: {
      sentry: { kind: "remote", url: "https://mcp.sentry.dev/mcp" },
    },
    source:
      "carried over from previous catalog; endpoint not re-fetched (identifier only, no network in pack)",
    verifiedAt: null,
  },
  {
    id: "linear",
    name: "Linear",
    maintainer: "Linear",
    job: "Ticket intake with comments and acceptance criteria, instead of a pasted title.",
    tools: ["get_issue", "list_issues", "create_comment"],
    schemaTokens: 780,
    skipIf: "The ask already includes the full brief.",
    defaultOn: false,
    servers: {
      linear: { kind: "remote", url: "https://mcp.linear.app/mcp" },
    },
    source:
      "carried over from previous catalog; endpoint not re-fetched (identifier only, no network in pack)",
    verifiedAt: null,
  },
];

export const MCP_BY_ID = Object.fromEntries(MCPS.map((m) => [m.id, m])) as Record<McpId, Mcp>;

export const DEFAULT_MCPS: McpId[] = MCPS.filter((m) => m.defaultOn).map((m) => m.id);

export const MEASUREMENT_STALE_DAYS = 60;

type Measurement = {
  tokens: number | null;
  version: string | null;
  measuredAt: string | null;
  method: string;
};

function measurement(id: McpId): Measurement | null {
  const all = (measurements as { servers: Partial<Record<McpId, Measurement>> }).servers;
  return all[id] ?? null;
}

export function mcpMeasurementFresh(id: McpId, now: number = Date.now()): boolean {
  const m = measurement(id);
  if (!m || typeof m.tokens !== "number" || !m.measuredAt) return false;
  return now - Date.parse(m.measuredAt) < MEASUREMENT_STALE_DAYS * 86400 * 1000;
}

/** A fresh tools/list measurement wins; otherwise the catalog estimate (flagged). */
export function mcpSchemaTokens(
  id: McpId,
  now: number = Date.now(),
): { tokens: number; measured: boolean } {
  const m = measurement(id);
  if (mcpMeasurementFresh(id, now) && typeof m?.tokens === "number") {
    return { tokens: m.tokens, measured: true };
  }
  return { tokens: MCP_BY_ID[id].schemaTokens, measured: false };
}

/** Portable shape (Claude Code .mcp.json, Cursor .cursor/mcp.json): `mcpServers`, no type field. */
export function portableServers(ids: McpId[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const id of ids) {
    for (const [name, s] of Object.entries(MCP_BY_ID[id].servers)) {
      out[name] =
        s.kind === "stdio"
          ? { command: s.command, args: s.args }
          : { url: s.url, ...(s.headers ? { headers: s.headers } : {}) };
    }
  }
  return out;
}

/** VS Code shape (.vscode/mcp.json): `servers`, with a required `type` on each. */
export function vscodeServers(ids: McpId[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const id of ids) {
    for (const [name, s] of Object.entries(MCP_BY_ID[id].servers)) {
      out[name] =
        s.kind === "stdio"
          ? { type: "stdio", command: s.command, args: s.args }
          : { type: "http", url: s.url, ...(s.headers ? { headers: s.headers } : {}) };
    }
  }
  return out;
}

export function portableMcpJson(ids: McpId[]): string {
  return JSON.stringify({ mcpServers: portableServers(ids) }, null, 2) + "\n";
}

export function vscodeMcpJson(ids: McpId[]): string {
  return JSON.stringify({ servers: vscodeServers(ids) }, null, 2) + "\n";
}

/** Codex shape (.codex/config.toml): `[mcp_servers.<name>]` tables. */
export function codexToml(ids: McpId[]): string {
  const lines: string[] = [];
  for (const id of ids) {
    for (const [name, s] of Object.entries(MCP_BY_ID[id].servers)) {
      lines.push(`[mcp_servers.${name}]`);
      if (s.kind === "stdio") {
        lines.push(`command = ${JSON.stringify(s.command)}`);
        lines.push(`args = ${JSON.stringify(s.args)}`);
      } else {
        lines.push(`url = ${JSON.stringify(s.url)}`);
      }
    }
  }
  return lines.join("\n") + "\n";
}
