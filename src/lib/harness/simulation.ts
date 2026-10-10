import type { CrewId, HarnessConfig, SimEvent } from "./types.ts";
import { breakdown } from "./tokens.ts";
import { DEFAULT_CREW } from "./crew.ts";
import { DEFAULT_MCPS } from "./mcps.ts";
import { DEFAULT_PLATFORMS } from "./platforms.ts";
import { DEFAULT_SKILLS } from "./skills.ts";
import { classifyTier } from "./workflow.ts";
import type { TaskTier } from "./workflow.ts";

export const SAMPLE_ISSUE = {
  id: "LED-1841",
  title: "Authenticated API clients are hitting the public rate limiter",
  body: "Customers with valid API keys get 429s from /v1/ledger after ~40 requests/min. Anonymous IP limits should not apply once AuthMiddleware has a user. Started after the gateway change that strips unknown headers.",
  repo: "ledger-api",
};

export const SIM_EVENTS: SimEvent[] = [
  {
    t: 0,
    role: "system",
    title: "Classify and contract",
    body: "Bug across two modules (auth, limiter) — complex tier: scout, architect, builder, reviewer. Contract: restore authenticated bypass without loosening anonymous limits. Success: existing IP test plus a new API-key test both pass.",
    tokens: 420,
    naiveTokens: 420,
  },
  {
    t: 1400,
    role: "scout",
    title: "query_graph",
    body: "how does rate limiting attach to authenticated requests?",
    tokens: 860,
    naiveTokens: 11800,
    tool: "graphify.query_graph",
  },
  {
    t: 2800,
    role: "scout",
    title: "shortest_path",
    body: "AuthMiddleware → RateLimiter  (3 hops via ApiGateway)",
    tokens: 1120,
    naiveTokens: 18400,
    tool: "graphify.shortest_path",
  },
  {
    t: 4200,
    role: "scout",
    title: "Read cited ranges",
    body: "Three files, not twenty-eight. Auth stamps a user but never a limiter class. RateLimiter still looks at X-Client-Class, which the gateway now strips.",
    tokens: 6400,
    naiveTokens: 48200,
    files: ["src/http/gateway.ts:40-88", "src/http/auth.ts:12-71", "src/http/rate-limit.ts:1-120"],
  },
  {
    t: 5600,
    role: "scout",
    title: "Brief",
    body: "Assumption (stated, not guessed): authenticated means 'has RequestContext.user'. Open question: should API keys and cookie sessions share one bucket? Defaulting to one bucket unless product says otherwise.",
    tokens: 7100,
    naiveTokens: 51000,
  },
  {
    t: 7200,
    role: "architect",
    title: "Decision table",
    body: "A: restore the stripped header — fights the gateway. B: RateLimiter reads RequestContext.user — matches the existing type. Pick B. Blast radius: rate-limit.ts + one test.",
    tokens: 8400,
    naiveTokens: 54000,
  },
  {
    t: 8600,
    role: "architect",
    title: "Plan",
    body: "1. Stamp limiter class on context in AuthMiddleware. 2. RateLimiter branches on context, not headers. 3. Builder writes the API-key test first, then the patch. Out of scope: Redis key layout, billing.",
    tokens: 9100,
    naiveTokens: 56000,
  },
  {
    t: 10800,
    role: "builder",
    title: "Test first, then patch",
    body: "New case 429s on HEAD, then green after the branch: auth.ts stamps context.limiter = user ? 'auth' : 'public'. rate-limit.ts reads context.limiter. No helpers. No drive-by format of gateway.ts.",
    tokens: 14200,
    naiveTokens: 78000,
    tool: "pnpm test",
    files: ["src/http/auth.ts", "src/http/rate-limit.ts", "src/http/rate-limit.test.ts"],
  },
  {
    t: 12800,
    role: "builder",
    title: "Stop hook gates",
    body: "Stop hook runs the repo suite once more — anonymous IP case unchanged, new case green. Failure tail would have blocked the stop.",
    tokens: 16800,
    naiveTokens: 86000,
  },
  {
    t: 14600,
    role: "reviewer",
    title: "Independent pass",
    body: "Fresh window. Diff matches the plan's two files plus the test. Success criteria ran. get_pr_impact: RateLimiter callers are tests and gateway only. PASS.",
    tokens: 18900,
    naiveTokens: 91000,
    tool: "graphify.get_pr_impact",
  },
  {
    t: 15800,
    role: "system",
    title: "Merge",
    body: "Four summaries, not four transcripts. Ready to open the PR. Token ratio vs a single window that globbed src/http: 4.8× less.",
    tokens: 19420,
    naiveTokens: 93800,
  },
];

export const SIM_DURATION = 17000;

const NUMBER_WORDS = ["Zero", "One", "Two", "Three", "Four", "Five", "Six"];

/** Tier of a task, picked by the main session before any delegation. */
export type { TaskTier } from "./workflow.ts";

/**
 * Surface-only tier (one file/question, one known module, or cross-module).
 * Thresholds live in workflow.ts; security escalation is `selectWorkflow`'s job.
 */
export function pickTier(args: {
  fileCount: number;
  crossesModules: boolean;
  isQuestion: boolean;
}): TaskTier {
  return classifyTier(args);
}

export type AdaptedSim = {
  events: SimEvent[];
  /** always-on index relative to the default config — scales scripted helix tokens. */
  scale: number;
  /** Distinct crew roles present (drives the merge summary count). */
  summaries: number;
  /** Optional roles the config disabled (their passes are skipped). */
  dropped: CrewId[];
};

/**
 * Shape the canned timeline to the live config. Roles the user disabled drop
 * out (system events always stay), helix-side tokens scale with the live
 * always-on index, and the merge event restates its summary count and ratio.
 * Naive-side tokens are untouched — they are the no-harness baseline.
 */
export function adaptSimEvents(config: HarnessConfig): AdaptedSim {
  const inCrew = new Set(config.crew);
  const kept = SIM_EVENTS.filter((e) => e.role === "system" || inCrew.has(e.role));
  const events = kept.length > 0 ? kept : SIM_EVENTS.slice(0, 1);

  const live = breakdown(config);
  const base = baselineAlwaysOn();
  const scale = base > 0 ? live.alwaysOn / base : 1;

  const roles = new Set(events.map((e) => e.role));
  roles.delete("system");
  const summaries = roles.size;
  const summaryWord = NUMBER_WORDS[summaries] ?? String(summaries);
  const dropped = (["scout", "architect", "builder", "reviewer"] as CrewId[]).filter(
    (r) => !inCrew.has(r),
  );

  const last = events[events.length - 1];
  const scaledLast = Math.round(last.tokens * scale);
  const ratio = last.naiveTokens / Math.max(scaledLast, 1);

  const rewritten = events.map((e, i) =>
    i === events.length - 1
      ? {
          ...e,
          tokens: scaledLast,
          body: e.body
            .replace(/^[A-Z][a-z]+ summaries/, `${summaryWord} summaries`)
            .replace(/[\d.]+× less/, `${ratio.toFixed(1)}× less`),
        }
      : { ...e, tokens: Math.round(e.tokens * scale) },
  );

  return { events: rewritten, scale, summaries, dropped };
}

/** Default-config always-on index — the scale denominator. Memoized. */
let cachedBaseline: number | null = null;
function baselineAlwaysOn(): number {
  if (cachedBaseline === null) {
    cachedBaseline = breakdown({
      crew: DEFAULT_CREW,
      skills: DEFAULT_SKILLS,
      mcps: DEFAULT_MCPS,
      platforms: DEFAULT_PLATFORMS,
      graphFirst: true,
      progressiveDisclosure: true,
      defaultSingleAgent: true,
      hooksEnabled: true,
    }).alwaysOn;
  }
  return cachedBaseline;
}
