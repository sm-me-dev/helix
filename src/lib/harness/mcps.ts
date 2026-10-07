import type { McpId } from "./types";

export type Mcp = {
  id: McpId;
  name: string;
  maintainer: string;
  job: string;
  tools: string[];
  schemaTokens: number;
  skipIf: string;
  defaultOn: boolean;
  config: string;
};

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
    config: `{
  "graphify": {
    "command": "uvx",
    "args": ["--from", "graphifyy[mcp]", "graphify-mcp"]
  }
}`,
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
    config: `{
  "context7": {
    "url": "https://mcp.context7.com/mcp"
  }
}`,
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
    config: `{
  "playwright": {
    "command": "npx",
    "args": ["@playwright/mcp@latest"]
  }
}`,
  },
  {
    id: "github",
    name: "GitHub",
    maintainer: "GitHub",
    job: "Issues, PRs, and Actions. Enable only the toolsets you use — the full catalog is expensive.",
    tools: ["issues", "pull_requests", "actions"],
    schemaTokens: 1680,
    skipIf: "You already have \`gh\` and a single local repo.",
    defaultOn: false,
    config: `{
  "github": {
    "url": "https://api.githubcopilot.com/mcp/",
    "headers": { "X-MCP-Toolsets": "issues,pull_requests" }
  }
}`,
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
    config: `{
  "serena": {
    "command": "uvx",
    "args": ["--from", "git+https://github.com/oraios/serena", "serena", "start-mcp-server"]
  }
}`,
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
    config: `{
  "chrome-devtools": {
    "command": "npx",
    "args": ["chrome-devtools-mcp@latest"]
  }
}`,
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
    config: `{
  "sentry": {
    "url": "https://mcp.sentry.dev/mcp"
  }
}`,
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
    config: `{
  "linear": {
    "url": "https://mcp.linear.app/mcp"
  }
}`,
  },
];

export const MCP_BY_ID = Object.fromEntries(MCPS.map((m) => [m.id, m])) as Record<McpId, Mcp>;

export const DEFAULT_MCPS: McpId[] = MCPS.filter((m) => m.defaultOn).map((m) => m.id);
