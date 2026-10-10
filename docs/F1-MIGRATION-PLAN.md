# F1 migration plan: stop the repo breaking its own token budget

Status: PROPOSAL. Nothing here is executed. Written 2026-10-10.
Measured with `scripts/measure-repo-always-on.mjs` (o200k_base via gpt-tokenizer, an
approximation of frontier tokenizers). Raw output: `fixtures/measurements/repo-always-on.before.json`.

## 1. Before numbers (measured 2026-10-10)

| File                                | Lines | Tokens | Tracked |
| ----------------------------------- | ----- | ------ | ------- |
| `AGENTS.md` (Grok sandbox contract) | 351   | 4,904  | yes     |
| `AGENTS.project.md` (Helix rules)   | 42    | 417    | yes     |
| `GEMINI.md` (graphify rules)        | 9     | 172    | no      |

- Root `AGENTS.md` references `AGENTS.project.md`, but no agent auto-loads the latter.
- Static noise in git (not always-on, but loaded whenever an agent greps or reads wide):
  `.grok/` = 88 files / 196,083 tokens; template dirs `src/lib/auth`, `src/lib/app-data`,
  `src/components/ui` = 35 files / 32,479 tokens.
- Assumption (not verified for Cursor, Copilot, Antigravity, Grok): an agent working here sees
  root `AGENTS.md` first, so about 4,904 always-on tokens, 11.8x the 417 tokens of the file
  that actually describes Helix. The pack target is under 60 lines; this file is 351.

## 2. Vendor mechanisms that scope or override root AGENTS.md (checked 2026-10-10)

| Agent                              | Mechanism                                                                                                                                                                                                                                                                                                                                                                                  | Source                                               |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------- |
| Claude Code                        | Reads `AGENTS.md` only if no `CLAUDE.md`/`CLAUDE.local.md` exists in the working dir or above. A committed root `CLAUDE.md` therefore replaces it; `CLAUDE.md` can `@import` other files. `claudeMdExcludes` can also skip files by glob, settable at any settings layer (user, project, local, managed; arrays merge). Not tested here whether it also skips an `AGENTS.md` read directly | https://code.claude.com/docs/en/memory               |
| Codex                              | Per directory, `AGENTS.override.md` wins over `AGENTS.md`; at most one file per directory                                                                                                                                                                                                                                                                                                  | https://developers.openai.com/codex/guides/agents-md |
| OpenCode                           | First match wins: `AGENTS.md` beats `CLAUDE.md`. A `CLAUDE.md` does NOT help; the `instructions` config only adds files. No documented way to skip the root file                                                                                                                                                                                                                           | https://opencode.ai/docs/rules                       |
| Cursor, Copilot, Antigravity, Grok | NOT verified in this pass                                                                                                                                                                                                                                                                                                                                                                  | n/a                                                  |

Correction 2026-10-10 (all four verified from primary docs the same day; see DECISIONS.md):
Cursor (cursor.com/docs/rules) loads root + nested AGENTS.md combined, no override — Step A does
not help. Copilot (GitHub docs) reads nearest AGENTS.md, or a root CLAUDE.md/GEMINI.md as an
alternative with undocumented precedence — Step A effect unverified. Antigravity
(antigravity.google/docs/rules) loads AGENTS.md/GEMINI.md per directory walk-up, cumulative —
only Step B helps. Grok (docs.x.ai/build/features/project-rules) loads ALL instruction files per
directory with no size cap — only Step B helps. Conclusion unchanged: Step B is the only
verified-sound fix for every agent.

Disproved: "a committed `CLAUDE.md` fixes it for every agent". It does not for OpenCode.
Also not an escape: working from a subdirectory. Claude Code loads ancestor files and Codex
walks from the repo root down, so a nested `AGENTS.md` adds to the root file, it does not
replace it.

Consequence: cheap per-agent overrides cover only Claude Code and Codex. For the rest, the
only verified-sound fix is a root that is not the Grok contract, i.e. move Helix out of the
Grok workspace (section 3, step B).

## 3. Proposed steps (each independently shippable and revertible)

### Step A. Per-agent overrides, no moves (low risk)

- Add a root `CLAUDE.md` containing `@AGENTS.project.md`.
- Add a root `AGENTS.override.md` that points at `AGENTS.project.md` (or carries its content).
- Root `AGENTS.md` stays byte-identical.
- Projected always-on: about 417 tokens plus a pointer line for Claude Code and Codex
  (pointer lines not yet written, so not counted). Unchanged 4,904 for OpenCode and any
  agent in the unverified row.
- Test first: a script test asserting the files exist, and that `CLAUDE.md` imports resolve.
  Behavior in the real agents must be confirmed by `/context` (Claude Code) and
  `codex exec --json "List every AGENTS.md file in your instruction chain"` before logging.

### Step B. Move Helix out of the Grok workspace (needs your decision)

Create a standalone repo/directory whose root `AGENTS.md` is the content of
`AGENTS.project.md`; the Grok workspace keeps the site scaffolding and its own `AGENTS.md`.

- Projected always-on for all agents: 417 tokens (measured size of the existing file).
- Cost: a second repo or a history-preserving split (`git subtree split` or `git filter-repo`;
  the latter is a new tool and needs your OK). `.grok/`, `public/__grok/`, `server/`,
  `scripts/grok-pwa-*`, `.vercel/`, the branding injector stay behind: nothing platform-owned
  is deleted or moved by this plan, per your rule 7.

### Step C. In-repo split (only if Step B is declined or deferred)

Targets, using `npm` workspaces (built in, no new dependency):

| New location       | From                                                                                                                                         | Import impact                                                                                                                                                                                                                                           |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `core/src/`        | `src/lib/harness/` (42 files)                                                                                                                | `cli/lib.ts`, `cli/helix.mjs`, `cli/learn.ts`, `evals/run.mjs`, `scripts/measure-*.mjs` import `../src/lib/harness/*.ts`; rewrite to `../core/src/*.ts`. The harness imports nothing from site code (checked by grep), so the boundary is already clean |
| `cli/`             | stays                                                                                                                                        | paths above                                                                                                                                                                                                                                             |
| `evals/`           | stays                                                                                                                                        | `evals/fixture-large/generate.mjs` emits relative paths into generated fixtures; re-run `evals/large-tasks.test.mjs`                                                                                                                                    |
| `site/` (optional) | `src/routes`, `src/components`, `src/lib/{store,auth,app-data,utils,...}`, `public`, `server`, `vite.config.ts`, `vercel.json`, `migrations` | Platform-owned paths move only with your approval (rule 8)                                                                                                                                                                                              |

- `package.json` impact: `test` currently lists 20 `src/**` test files by path, guarded by
  `scripts/test-coverage.test.mjs`; both must be updated together. `lint`, `typecheck`
  (`tsc --noEmit`, one `tsconfig.json`) need per-package configs.
- CI impact: `.github/workflows/ci.yml` is one job on Node 22 running `npm ci`, `lint`,
  `typecheck`, `test`, `build`. A split needs a job per workspace, or the site build made optional.
- Always-on tokens are NOT reduced by Step C alone (root `AGENTS.md` still loads); it only
  helps when combined with A or B.

### Step D. Prune unused template dependencies (estimate, build-gated)

Grep-based pass (not depcheck; script was a throwaway in /tmp) found 30 dependencies with no
reference in `src/`, `cli/`, `evals/`, `scripts/`, `server/` or config files, including 18
`@radix-ui/*` packages, `react-hook-form`, `@hookform/resolvers`, `@tanstack/react-query`,
`@tanstack/react-table`, `cmdk`, `date-fns`, `react-day-picker`, `react-resizable-panels`, `vaul`,
`lru-cache`. Some are plausibly implicit (`lightningcss` for Tailwind v4, `@tanstack/router-plugin`),
so none may be removed without `npm run build` passing. Auth/DB template packages
(`better-auth`, `@electric-sql/pglite`, `kysely`, `pg`, `jose`) are referenced only by
`src/lib/auth`, `src/lib/db.ts` and `server/`; removing them means removing those files.
Every removal is a dependency change and needs your approval first (rule 8). Token impact of
pruning: none for agents (these are not instruction files); benefit is install time and noise.

## 4. Rollback

- One branch per step off `fix/audit-evidence-gated`; tag the tip before starting (`pre-f1`).
- Step A: delete two files. Step C: every move is `git mv`, reverted by `git revert`.
  Step B: the original repo is untouched until you delete it.
- Re-run `scripts/measure-repo-always-on.mjs --label after` after each step and compare to
  `fixtures/measurements/repo-always-on.before.json`.

## 5. Decisions needed from you

1. Step A now? (safe, covers Claude Code and Codex only.)
2. Step B (move out of Grok workspace), yes or no? It is the only option verified to cut
   always-on tokens for every agent.
3. May I use `git filter-repo` (new tool) for B, or do you prefer a fresh copy?
4. Which of Cursor, Copilot, Antigravity, Grok matter to you? I will verify their mechanisms.

## 6. Step B execution plan (PLANNING ONLY, written 2026-10-10; nothing here has been run)

Owner decision 2026-10-10: Step B is approved for planning only. No history rewrite, no move,
no new repo until a separate explicit approval.

Facts checked today (commands: `git ls-tree`, `grep`, `which`):

- `git filter-repo` is NOT installed (`git: 'filter-repo' is not a git command`). Using it is a new
  tool and needs approval. 111 commits on the branch.
- `git subtree split` cannot express the split: Helix is interleaved with the Grok scaffolding at
  repo root (see 2026-10-10 DECISIONS entry).
- Coupling that blocks a clean "site stays behind": 7 website files import the harness via the
  `@/lib/harness/*` alias (`src/routes/{stack,export,run,crew,index,playbook}.tsx`,
  `src/components/crew-helix.tsx`). Moving `src/lib/harness` out breaks the site build unless the
  site consumes it from somewhere (git dependency, workspace link, or a vendored copy). That is a
  dependency/layout decision and needs your approval too.
- Outside the harness, importers are: `cli/lib.ts`, `cli/lib.test.mjs`, `cli/helix.mjs`,
  `cli/learn.ts`, `evals/run.mjs`, `scripts/measure-{mcp,skills,repo-always-on}.mjs`,
  `scripts/test-coverage.test.mjs`.

### Path set that would move (proposal)

Keep in new repo: `cli/`, `evals/`, `fixtures/`, `docs/`, `src/lib/harness/` (becomes `src/`),
`scripts/{measure-*.mjs,repo-instructions.test.mjs,test-coverage.test.mjs,write-atomic*.mjs}`,
`.github/`, `.husky/pre-commit`, `.serena/`, `.graphifyignore`, `README.md`, `LICENSE`,
`CONTRIBUTING.md`, `SECURITY.md`, `eslint.config.mjs`, `.prettierrc`, `tsconfig.json` (trimmed),
`package.json` (rewritten), and `AGENTS.project.md` renamed to the new root `AGENTS.md`.
Stay behind (platform-owned or site): `.grok/`, `public/`, `server/`, `migrations/`,
`vercel.json`, `vite.config.ts`, `startup.sh`, `src/routes`, `src/components`, `src/lib/{auth,
app-data,og,store,...}`, root `AGENTS.md`, branding injector, `scripts/grok-pwa-*`.

### Options (pick one)

| Option                                                                              | History                          | New tool                              | Site impact                                | Cost                                                                       |
| ----------------------------------------------------------------------------------- | -------------------------------- | ------------------------------------- | ------------------------------------------ | -------------------------------------------------------------------------- |
| B1 `git filter-repo --path ...` on a fresh clone                                    | kept for moved paths             | yes (filter-repo, approval needed)    | site must import harness from the new repo | cleanest history, one-line rename of `src/lib/harness` via `--path-rename` |
| B2 `git filter-branch --index-filter` on a fresh clone                              | kept                             | no (built in, officially discouraged) | same                                       | slower, error-prone, fine for 111 commits                                  |
| B3 fresh copy (`git ls-files` of the set above into a new repo, one initial commit) | lost (old repo stays as archive) | no                                    | same                                       | simplest, no rewrite risk                                                  |

### Dry-run procedure (when approved; never in the working repo)

1. `git clone --no-local /home/sm-me/Codes/Typescript/helix /tmp/helix-split` and work only there.
2. Apply the chosen option with the path set above; rename `AGENTS.project.md` to `AGENTS.md`.
3. In the clone: `npm ci`, then `npm run lint && npm run typecheck && npm test`; require three green gates
   and `node scripts/measure-repo-always-on.mjs --label split` showing one always-on file of about 417 tokens.
4. Run `helix init` end to end on a scratch repo from the clone's CLI.
5. Only then decide how the site consumes the harness; do not delete anything from the Grok workspace.

### Rollback

Nothing in the original repo changes. Delete `/tmp/helix-split` or the new repo.

### Decisions still needed from you before any execution

1. B1 (install filter-repo), B2, or B3?
2. How should the website (stays in the Grok workspace) get the harness: git dependency, `npm` workspace
   link, or a vendored copy?
3. Is a new GitHub repo acceptable, or must this stay in `sm-me-dev/helix`?

## 7. Owner answers (2026-10-10 13:31) and resulting recommendation (STILL NOT EXECUTED)

Answers: (1) pick the most professional and effective option; (2) the site must be able to consume the
harness by all three routes (git dependency, workspace link, vendored copy); (3) must stay in the repo
`sm-me-dev/helix`, history may be rebased.

Consequences:

- B3 (fresh copy, new repo) is out: it leaves the repo. B1 and B2 rewrite history in place.
- "Stay in this repo" means the Grok scaffolding and Helix cannot both own the root of the same branch.
  Moving platform-owned paths (`.grok/`, `public/__grok/`, `server/`, `scripts/grok-pwa-*`, `.vercel/`,
  root `AGENTS.md`, branding injector) is forbidden without approval, so they must not be moved or deleted.

Recommendation (B1, branch-based; most professional because it is reversible and leaves platform files byte-identical):

1. Tag the current tip `pre-split` and keep the Grok workspace on a preserved branch `grok-workspace`
   (a plain branch at the current tip). Nothing on it changes.
2. In a fresh clone, run `git filter-repo` with the path set from section 6 and `--path-rename`
   `src/lib/harness/:src/`, with `AGENTS.project.md` renamed to `AGENTS.md`. Verify there (three green gates,
   `node scripts/measure-repo-always-on.mjs --label split` showing one always-on file of about 417 tokens,
   `helix init` end to end on a scratch repo).
3. Only after that, publish the rewritten history as the new default branch of `sm-me-dev/helix`
   (force push needed; never done without a separate explicit go). `grok-workspace` keeps the old layout.
4. Site consumption of the harness (answer 2): make the harness an npm workspace package (built in, no new
   dependency) as the primary route; a git dependency (`github:sm-me-dev/helix#<tag>`) and a vendored copy
   are documented fallbacks. Whether the Grok workspace builds from a git dependency is not verified.
5. Rejected: B2 (`git filter-branch`, discouraged by Git itself); in-place layout where Helix moves into a
   subdirectory (ancestor `AGENTS.md` still loads for Claude Code and Codex, so it does not fix the token budget).

Approvals required before any step runs:
(a) install `git filter-repo` (one-line justification: the tool Git's own docs recommend for history rewrites;
a dev tool, not a project dependency); (b) permission to force-push to `origin`; (c) the fresh-clone
dry run in step 2 can start with only (a).

## 8. Step B dry-run result (2026-10-10, fresh clone in /tmp/helix-split; original repo untouched)

Tooling: `git-filter-repo` 2.47.0 installed with `pipx` (isolated; system `pip --user` is blocked by PEP 668 and
was not overridden). Node v24.14.1; CI's Node 22 not run.

Result: 107 of 111 commits kept (4 were site-only), 140 files, 121 npm packages (site tree removed).
All three gates green in the split, run twice (NODE_ENV unset, then `production`) on a PATH without yarn,
pnpm and bun: lint 0, typecheck 0, tests 109 + 159 pass, 0 fail. Always-on instruction file for every agent:
one root `AGENTS.md`, 42 lines, about 417 tokens (`scripts/measure-repo-always-on.mjs --label split`;
other agents' loading remains per the 2026-10-10 verification, not re-run). `helix init --yes` on a scratch
repo from the clone's CLI wrote 5 files, exit 0, 38-line `AGENTS.md`.

What the dry run found that the first plan got wrong or missed (fix BEFORE any real split):

1. `scripts/write-atomic.mjs` and its test belong to the Grok template (they test `.grok/skills`), nothing in
   Helix imports them, and the test fails in the split. Remove them from the path set.
2. Depth-dependent relative paths broke: `src/tokens.ts`, `src/tokens.test.ts` (`../../../fixtures`),
   `src/hermetic.test.ts` (`../../../`), `src/platforms.test.ts` (`../../../README.md`),
   `src/tool-surface.test.ts` (`join(here, "..", "..", "..", "fixtures")`). A grep for `../../../` alone
   missed the last one; the test run caught it.
3. `src/generate.test.ts` imports `DEFAULT_HARNESS_CONFIG` from the site's zustand store. It is pure harness
   data; the fix used a new `src/defaults.ts`. In the real repo this is a prerequisite commit (move the
   constant into the harness, make the site store import it).
4. `package.json`, `tsconfig.json`, `eslint.config.mjs` and `.github/workflows/ci.yml` need harness-only
   versions (runtime dependency: `gpt-tokenizer` only; no React or Vite; CI drops `build`). `npm run build`
   no longer exists for the CLI; whether the site keeps one is part of the site decision.
5. `scripts/measure-repo-always-on.mjs` still reports `.grok/` and template noise (0 files after the split).
6. Environment trap: this shell exports `NODE_ENV=production`, which makes `npm ci` skip devDependencies and
   fail on `husky`. Use `npm ci --include=dev`.
7. Docs still mention `src/lib/harness` paths (not rewritten in the dry run).

Not tested: the website consuming the harness (workspace link, git dependency or vendored copy), the
Grok workspace building from the preserved branch, any push. Nothing was pushed; the throwaway clone and
`/tmp/scratch-helix` remain only in /tmp.
