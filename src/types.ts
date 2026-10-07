export type CrewId =
  | "conductor"
  | "scout"
  | "architect"
  | "builder"
  | "prover"
  | "auditor";

export type PlatformId =
  | "claude-code"
  | "cursor"
  | "codex"
  | "gemini"
  | "copilot"
  | "windsurf"
  | "cline"
  | "aider"
  | "opencode"
  | "antigravity"
  | "devin"
  | "factory"
  | "kiro"
  | "amp"
  | "kilo";

export type SkillId =
  | "graph-first"
  | "clarify-brief"
  | "decision-table"
  | "scoped-diff"
  | "prove-behavior"
  | "independent-audit"
  | "lean-handoff"
  | "hook-guards";

export type McpId =
  | "graphify"
  | "context7"
  | "playwright"
  | "github"
  | "serena"
  | "chrome-devtools"
  | "sentry"
  | "linear";

export type LspId =
  | "serena-lsp"
  | "typescript"
  | "pyright"
  | "rust-analyzer"
  | "gopls";

export type HarnessConfig = {
  crew: CrewId[];
  skills: SkillId[];
  mcps: McpId[];
  lsps: LspId[];
  platforms: PlatformId[];
  graphFirst: boolean;
  progressiveDisclosure: boolean;
  defaultSingleAgent: boolean;
  hooksEnabled: boolean;
};

export type TokenBreakdown = {
  agentsMd: number;
  skillIndex: number;
  mcpSchemas: number;
  lspSchemas: number;
  crewIndex: number;
  alwaysOn: number;
  naiveAlwaysOn: number;
  leanScore: number;
};

export type GraphNode = {
  id: string;
  label: string;
  kind: "fn" | "mod" | "test" | "type" | "cfg";
  x: number;
  y: number;
};

export type GraphEdge = {
  from: string;
  to: string;
  kind: "calls" | "imports" | "tests";
};

export type SimEvent = {
  t: number;
  role: CrewId | "system";
  title: string;
  body: string;
  tokens: number;
  naiveTokens: number;
  tool?: string;
  files?: string[];
};
