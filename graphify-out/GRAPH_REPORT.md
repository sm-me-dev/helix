# Graph Report - helix (2026-10-09)

## Corpus Check

- 179 files · ~127,157 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary

- 1137 nodes · 2304 edges · 65 communities (45 shown, 15 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 27 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Graph Freshness

- Built from commit: `e27e5e66`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)

- Open Graph Meta & Brand Validation
- client.server.ts
- dependencies
- simulation.ts
- package.json
- Playwright Test Automation Framework
- Sign-Out & Timeout Handling
- db.ts
- export.tsx
- Preview Process & Process Management
- routeTree.gen.ts
- src/index.ts
- JWT & Gate Identity Auth
- run.mjs
- stack.tsx
- preview-host-bridge.ts
- tokens.ts
- lib/store.ts
- Node.js Utility & CLI Tools
- LazyPGliteDriver
- compilerOptions
- devDependencies
- Preview & Auth Configuration
- measure-mcp.mjs
- Build & Dev Scripts
- Gate Identity Session Management
- run.tsx
- playbook.tsx
- Auth Verification & Session Handling
- Atomic File Operations
- PowerShell Scripting
- ESLint Configuration
- adapters/index.ts
- Auth Popup & Session Handling
- mcps.ts
- Database Schema for Accounts
- PWA Open Graph Head Management
- shell.tsx
- Helix decision log
- File Linting & Staging
- Helix Project Setup
- parts.ts
- Commit Hook Scripts
- Custom Override Files
- Virtual Open Graph Identity
- Startup & Deployment Scripts
- Vercel Configuration
- generate.ts
- index.tsx
- Helix contributor rules
- fixture/package.json
- Helix evals — do we actually help?
- repo-hygiene.test.mjs
- QUOTA.md
- fixture/README.md
- 2026-10-08T18-46-00-opencode.md
- 2026-10-08T19-21-14-opencode.md
- bin
- OG Image Generation
- Open Graph Identity System

## God Nodes (most connected - your core abstractions)

1. `cn()` - 32 edges
2. `breakdown()` - 25 edges
3. `useHarness` - 21 edges
4. `injectGrokPwaHead()` - 17 edges
5. `compilerOptions` - 17 edges
6. `generatePack()` - 16 edges
7. `formatTokens()` - 16 edges
8. `HarnessConfig` - 16 edges
9. `@tanstack/react-router` - 15 edges
10. `scripts` - 14 edges

## Surprising Connections (you probably didn't know these)

- `hasGlobbedMigrations()` --indirect_call--> `isMigrationFile()` [INFERRED]
  vite.config.ts → scripts/migration-plan.mjs
- `measureReport()` --calls--> `breakdown()` [EXTRACTED]
  cli/lib.ts → src/lib/harness/tokens.ts
- `measureReport()` --calls--> `formatTokens()` [EXTRACTED]
  cli/lib.ts → src/lib/harness/tokens.ts
- `mcpSummary()` --calls--> `mcpSchemaTokens()` [EXTRACTED]
  cli/lib.ts → src/lib/harness/mcps.ts
- `helixFilesFor()` --calls--> `generatePack()` [EXTRACTED]
  evals/run.mjs → src/lib/harness/generate.ts

## Import Cycles

- None detected.

## Communities (65 total, 15 thin omitted)

### Community 0 - "Open Graph Meta & Brand Validation"

Cohesion: 0.06
Nodes (72): brandWarningsOnDisk(), computeBrandWarnings(), MAX_CARD_BYTES, OG_PENDING_MAX_AGE_MS, OG_PENDING_REL_PATH, ogPendingActive(), parseBrandCheckArgs(), siteDeclaresOgTypeGame() (+64 more)

### Community 1 - "client.server.ts"

Cohesion: 0.06
Nodes (61): @tanstack/react-start, WindowStub, callTool(), CONNECTORS_HOST_PROD, CONNECTORS_HOST_STAGING, connectorsBaseFor(), crossSiteBlockedResult(), failureMemo (+53 more)

### Community 2 - "dependencies"

Cohesion: 0.03
Nodes (58): dependencies, better-auth, class-variance-authority, clsx, cmdk, date-fns, @electric-sql/pglite, gpt-tokenizer (+50 more)

### Community 3 - "simulation.ts"

Cohesion: 0.13
Nodes (19): ADAPTER_BY_ID, AdapterSource, DEFAULT_MCPS, DEFAULT_PLATFORMS, Platform, PLATFORM_BY_ID, AdaptedSim, adaptSimEvents() (+11 more)

### Community 4 - "package.json"

Cohesion: 0.04
Nodes (54): name, private, sideEffects, type, clsx, cmdk, date-fns, eslint (+46 more)

### Community 5 - "Playwright Test Automation Framework"

Cohesion: 0.07
Nodes (45): playwright, checkedOutputPath(), checkedUrl(), fail(), LOOPBACK_HOSTNAMES, args, baselineRequested, compareAgainstBaseline() (+37 more)

### Community 6 - "Sign-Out & Timeout Handling"

Cohesion: 0.07
Nodes (41): DEPLOYED_SIGN_OUT_TIMEOUT_MS, PREVIEW_SIGN_OUT_TIMEOUT_MS, runPreSignInSignOut(), runSignOut(), settleWithin(), signOutTimeoutMs(), deployed(), hangs() (+33 more)

### Community 7 - "db.ts"

Cohesion: 0.08
Nodes (27): @electric-sql/pglite, pg, @tailwindcss/vite, vite, @vitejs/plugin-react, APP_ENV_ROUTE, appEnvPlugin(), grokPwaPlugin() (+19 more)

### Community 8 - "export.tsx"

Cohesion: 0.25
Nodes (11): HelixMark(), Term(), AlertDialog(), AlertDialogActions(), AlertDialogContent(), AlertDialogDescription(), AlertDialogTitle(), AlertDialogTrigger() (+3 more)

### Community 9 - "Preview Process & Process Management"

Cohesion: 0.14
Nodes (25): cmdlineOf(), isAlive(), killPid(), LOG_FILE, looksLikePreviewProcess(), parseListenerInodes(), parsePgid(), parsePid() (+17 more)

### Community 10 - "routeTree.gen.ts"

Cohesion: 0.12
Nodes (21): Route, Route, Route, Route, Route, Route, CrewRoute, EvalsRoute (+13 more)

### Community 11 - "src/index.ts"

Cohesion: 0.12
Nodes (20): authenticate(), LIMITS, Plan, planForApiKey(), planLimit(), anonymousContext(), RequestContext, gateway() (+12 more)

### Community 12 - "JWT & Gate Identity Auth"

Cohesion: 0.12
Nodes (20): jose, GATE_JWKS_PATH, GateEndpoints, GateIdentity, gateIdentityFromHeaders(), GateJwks, gateKeyResolver(), GateLinkedAccount (+12 more)

### Community 13 - "run.mjs"

Cohesion: 0.11
Nodes (28): AGENTS, askedProperly(), BEL, CSI_RE, DEFAULT_RESULTS, ESC, FIXTURE, freshCopy() (+20 more)

### Community 14 - "stack.tsx"

Cohesion: 0.20
Nodes (16): LeanBadge(), TokenMeter(), packAsText(), mcpSchemaTokens(), breakdown(), formatTokens(), frontmatter(), skillTokens() (+8 more)

### Community 15 - "preview-host-bridge.ts"

Cohesion: 0.13
Nodes (20): zod, PreviewHostBridge(), CONNECTOR_TOKEN_READY_EVENT, AuthProvider(), isGrokEmbedderOrigin(), isRemintPreviewPair(), isSandboxPreviewGuestHost(), resolveParentEmbedderOrigin() (+12 more)

### Community 16 - "tokens.ts"

Cohesion: 0.09
Nodes (41): cmdDoctor(), cmdExport(), cmdInit(), cmdMeasure(), confirm(), detectDir(), main(), parseArgs() (+33 more)

### Community 17 - "lib/store.ts"

Cohesion: 0.13
Nodes (19): CREW_BY_ID, CrewRole, DEFAULT_CREW, BASE, CrewId, McpId, PackFile, RepoFacts (+11 more)

### Community 18 - "Node.js Utility & CLI Tools"

Cohesion: 0.23
Nodes (16): confirm(), die(), install_node(), is_wsl(), log_error(), log_info(), log_ok(), log_warn() (+8 more)

### Community 19 - "LazyPGliteDriver"

Cohesion: 0.15
Nodes (5): kysely, Client, LazyPGliteDriver, PGliteConnection, pgliteDialect()

### Community 20 - "compilerOptions"

Cohesion: 0.11
Nodes (18): compilerOptions, allowImportingTsExtensions, allowJs, baseUrl, checkJs, isolatedModules, jsx, lib (+10 more)

### Community 21 - "devDependencies"

Cohesion: 0.11
Nodes (18): devDependencies, eslint, eslint-config-prettier, @eslint/js, eslint-plugin-prettier, eslint-plugin-react-hooks, eslint-plugin-react-refresh, globals (+10 more)

### Community 22 - "Preview & Auth Configuration"

Cohesion: 0.15
Nodes (11): emailAndPasswordEnabled, GROK_ISSUER_DEFAULT, PREVIEW_ALLOWED_HOSTS, PREVIEW_CLIENT_ID, PREVIEW_CLIENT_SECRET, databaseUrl, explicitBaseURL, globalAuthRef (+3 more)

### Community 23 - "measure-mcp.mjs"

Cohesion: 0.10
Nodes (16): gpt-tokenizer, args, doc, dryRun, dumpArg, measureStdio(), onlyArg, OUT (+8 more)

### Community 24 - "Build & Dev Scripts"

Cohesion: 0.14
Nodes (14): scripts, build, build:dev, check:auth, db:migrate, dev, format, lint (+6 more)

### Community 25 - "Gate Identity Session Management"

Cohesion: 0.23
Nodes (12): better-auth, GATE_IDENTITY_HEADER, gateIdentityUserInfo(), sessionBoundToGateIdentity(), clearGateMarkerIfPresent(), emitSessionCookie(), expireSessionDataCookie(), GATE_PROVIDER_ID (+4 more)

### Community 27 - "run.tsx"

Cohesion: 0.12
Nodes (21): class-variance-authority, react, recharts, KIND_FILL, KnowledgeGraph(), choose(), onNodeKey(), TokenChart() (+13 more)

### Community 28 - "playbook.tsx"

Cohesion: 0.29
Nodes (5): Practice, PracticeConfidence, PRACTICES, PlaybookPage(), Route

### Community 29 - "Auth Verification & Session Handling"

Cohesion: 0.25
Nodes (9): gateIdentityEnabled(), auth, authConfigured, databaseConfigured, DEV_USER_ID, getSessionUser(), requireUserId(), UnauthorizedError (+1 more)

### Community 30 - "Atomic File Operations"

Cohesion: 0.29
Nodes (7): handOver(), isInside(), parseWriteAtomicArgs(), ROOT, stagingError(), SCRIPT, TEMPLATE_ROOT

### Community 31 - "PowerShell Scripting"

Cohesion: 0.25
Nodes (5): engines, node, Get-NodeMajor(), Invoke-Step(), Write-Info()

### Community 32 - "ESLint Configuration"

Cohesion: 0.29
Nodes (6): eslint-config-prettier, @eslint/js, eslint-plugin-react-hooks, eslint-plugin-react-refresh, globals, typescript-eslint

### Community 33 - "adapters/index.ts"

Cohesion: 0.18
Nodes (16): copilotAdapter, ADAPTERS, aiderAdapter, ampAdapter, antigravityAdapter, clineAdapter, devinAdapter, factoryAdapter (+8 more)

### Community 34 - "Auth Popup & Session Handling"

Cohesion: 0.48
Nodes (6): completionHtml(), completionResponse(), handleAuthPopupRequest(), PopupMessage, readCookie(), SESSION_TOKEN_COOKIE

### Community 35 - "mcps.ts"

Cohesion: 0.13
Nodes (16): cursorAdapter, CREW, Mcp, mcpMeasurementFresh(), McpRemote, MCPS, McpServerConfig, McpStdio (+8 more)

### Community 36 - "Database Schema for Accounts"

Cohesion: 0.60
Nodes (4): "account", "session", "user", "verification"

### Community 38 - "shell.tsx"

Cohesion: 0.15
Nodes (14): lucide-react, sonner, @tanstack/react-router, NAV, Shell(), AppErrorComponent(), errorMessage(), getRouter() (+6 more)

### Community 39 - "Helix decision log"

Cohesion: 0.14
Nodes (13): 2026-10-07 — 1.1 real hooks (verified protocol above), 2026-10-07 — 1.2/1.3/1.4 orchestrator, routing, skills + 1.7 lean file, 2026-10-07 — 1.5/1.6 MCP correctness + adapters (verified 2026-10-07), 2026-10-07 — 1.8 repo identity, 2026-10-07 — 1.9 failing-test verdict, 2026-10-07 — Eval agent probes (no viable agent in this environment), 2026-10-07 — Phase 0 baseline (no code changes yet), 2026-10-07 — Phase 2 honest measurement (+5 more)

### Community 40 - "File Linting & Staging"

Cohesion: 0.67
Nodes (3): lint-staged, *.{js,jsx,ts,tsx}, *.{json,md,yml,yaml}

### Community 42 - "parts.ts"

Cohesion: 0.29
Nodes (12): claudeAdapter, hookFiles(), clinerules(), conventionsMd(), copilotInstructions(), cursorRule(), formatHintHook(), hooksJson() (+4 more)

### Community 49 - "generate.ts"

Cohesion: 0.27
Nodes (8): codexAdapter, agentFile(), skillFile(), agentsMd(), codexToml(), MCP_BY_ID, Skill, SKILL_BY_ID

### Community 51 - "index.tsx"

Cohesion: 0.27
Nodes (4): CrewHelix(), PLATFORMS, agentTokens(), CrewPage()

### Community 52 - "Helix contributor rules"

Cohesion: 0.29
Nodes (6): Gates (run on Node 22 to match CI; Node 24 also accepted), Graphify first, Helix contributor rules, Ignore list, Verification rule (non-negotiable), Where things live

### Community 53 - "fixture/package.json"

Cohesion: 0.33
Nodes (5): name, private, scripts, test, type

### Community 54 - "Helix evals — do we actually help?"

Cohesion: 0.33
Nodes (5): Adding a task, Cost warning, Helix evals — do we actually help?, Reading a report, The six tasks

## Knowledge Gaps

- **366 isolated node(s):** `DetectedStack`, `DoctorFailure`, `name`, `private`, `type` (+361 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 457 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **15 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions

_Questions this graph is uniquely positioned to answer:_

- **Why does `playwright` connect `Playwright Test Automation Framework` to `package.json`?**
  _High betweenness centrality (0.105) - this node is a cross-community bridge._
- **Why does `react` connect `run.tsx` to `client.server.ts`, `package.json`, `shell.tsx`, `Sign-Out & Timeout Handling`, `export.tsx`, `stack.tsx`, `preview-host-bridge.ts`, `index.tsx`?**
  _High betweenness centrality (0.104) - this node is a cross-community bridge._
- **Why does `@tanstack/react-router` connect `shell.tsx` to `package.json`, `Sign-Out & Timeout Handling`, `export.tsx`, `stack.tsx`, `preview-host-bridge.ts`, `index.tsx`, `run.tsx`, `playbook.tsx`?**
  _High betweenness centrality (0.098) - this node is a cross-community bridge._
- **What connects `DetectedStack`, `DoctorFailure`, `name` to the rest of the system?**
  _366 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Open Graph Meta & Brand Validation` be split into smaller, more focused modules?**
  _Cohesion score 0.058115025594700394 - nodes in this community are weakly interconnected._
- **Should `client.server.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.056962025316455694 - nodes in this community are weakly interconnected._
- **Should `dependencies` be split into smaller, more focused modules?**
  _Cohesion score 0.034482758620689655 - nodes in this community are weakly interconnected._
