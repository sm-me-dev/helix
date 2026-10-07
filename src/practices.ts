export type Practice = {
  id: string;
  chapter: string;
  title: string;
  rule: string;
  why: string;
  doThis: string;
  notThis: string;
};

export const PRACTICES: Practice[] = [
  {
    id: "toc",
    chapter: "Context",
    title: "AGENTS.md is a table of contents",
    rule: "Keep the always-on file under ~100 lines. Every extra line competes with the task.",
    why: "ETH Zurich (2026) found every context file raised step count and cost; HumanLayer and OpenAI both collapsed their root files to a short checklist. Long files rot and dilute attention.",
    doThis: "Commands the agent cannot guess, invariants that failed before, pointers to skills.",
    notThis: "A style guide, an architecture novel, or anything the agent can see by opening a file.",
  },
  {
    id: "earn",
    chapter: "Context",
    title: "Earn each line from a failure",
    rule: "A rule that cannot be traced to a miss does not belong in the harness.",
    why: "O'Reilly's harness-engineering note: downloaded rule packs spend 14–22% more reasoning tokens to 'obey' noise. The best source of harness text is your own past sessions.",
    doThis: "After an incident, add one line or one skill. Ratchet.",
    notThis: "Paste a 400-line 'best practices' gist on day one.",
  },
  {
    id: "disclose",
    chapter: "Context",
    title: "Progressive disclosure",
    rule: "Identity and scope stay loaded. Procedures live in skills and references, opened on demand.",
    why: "Claude Code's claude-api skill dropped from 200k to ~25k tokens by moving docs out of the always-on layer. Subagents multiply whatever you leave in the definition.",
    doThis: "SKILL.md frontmatter (~60 tokens) always visible; body and references/ only when relevant.",
    notThis: "One CLAUDE.md that inlines every runbook.",
  },
  {
    id: "graph",
    chapter: "Context",
    title: "Ask the graph, not the filesystem",
    rule: "Graphify (or equivalent) is the map. Grep is a last resort.",
    why: "Graphify's mixed-corpus number is 71× fewer tokens per query than raw file reads. PreToolUse hooks can redirect large Reads toward query_graph.",
    doThis: "query_graph → shortest_path → read the cited range.",
    notThis: "Glob src/** and hope the right file is in the first 15.",
  },
  {
    id: "single",
    chapter: "Crew",
    title: "Default to one agent",
    rule: "Fan out only when subtasks do not share types, names, or call sites, and a cheap test can accept the result.",
    why: "Anthropic's multi-agent research system used ~15× the tokens of a chat. Recursive harnesses are conditional, not a personality.",
    doThis: "Scout in isolation when the surface is unknown; Builder in isolation when the plan is locked.",
    notThis: "Six teammates talking to each other about a 20-line fix.",
  },
  {
    id: "handoff",
    chapter: "Crew",
    title: "The delegation message is the interface",
    rule: "Subagent descriptions stay one sentence in the parent. Detail lives in the role body, loaded on run. Handoffs are 12-line cards.",
    why: "Claude Code warns when combined subagent descriptions cross 15k tokens — they sit in the parent all session. State does not belong in AGENTS.md.",
    doThis: "Goal, constraints, cited files, done-means, out of scope.",
    notThis: "Paste the last forty turns 'for context'.",
  },
  {
    id: "isolate",
    chapter: "Crew",
    title: "Auditor never shares a window with Builder",
    rule: "Verification that can see the chain of thought will agree with it.",
    why: "Thoughtworks' harness pattern splits guides (before) from sensors (after). Independent audit is the cheapest high-value fan-out you can buy.",
    doThis: "Fresh subagent, plan + diff + test output only.",
    notThis: "Ask the same session 'does this look good?'.",
  },
  {
    id: "tools",
    chapter: "Tools",
    title: "Strip tools until success rises",
    rule: "Four or five MCPs beat twenty. Each schema is paid on every turn.",
    why: "Vercel stripped 80% of an agent's tools and watched success go 80% → 100% while tokens halved and latency fell 724s → 141s. Microsoft collapsed 100 tools into two.",
    doThis: "Graphify + Context7 + Playwright. Add GitHub only with a tight toolset.",
    notThis: "Filesystem, Fetch, Sequential Thinking on a coding agent that already has them.",
  },
  {
    id: "hooks",
    chapter: "Tools",
    title: "Deterministic work is a hook",
    rule: "Put a control in the most mechanical layer that can express it.",
    why: "A sentence in AGENTS.md that says 'never read .env' is advice. A deny rule is a guarantee. Format, lint, and secret scans should not cost model tokens.",
    doThis: "Hooks for format/lint/deny. Prompts for naming and architecture intent.",
    notThis: "A skill that reminds the model to run prettier.",
  },
  {
    id: "shift",
    chapter: "Quality",
    title: "Shift left the check, not the prompt",
    rule: "Linters, tests, and evals are cheaper than a smarter model on the next turn.",
    why: "Google's Agent Factory 2026 recap: the stack is model + harness + knowledge. Flash-class models become enough when the harness holds the rails.",
    doThis: "Prover runs the repo's real test command. Auditor checks the plan, not the vibes.",
    notThis: "A longer system prompt hoping the model 'be more careful'.",
  },
  {
    id: "software",
    chapter: "Quality",
    title: "The harness is software",
    rule: "Version it, review it, delete from it. One source, symlinked into CLAUDE.md / GEMINI.md / CONVENTIONS.md.",
    why: "AGENTS.md was donated to the Linux Foundation's Agentic AI Foundation in 2025 alongside MCP. Drift across eight copies is how teams lose the plot.",
    doThis: "AGENTS.md is real. Everything else is a pointer. Skills are reviewed like code.",
    notThis: "A different 800-line rules file in every vendor's folder.",
  },
];
