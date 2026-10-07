// Representative "bloated" baseline fixture.
//
// PROVENANCE (2026-10-07): authored as a composite of the bloat patterns seen
// in real-world always-on files — an inlined style guide, an architecture
// novel, pasted runbooks, a tool-per-turn MCP dump, and contradictory rules.
// It is REPRESENTATIVE, not copied from any single repo: the naive-baseline
// numbers derived from it measure "Helix vs a typical overweight setup", not
// "Helix vs your repo before Helix". Do not present it as a measured host.
export const BLOATED_AGENTS_MD = `# Project Rules — READ ALL OF THIS BEFORE DOING ANYTHING

> This file is the single source of truth. It always applies. All sections are
> mandatory. When in doubt, re-read this file from the top.

## 0. How to behave

You are a careful, thoughtful, precise, diligent, and proactive senior
engineer. Always think step by step. Always consider edge cases. Always ask
yourself whether there might be a better approach before writing any code.
Never rush. Quality over speed, always. If you are unsure about anything, stop
and ask the user for clarification before proceeding.

## 1. Style guide (all languages, condensed from our 40-page handbook)

Use 2-space indentation everywhere except Go (tabs) and Python (4 spaces, but
2 spaces inside nested comprehensions for readability). Maximum line length is
100 characters, except 120 for imports and 80 for Markdown. Always use double
quotes in JavaScript and TypeScript, single quotes in Python, and backticks for
SQL identifiers. Prefer const over let; never use var. Prefer arrow functions
for callbacks but named function declarations for anything over 5 lines.
Always destructure props. Always use optional chaining instead of ternaries
that check for null. Prefer early returns. Prefer guard clauses. Prefer
composition over inheritance. Prefer pure functions. Avoid classes unless the
framework requires them, in which case prefer small classes with a single
responsibility, and always document the invariants in a comment above the
class, and always write a unit test for every public method, and always run
the linter before committing, and always...

## 2. Architecture of this system (read fully; it changes often)

The system is composed of a frontend (React 19, TanStack Router, Vite 8,
Tailwind v4), a backend-for-frontend (Nitro, deployed on Vercel), a Postgres
database (Neon, with branching), an auth layer (Better Auth with Google and
GitHub providers, plus a bespoke gate-identity handshake for the preview
proxy), a connector subsystem (Google Drive, Gmail, Calendar, Outlook), an
eval harness (planned), a CLI (planned), and twelve micro-decisions documented
in docs/DECISIONS.md (read all of them before changing anything). Data flows
from the edge into server routes, then into lib/ modules, then into PGLite in
development and Neon in production, then back out through the same layers in
reverse, except on Tuesdays when the preview proxy injects... (this section
continues for another 60 lines in the average repo; truncated here to the
patterns that cost tokens: exhaustive inventories no task ever needs whole).

## 3. Runbooks (pasted from Notion; may be out of date)

### 3a. How to run the tests

Run npm test. If that fails, try npm run test:unit. If that fails, try
npx vitest run --coverage. If that fails, ask in #eng-help. Never commit on a
red suite. Always commit on a green suite. If the suite is yellow, squint.

### 3b. How to deploy

Merge to main. Vercel deploys. If Vercel does not deploy, check the dashboard.
If the dashboard is green but the site is down, check DNS. If DNS is fine,
it is probably caching. It is always caching, except when it is the database.

### 3c. How to add a dependency

Ask in #architecture. Wait two business days. If nobody objects, add it. If
somebody objects, schedule a meeting. The meeting will conclude that you
should have asked in #architecture.

## 4. MCP servers (all of them, just in case)

We keep twenty MCP servers connected at all times so the model always has
every capability: filesystem, fetch, memory, sequential-thinking, postgres,
sqlite, github (full toolsets), gitlab, slack, notion, linear (full),
sentry (full), playwright, puppeteer, brave-search, google-drive, gmail,
calendar, context7, and serena. Each schema is loaded on every turn. This is
fine. Tool choice is the model's love language.

## 5. Subagent roster (full definitions inline so nothing is ever missing)

### Scout

You are the Scout. Your job is to explore. You explore by reading files. Read
many files. When you have read enough files, read a few more, to be sure.
Then write a brief. The brief should be thorough. A thorough brief mentions
every file you read, in the order you read them, with a one-paragraph summary
of each, plus your feelings about each file. (The remaining five roles follow
in the same style; each definition is ~40 lines. Omitted here — the fixture
counts every line it ships, and this comment is honest about the truncation.
The token count below is computed from the shipped text only.)

### Architect

You are the Architect. Your job is to decide. Consider every option...

### Builder

You are the Builder. Your job is to build. Build carefully...

### Prover

You are the Prover. Your job is to prove. Prove thoroughly...

### Auditor

You are the Auditor. Your job is to audit. Audit everything...

## 6. Contradictory rules (both apply; good luck)

- Never read a file over 100 lines; always read the whole file for context.
- Always fan out to all six roles, even for typos; default to a single agent.
- Never ask questions; always ask before guessing product intent.
- Ship fast; never ship without three approvals and a freeze window.

## 7. Final reminders

Re-read section 0. Then re-read sections 1-6. Then begin. If this file ever
feels long, that feeling is wrong: context is cheap and attention is infinite.
`;
