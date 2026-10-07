export type PracticeConfidence = "verified" | "reported" | "unverified";

export type Practice = {
  id: string;
  chapter: string;
  title: string;
  rule: string;
  why: string;
  doThis: string;
  notThis: string;
  /** Links backing the empirical claims in `why`. Empty = principle, no study cited. */
  sources: { title: string; url: string }[];
  /**
   * verified: checked against the primary source on 2026-10-07.
   * reported: repeated from a secondary synthesis, primary not confirmed.
   * unverified: guidance from practice; do not quote as a finding.
   */
  confidence: PracticeConfidence;
};

export const PRACTICES: Practice[] = [
  {
    id: "toc",
    chapter: "Context",
    title: "AGENTS.md is a table of contents",
    rule: "Keep the always-on file under ~100 lines. Every extra line competes with the task.",
    why: "ETH Zurich/SRI (Gloaguen et al., ICLR 2026 workshop): context files did not raise task success rates and added 20%+ inference cost. Minimal requirements beat comprehensive overviews.",
    doThis: "Commands the agent cannot guess, invariants that failed before, pointers to skills.",
    notThis:
      "A style guide, an architecture novel, or anything the agent can see by opening a file.",
    sources: [
      {
        title: "Evaluating AGENTS.md (Gloaguen et al., arXiv 2602.11988)",
        url: "https://arxiv.org/abs/2602.11988",
      },
    ],
    confidence: "verified",
  },
  {
    id: "earn",
    chapter: "Context",
    title: "Earn each line from a failure",
    rule: "A rule that cannot be traced to a miss does not belong in the harness.",
    why: "Context-file studies report 14–22% more reasoning tokens spent 'obeying' noise, without resolution gains. The best source of harness text is your own past sessions.",
    doThis: "After an incident, add one line or one skill. Ratchet.",
    notThis: "Paste a 400-line 'best practices' gist on day one.",
    sources: [
      {
        title: "Evaluating AGENTS.md (Gloaguen et al., arXiv 2602.11988)",
        url: "https://arxiv.org/abs/2602.11988",
      },
      {
        title: "Harness engineering synthesis (secondary, 14–22% figure)",
        url: "https://gist.github.com/owainlewis/2daeda1ec58c2c0e81569513f87d4e6d",
      },
    ],
    confidence: "reported",
  },
  {
    id: "disclose",
    chapter: "Context",
    title: "Progressive disclosure",
    rule: "Identity and scope stay loaded. Procedures live in skills and references, opened on demand.",
    why: "Vendor-reported example: moving docs out of one always-on skill cut it from ~200k to ~25k tokens (unconfirmed here — treat as direction, not data). Subagents multiply whatever you leave in the definition.",
    doThis:
      "SKILL.md frontmatter (~60 tokens) always visible; body and references/ only when relevant.",
    notThis: "One CLAUDE.md that inlines every runbook.",
    sources: [],
    confidence: "unverified",
  },
  {
    id: "graph",
    chapter: "Context",
    title: "Ask the graph, not the filesystem",
    rule: "Graphify (or equivalent) is the map. Grep is a last resort.",
    why: "Graphify's mixed-corpus benchmark: 71.5× fewer tokens per query than raw file reads on a 52-file corpus (reproducible corpora in-repo; ~1× on tiny repos — compression scales with corpus size).",
    doThis: "query_graph → shortest_path → read the cited range.",
    notThis: "Glob src/** and hope the right file is in the first 15.",
    sources: [
      {
        title: "Graphify README benchmarks",
        url: "https://github.com/Graphify-Labs/graphify/blob/main/README.md",
      },
    ],
    confidence: "verified",
  },
  {
    id: "single",
    chapter: "Crew",
    title: "Default to one agent",
    rule: "Fan out only when subtasks do not share types, names, or call sites, and a cheap test can accept the result.",
    why: "Anthropic's multi-agent research system used ~15× the tokens of a chat — and Anthropic notes most coding tasks are better handled by single agents. Recursive harnesses are conditional, not a personality.",
    doThis:
      "Scout in isolation when the surface is unknown; Builder in isolation when the plan is locked.",
    notThis: "Six teammates talking to each other about a 20-line fix.",
    sources: [
      {
        title: "How we built our multi-agent research system (Anthropic)",
        url: "https://www.anthropic.com/engineering/multi-agent-research-system",
      },
    ],
    confidence: "verified",
  },
  {
    id: "handoff",
    chapter: "Crew",
    title: "The delegation message is the interface",
    rule: "Subagent descriptions stay one sentence in the parent. Detail lives in the role body, loaded on run. Handoffs are 12-line cards.",
    why: "Claude Code warns when combined subagent descriptions cross 15k tokens — they sit in the parent all session. State does not belong in AGENTS.md.",
    doThis: "Goal, constraints, cited files, done-means, out of scope.",
    notThis: "Paste the last forty turns 'for context'.",
    sources: [
      { title: "Claude Code subagents", url: "https://code.claude.com/docs/en/sub-agents" },
    ],
    confidence: "verified",
  },
  {
    id: "isolate",
    chapter: "Crew",
    title: "Reviewer never shares a window with Builder",
    rule: "Verification that can see the chain of thought will agree with it.",
    why: "Review-before and sensors-after are different jobs; an independent audit pass is the cheapest high-value fan-out. Guidance from practice, not a cited study.",
    doThis: "Fresh subagent, plan + diff + test output only.",
    notThis: "Ask the same session 'does this look good?'.",
    sources: [],
    confidence: "unverified",
  },
  {
    id: "tools",
    chapter: "Tools",
    title: "Strip tools until success rises",
    rule: "Four or five MCPs beat twenty. Each schema is paid on every turn.",
    why: "Vercel's d0 agent (5 queries): stripping to fewer tools moved success 80% → 100% with 37% fewer tokens and 3.5× faster averages (worst case 724s → 141s). Small sample — validate on your own workload.",
    doThis: "Graphify + Context7 + Playwright. Add GitHub only with a tight toolset.",
    notThis: "Filesystem, Fetch, Sequential Thinking on a coding agent that already has them.",
    sources: [
      {
        title: "We removed 80% of our agent's tools (Vercel)",
        url: "https://vercel.com/blog/we-removed-80-percent-of-our-agents-tools",
      },
    ],
    confidence: "verified",
  },
  {
    id: "hooks",
    chapter: "Tools",
    title: "Deterministic work is a hook",
    rule: "Put a control in the most mechanical layer that can express it.",
    why: "A sentence in AGENTS.md that says 'never read .env' is advice. A deny rule is a guarantee — the hook protocol gives denies, test gates, and format-on-write without spending model tokens.",
    doThis: "Hooks for format/lint/deny. Prompts for naming and architecture intent.",
    notThis: "A skill that reminds the model to run prettier.",
    sources: [{ title: "Claude Code hooks", url: "https://code.claude.com/docs/en/hooks" }],
    confidence: "reported",
  },
  {
    id: "shift",
    chapter: "Quality",
    title: "Shift left the check, not the prompt",
    rule: "Linters, tests, and evals are cheaper than a smarter model on the next turn.",
    why: "The 2026 industry direction is model + harness + knowledge, with smaller models sufficing when the harness holds the rails. Directional guidance, not a measured result.",
    doThis:
      "The Stop hook runs the repo's real test command. Reviewer checks the plan, not the vibes.",
    notThis: "A longer system prompt hoping the model 'be more careful'.",
    sources: [],
    confidence: "unverified",
  },
  {
    id: "software",
    chapter: "Quality",
    title: "The harness is software",
    rule: "Version it, review it, delete from it. One source, symlinked into CLAUDE.md / GEMINI.md / CONVENTIONS.md.",
    why: "Pointers beat copies: drift across eight rule files is how teams lose the plot. Guidance from practice, not a cited study.",
    doThis: "AGENTS.md is real. Everything else is a pointer. Skills are reviewed like code.",
    notThis: "A different 800-line rules file in every vendor's folder.",
    sources: [],
    confidence: "unverified",
  },
];
