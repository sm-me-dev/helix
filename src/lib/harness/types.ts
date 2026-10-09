export type CrewId = "scout" | "architect" | "builder" | "reviewer";

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

export type SkillId = "graph-first" | "hook-guards";

export type McpId =
  | "graphify"
  | "context7"
  | "playwright"
  | "github"
  | "serena"
  | "chrome-devtools"
  | "sentry"
  | "linear";

export type HarnessConfig = {
  crew: CrewId[];
  skills: SkillId[];
  mcps: McpId[];
  platforms: PlatformId[];
  graphFirst: boolean;
  progressiveDisclosure: boolean;
  defaultSingleAgent: boolean;
  hooksEnabled: boolean;
  /** Learning Ledger (Phase E): evidence-gated and OFF by default. When true,
   * the pack points at `.helix/learn/COMPILED.md` (compiled, capped ledger
   * output). The ledger stays opt-in until a replay eval shows tokens per
   * passing task falling without lowering pass rate. */
  learnOptIn?: boolean;
  /** Detected repo facts from `helix init` (cli/lib detectStack). Optional so
   * hand-built configs keep working; when present AGENTS.md cites exact
   * commands instead of telling the agent to go read package.json. */
  stack?: RepoFacts;
};

/** Repo-specific, non-inferable facts. No timestamps — the always-on prefix
 * must stay stable for cache-friendliness. */
export type RepoFacts = {
  language: string;
  packageManager: string;
  testCommand: string | null;
  lintCommand: string | null;
  formatCommand: string | null;
};

export type TokenCheck = {
  id: string;
  label: string;
  pass: boolean;
};

export type TokenBreakdown = {
  agentsMd: number;
  skillIndex: number;
  mcpSchemas: number;
  crewIndex: number;
  alwaysOn: number;
  naiveAlwaysOn: number;
  /** Pass/fail checks the score is derived from — render these, not the bare number. */
  checks: TokenCheck[];
  /** Percent of checks passing. Derived, not a formula. */
  leanScore: number;
  /** Parts of the numbers that are estimates or fixtures, with reasons. */
  estimates: string[];
  /** Tokenizer method all counts share. */
  method: string;
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

export type PackFile = {
  path: string;
  language: string;
  body: string;
};
