# Graph Report - helix (2026-10-07)

## Corpus Check

- cluster-only mode — file stats not available

## Summary

- 1029 nodes · 2004 edges · 70 communities (39 shown, 28 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 30 edges (avg confidence: 0.85)
- Token cost: 9,433 input · 2,934 output

## Graph Freshness

- Built from commit: `0deebd5f`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)

- Open Graph Meta & Brand Validation
- React Router & Connector Setup
- Core Dependencies & Utility Libraries
- LSP & Crew Role Management
- Project Metadata & Build Config
- Playwright Test Automation Framework
- Sign-Out & Timeout Handling
- PostgreSQL & Vite Build Tools
- React Router Helix Integration
- Preview Process & Process Management
- Route & Error Handling System
- 2D Sprite Sheet Generator
- JWT & Gate Identity Auth
- Video Frame Processing Pipeline
- Token & Chart Visualization
- Preview Embedder & Auth Provider
- Platform-Specific File Generation
- Sprite Sheet Extraction & Layout
- Node.js Utility & CLI Tools
- PGlite Database Driver
- TypeScript Configuration
- Dev & Linting Dependencies
- Preview & Auth Configuration
- Layered Image Composition
- Build & Dev Scripts
- Gate Identity Session Management
- Game & Skill Documentation
- Knowledge Graph Core
- Game UI & Playbook Components
- Auth Verification & Session Handling
- Atomic File Operations
- PowerShell Scripting
- ESLint Configuration
- Sprite Sheet Layout Guide
- Auth Popup & Session Handling
- Sprite & Image Generation Skills
- Database Schema for Accounts
- PWA Open Graph Head Management
- Video Processing Pipeline
- Game Animation & Asset Skills
- File Linting & Staging
- Helix Project Setup
- Game Controls & Kart Genre
- Commit Hook Scripts
- Custom Override Files
- Virtual Open Graph Identity
- Startup & Deployment Scripts
- Vercel Configuration
- Grid Puzzle Game
- Endless Runner Genre
- First-Person Shooter Genre
- 2D Platformer Genre
- Tower Defense Genre
- Voxel Game Genre
- UI & Design Skills
- Multiplayer Networking
- PostgreSQL Optimization
- Three.js Node References
- Three.js Post-Processing
- Three.js Shader Modules
- Three.js Game Integration
- App Icon Design
- iPad Onboarding Flow
- iPhone Onboarding Flow
- OG Image Generation
- Open Graph Identity System
- Top-Down Shooter Genre

## God Nodes (most connected - your core abstractions)

1. `cn()` - 32 edges
2. `useHarness` - 20 edges
3. `injectGrokPwaHead()` - 17 edges
4. `compilerOptions` - 16 edges
5. `breakdown()` - 15 edges
6. `formatTokens()` - 14 edges
7. `scripts` - 14 edges
8. `@tanstack/react-router` - 14 edges
9. `selectConfig()` - 13 edges
10. `filesForPlatform()` - 13 edges

## Surprising Connections (you probably didn't know these)

- `hasGlobbedMigrations()` --indirect_call--> `isMigrationFile()` [INFERRED]
  vite.config.ts → scripts/migration-plan.mjs
- `Get-NodeMajor()` --calls--> `node` [INFERRED]
  scripts/install.ps1 → package.json
- `Helix Project Configuration` --conceptually_related_to--> `Helix Installation Guide` [INFERRED]
  .serena/project.yml → docs/INSTALL.md
- `grokPwaMiddleware()` --calls--> `acceptsHtml()` [EXTRACTED]
  server/middleware/grok-pwa.ts → scripts/grok-pwa-shared.mjs
- `injectHeadStreaming()` --calls--> `createHeadInjector()` [EXTRACTED]
  server/middleware/grok-pwa.ts → scripts/grok-pwa-shared.mjs

## Import Cycles

- None detected.

## Hyperedges (group relationships)

- **Game Asset Pipeline** — grok_skills_game_asset_core_skill, grok_skills_game_animation_frames_skill [EXTRACTED 1.00]

## Communities (70 total, 28 thin omitted)

### Community 0 - "Open Graph Meta & Brand Validation"

Cohesion: 0.06
Nodes (72): brandWarningsOnDisk(), computeBrandWarnings(), MAX_CARD_BYTES, OG_PENDING_MAX_AGE_MS, OG_PENDING_REL_PATH, ogPendingActive(), parseBrandCheckArgs(), siteDeclaresOgTypeGame() (+64 more)

### Community 1 - "React Router & Connector Setup"

Cohesion: 0.06
Nodes (62): @tanstack/react-start, WindowStub, callTool(), CONNECTORS_HOST_PROD, CONNECTORS_HOST_STAGING, connectorsBaseFor(), crossSiteBlockedResult(), failureMemo (+54 more)

### Community 2 - "Core Dependencies & Utility Libraries"

Cohesion: 0.03
Nodes (58): dependencies, better-auth, class-variance-authority, clsx, cmdk, date-fns, @electric-sql/pglite, @hookform/resolvers (+50 more)

### Community 3 - "LSP & Crew Role Management"

Cohesion: 0.08
Nodes (46): CREW, CREW_BY_ID, CrewRole, DEFAULT_CREW, DEFAULT_LSPS, Lsp, LSP_BY_ID, LSPS (+38 more)

### Community 4 - "Project Metadata & Build Config"

Cohesion: 0.04
Nodes (55): name, private, sideEffects, type, clsx, cmdk, date-fns, eslint (+47 more)

### Community 5 - "Playwright Test Automation Framework"

Cohesion: 0.07
Nodes (45): playwright, checkedOutputPath(), checkedUrl(), fail(), LOOPBACK_HOSTNAMES, args, baselineRequested, compareAgainstBaseline() (+37 more)

### Community 6 - "Sign-Out & Timeout Handling"

Cohesion: 0.07
Nodes (41): DEPLOYED_SIGN_OUT_TIMEOUT_MS, PREVIEW_SIGN_OUT_TIMEOUT_MS, runPreSignInSignOut(), runSignOut(), settleWithin(), signOutTimeoutMs(), deployed(), hangs() (+33 more)

### Community 7 - "PostgreSQL & Vite Build Tools"

Cohesion: 0.09
Nodes (26): pg, @tailwindcss/vite, vite, @vitejs/plugin-react, APP_ENV_ROUTE, appEnvPlugin(), grokPwaPlugin(), main() (+18 more)

### Community 8 - "React Router Helix Integration"

Cohesion: 0.17
Nodes (21): class-variance-authority, lucide-react, react, @tanstack/react-router, CrewHelix(), HelixMark(), NAV, Shell() (+13 more)

### Community 9 - "Preview Process & Process Management"

Cohesion: 0.14
Nodes (25): cmdlineOf(), isAlive(), killPid(), LOG_FILE, looksLikePreviewProcess(), parseListenerInodes(), parsePgid(), parsePid() (+17 more)

### Community 10 - "Route & Error Handling System"

Cohesion: 0.10
Nodes (26): AppErrorComponent(), errorMessage(), getRouter(), Route, Route, Route, Route, Route (+18 more)

### Community 11 - "2D Sprite Sheet Generator"

Cohesion: 0.15
Nodes (25): bbox_touches_edge(), build_evolution_descs(), build_parser(), build_prompt(), center_single_sprite(), clean_edges(), cmd_build_prompt(), cmd_list_options() (+17 more)

### Community 12 - "JWT & Gate Identity Auth"

Cohesion: 0.12
Nodes (20): jose, GATE_JWKS_PATH, GateEndpoints, GateIdentity, gateIdentityFromHeaders(), GateJwks, gateKeyResolver(), GateLinkedAccount (+12 more)

### Community 13 - "Video Frame Processing Pipeline"

Cohesion: 0.19
Nodes (26): build_exports(), build_parser(), chroma_key_rgba(), clean_frames(), cmd_clean(), cmd_extract(), cmd_process(), cmd_sample() (+18 more)

### Community 14 - "Token & Chart Visualization"

Cohesion: 0.15
Nodes (16): recharts, Term(), TokenChart(), TokenPoint, LeanBadge(), TokenMeter(), breakdown(), formatTokens() (+8 more)

### Community 15 - "Preview Embedder & Auth Provider"

Cohesion: 0.14
Nodes (19): zod, PreviewHostBridge(), AuthProvider(), isGrokEmbedderOrigin(), isRemintPreviewPair(), isSandboxPreviewGuestHost(), resolveParentEmbedderOrigin(), collectRoutePathsFromTree() (+11 more)

### Community 16 - "Platform-Specific File Generation"

Cohesion: 0.18
Nodes (22): agentFile(), agentsMd(), clinerules(), conventionsMd(), copilotInstructions(), cursorMcp(), cursorRule(), filesForPlatform() (+14 more)

### Community 17 - "Sprite Sheet Extraction & Layout"

Cohesion: 0.22
Nodes (19): alpha_bbox(), bbox_touches_edge(), build_parser(), clean_edges(), color_distance(), connected_components(), extract_cell(), iter_cells() (+11 more)

### Community 18 - "Node.js Utility & CLI Tools"

Cohesion: 0.23
Nodes (16): confirm(), die(), install_node(), is_wsl(), log_error(), log_info(), log_ok(), log_warn() (+8 more)

### Community 19 - "PGlite Database Driver"

Cohesion: 0.14
Nodes (6): @electric-sql/pglite, kysely, Client, LazyPGliteDriver, PGliteConnection, pgliteDialect()

### Community 20 - "TypeScript Configuration"

Cohesion: 0.11
Nodes (17): compilerOptions, allowImportingTsExtensions, allowJs, baseUrl, checkJs, isolatedModules, jsx, lib (+9 more)

### Community 21 - "Dev & Linting Dependencies"

Cohesion: 0.12
Nodes (17): devDependencies, eslint, eslint-config-prettier, @eslint/js, eslint-plugin-prettier, eslint-plugin-react-hooks, eslint-plugin-react-refresh, globals (+9 more)

### Community 22 - "Preview & Auth Configuration"

Cohesion: 0.15
Nodes (11): emailAndPasswordEnabled, GROK_ISSUER_DEFAULT, PREVIEW_ALLOWED_HOSTS, PREVIEW_CLIENT_ID, PREVIEW_CLIENT_SECRET, databaseUrl, explicitBaseURL, globalAuthRef (+3 more)

### Community 23 - "Layered Image Composition"

Cohesion: 0.26
Nodes (13): Any, build_parser(), load_props(), main(), paste_prop(), placement_xy(), ArgumentParser, Image (+5 more)

### Community 24 - "Build & Dev Scripts"

Cohesion: 0.14
Nodes (14): scripts, build, build:dev, check:auth, db:migrate, dev, format, lint (+6 more)

### Community 25 - "Gate Identity Session Management"

Cohesion: 0.23
Nodes (12): better-auth, GATE_IDENTITY_HEADER, gateIdentityUserInfo(), sessionBoundToGateIdentity(), clearGateMarkerIfPresent(), emitSessionCookie(), expireSessionDataCookie(), GATE_PROVIDER_ID (+4 more)

### Community 27 - "Knowledge Graph Core"

Cohesion: 0.29
Nodes (9): KIND_FILL, KnowledgeGraph(), choose(), onNodeKey(), GRAPH_EDGES, GRAPH_NODES, HOT_PATH, NODE_EXPLAIN (+1 more)

### Community 28 - "Game UI & Playbook Components"

Cohesion: 0.24
Nodes (6): Switch(), MCPS, Practice, PRACTICES, PlaybookPage(), TABS

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

### Community 33 - "Sprite Sheet Layout Guide"

Cohesion: 0.38
Nodes (6): draw_dashed_line(), main(), parse_args(), Namespace, Create a layout-only guide image for sprite sheet generation., ImageDraw

### Community 34 - "Auth Popup & Session Handling"

Cohesion: 0.48
Nodes (6): completionHtml(), completionResponse(), handleAuthPopupRequest(), PopupMessage, readCookie(), SESSION_TOKEN_COOKIE

### Community 35 - "Sprite & Image Generation Skills"

Cohesion: 0.33
Nodes (6): Sprite Modes Reference, Sprite Prompt Rules, Generate2dsprite Skill, OG Brand Assets Skill, imagine_image_to_image, imagine_text_to_image

### Community 36 - "Database Schema for Accounts"

Cohesion: 0.60
Nodes (4): "account", "session", "user", "verification"

### Community 38 - "Video Processing Pipeline"

Cohesion: 0.50
Nodes (4): Video2dsprite Pipeline, Video2dsprite Prompt Rules, Video2dsprite Skill, xAI API Skill

### Community 39 - "Game Animation & Asset Skills"

Cohesion: 0.67
Nodes (3): Game Animation Frames Skill, Game Asset Core Skill, Generate 2D Map Skill

### Community 40 - "File Linting & Staging"

Cohesion: 0.67
Nodes (3): lint-staged, *.{js,jsx,ts,tsx}, *.{json,md,yml,yaml}

## Knowledge Gaps

- **313 isolated node(s):** `GrokPwaEvent`, `WindowStub`, `GateJson`, `MessageRule`, `ConnectorReadiness` (+308 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 403 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **28 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions

_Questions this graph is uniquely positioned to answer:_

- **Why does `react` connect `React Router Helix Integration` to `React Router & Connector Setup`, `Project Metadata & Build Config`, `Sign-Out & Timeout Handling`, `Token & Chart Visualization`, `Preview Embedder & Auth Provider`, `Knowledge Graph Core`, `Game UI & Playbook Components`?**
  _High betweenness centrality (0.119) - this node is a cross-community bridge._
- **Why does `playwright` connect `Playwright Test Automation Framework` to `Project Metadata & Build Config`?**
  _High betweenness centrality (0.117) - this node is a cross-community bridge._
- **Why does `@tanstack/react-router` connect `React Router Helix Integration` to `Project Metadata & Build Config`, `Sign-Out & Timeout Handling`, `Route & Error Handling System`, `Token & Chart Visualization`, `Preview Embedder & Auth Provider`, `Game UI & Playbook Components`?**
  _High betweenness centrality (0.081) - this node is a cross-community bridge._
- **What connects `GrokPwaEvent`, `WindowStub`, `GateJson` to the rest of the system?**
  _313 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Open Graph Meta & Brand Validation` be split into smaller, more focused modules?**
  _Cohesion score 0.058115025594700394 - nodes in this community are weakly interconnected._
- **Should `React Router & Connector Setup` be split into smaller, more focused modules?**
  _Cohesion score 0.05617283950617284 - nodes in this community are weakly interconnected._
- **Should `Core Dependencies & Utility Libraries` be split into smaller, more focused modules?**
  _Cohesion score 0.034482758620689655 - nodes in this community are weakly interconnected._
