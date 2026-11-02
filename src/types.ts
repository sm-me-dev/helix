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
  /** Claude Code only: the Helix plugin (`helix plugin`) supplies agents, skills, hooks
   * and MCP config, so the repo pack writes only what a plugin cannot ship: CLAUDE.md,
   * AGENTS.md, the gate, and the secret-deny permissions. Nothing is registered twice. */
  claudePlugin?: boolean;
  /** Claude Code only: start scout, architect and reviewer with `omitClaudeMd: true` (needs
   * Claude Code v2.1.271+), so they stop paying for AGENTS.md on every spawn and work from the
   * handoff card alone. OFF by default: the saving is static and measurable, the effect on
   * pass rate is not, until an eval arm says so (docs/DECISIONS.md, F7). */
  leanSubagents?: boolean;
  /** AGENTS.md carries only what an agent cannot cheaply discover: the detected commands, the
   * gate and the secret rule. No process prose, dispatch rules or repo overview. Basis: the ETH
   * Zurich study (arXiv 2602.11988) found generic or overview content in context files raised
   * cost ~20% with no resolution gain. Needs an eval arm before it can be a default
   * (docs/DECISIONS.md). Incompatible with a crew, whose role table has to live somewhere. */
  minimalInstructions?: boolean;
  /** Emit a CI workflow that runs the portable gate, the agent-agnostic backstop for platforms
   * whose hooks cannot enforce it. Only "github" exists; skipped for stacks it cannot install. */
  ci?: "github";
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
