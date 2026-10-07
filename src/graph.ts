import type { GraphEdge, GraphNode } from "./types";

export const SAMPLE_GRAPH = {
  title: "ledger-api",
  nodes: 16387,
  files: 412,
  languages: ["TypeScript", "SQL"],
};

export const GRAPH_NODES: GraphNode[] = [
  { id: "gw", label: "ApiGateway", kind: "mod", x: 18, y: 28 },
  { id: "auth", label: "AuthMiddleware", kind: "fn", x: 34, y: 18 },
  { id: "sess", label: "SessionStore", kind: "type", x: 52, y: 12 },
  { id: "key", label: "ApiKeyResolver", kind: "fn", x: 48, y: 32 },
  { id: "ctx", label: "RequestContext", kind: "type", x: 64, y: 24 },
  { id: "rl", label: "RateLimiter", kind: "fn", x: 36, y: 52 },
  { id: "pub", label: "PublicLimiter", kind: "fn", x: 22, y: 68 },
  { id: "bypass", label: "AuthBypass", kind: "fn", x: 44, y: 70 },
  { id: "redis", label: "RedisClient", kind: "mod", x: 62, y: 62 },
  { id: "user", label: "UserService", kind: "fn", x: 78, y: 36 },
  { id: "bill", label: "BillingPort", kind: "type", x: 84, y: 18 },
  { id: "cfg", label: "rate-limit.yml", kind: "cfg", x: 14, y: 48 },
  { id: "test", label: "rate-limit.test", kind: "test", x: 58, y: 82 },
  { id: "hook", label: "onRequest", kind: "fn", x: 8, y: 22 },
];

export const GRAPH_EDGES: GraphEdge[] = [
  { from: "hook", to: "gw", kind: "calls" },
  { from: "gw", to: "auth", kind: "calls" },
  { from: "gw", to: "rl", kind: "calls" },
  { from: "auth", to: "sess", kind: "calls" },
  { from: "auth", to: "key", kind: "calls" },
  { from: "auth", to: "ctx", kind: "calls" },
  { from: "key", to: "ctx", kind: "calls" },
  { from: "rl", to: "pub", kind: "calls" },
  { from: "rl", to: "bypass", kind: "calls" },
  { from: "pub", to: "redis", kind: "calls" },
  { from: "bypass", to: "redis", kind: "calls" },
  { from: "ctx", to: "user", kind: "calls" },
  { from: "user", to: "bill", kind: "imports" },
  { from: "cfg", to: "rl", kind: "imports" },
  { from: "test", to: "rl", kind: "tests" },
  { from: "test", to: "bypass", kind: "tests" },
  { from: "test", to: "auth", kind: "tests" },
];

export const HOT_PATH = ["gw", "auth", "rl", "bypass", "redis", "test"];

export const NODE_EXPLAIN: Record<string, string> = {
  gw: "Entry. Forwards every request through AuthMiddleware then RateLimiter — in that order, on paper.",
  auth: "Sets RequestContext.user when a session or API key is valid. Does not currently stamp a 'skip public limiter' flag.",
  rl: "Picks PublicLimiter vs AuthBypass. The bug: it keys off a header the gateway strips, not RequestContext.user.",
  bypass: "Intended path for authenticated clients. Unreachable on the live path because RateLimiter never sees the user.",
  pub: "Token bucket in Redis keyed by IP. Correct for anonymous traffic only.",
  redis: "Shared client. Both limiters write the same key prefix — another reason AuthBypass must be the one that runs.",
  test: "Covers IP throttling. Does not send a valid API key, so the regression is invisible.",
  key: "Resolves X-Api-Key to a user. Called by AuthMiddleware after the limiter today — too late.",
  ctx: "Request-scoped user, tenant, and now should carry limiter class.",
  sess: "Cookie session store. Fine. Not on the blast radius.",
  user: "Downstream. Untouched if the limiter reads context.",
  bill: "Unrelated. Leave it.",
  cfg: "Thresholds only. No bypass rules — those belong in code.",
  hook: "Fastify onRequest hook. Owns the order of middleware.",
};
