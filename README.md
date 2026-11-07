# Helix

**Helix is an AI coding harness and execution engine.** It gives coding agents a compact project bootstrap, loads tools and domain knowledge on demand, gates writes and approvals, and supports single-model and cross-model work. A shared `helixd` daemon keeps the CLI, Terminal UI, and Web UI in sync.

[Install](docs/INSTALL.md) · [Quick Start](docs/QUICKSTART.md) · [CLI](docs/CLI.md) · [Architecture](docs/ARCHITECTURE.md) · [Configuration](docs/CONFIGURATION.md) · [Evidence](docs/EVIDENCE.md)

## Helix v2 at a glance

- **Progressive Disclosure:** a bootstrap prompt stays below 600 tokens, including a Tier 0 domain route catalog below 250 tokens. `load_skill` and `tool_search` reveal relevant instructions and tools when needed.
- **Quarantine-gated knowledge:** canonical domain guidance is read-only; retrieved episodic records remain in a mutable SQLite quarantine until compacted and reviewed.
- **Heterogeneous model orchestration:** use bounded scouts, a context-firewalled cross-model auditor, or a file-owned peer team when the task benefits from them.
- **Synchronized interfaces:** `helix serve` runs `helixd`; `helix tui` and `helix web` attach to its event stream and show the same sessions.

## Progressive Disclosure Master Loop

Helix starts each task with a measured bootstrap prompt under 600 tokens. The embedded Tier 0 catalog of domain IDs, descriptions, and path patterns is under 250 tokens. The agent uses `load_skill` for a selected domain's canonical guidance and `tool_search` to discover additional capabilities only when the task calls for them.

Two gates constrain execution. The **VisibilityGate** limits which tools are exposed for the current task and phase. The **WriteGate** checks paths, ownership, and approvals before a write is allowed. At the configured 92% context threshold, Helix archives older tool output to `.helix/runtime/<session>/NOTES.md` and replaces it with compact digest pointers. This threshold is an auto-compaction trigger, not a claim of 92% compression. The committed static-cost measurement shows over 80% less upfront context than the smallest measured static instruction pack; see [Evidence](docs/EVIDENCE.md) for method and date.

## Three-tier knowledge system

| Tier                        | Contents                                                                                                                                                | Policy                                                                                            |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| **0 — Routes**              | Deterministic catalog compiled from `.helix/knowledge/domains/*/domain.md` frontmatter: `id`, `description`, and `paths` (with supported path aliases). | Compact routing metadata; no broad rule injection.                                                |
| **1 — Canonical**           | Read-only `SKILL.md` or `domain.md` files capped at 600 tokens, `references/*.md`, and executable `scripts/*.mjs` AST checks.                           | Loaded on demand; scripts consume no model tokens.                                                |
| **2 — Episodic quarantine** | `.helix/knowledge/helix-memory.db`, using `better-sqlite3`, WAL, FTS5, and `sqlite-vec` `vec0` with 384-dimensional cosine KNN.                         | Mutable records are untrusted until offline `helix knowledge compact` promotes selected evidence. |

Tier 2 retrieval fuses full-text and vector rankings with Reciprocal Rank Fusion (RRF), then applies structural checks with `@ast-grep/napi`. The current local vector feature is deterministic trigram hashing; it is not a learned embedding model. Quarantined memories do not become canonical rules automatically.

## Four execution topologies

Helix replaces the old seven-role sequential relay with four bounded topologies:

1. **`MODE_1_MASTER_LOOP`** — a single-threaded master loop and the default for routine tasks (about 80% is the design target; actual mode share has not been measured).
2. **`MODE_2_DISPOSABLE_SCOUT`** — read-only bounded exploration using `Read`, `Grep`, `Glob`, and `ast_search`; at most 8 turns and a JSON synthesis of at most 250 tokens.
3. **`MODE_3_ADVERSARIAL_AUDITOR`** — a two-stage gate. Stage A runs deterministic checks at zero model-token cost. Only a passing diff proceeds to Stage B, a context-firewalled audit routed to a different model family (Claude and Codex/OpenCode, depending on the generator).
4. **`MODE_4_PEER_TEAM`** — a shared, file-locked task DAG at `.helix/runtime/teams/{id}/tasks.json`; wildcard-NFA overlap checks protect `ownedPaths`. Teammates submit plans through `approve_teammate_plan` before writing, exchange sanitized messages through `inboxes/`, and can use `consult_peer` or the runtime's `spawnHypothesisTeam` coordination method.

## CLI

| Command                         | Purpose                                                             |
| ------------------------------- | ------------------------------------------------------------------- |
| `helix init [dir]`              | Generate the Helix instruction pack and project setup.              |
| `helix run [task] [--tmux]`     | Execute a task; `--tmux` enables the tmux workflow where available. |
| `helix serve [dir]`             | Start the `helixd` daemon and its SSE/API endpoints.                |
| `helix tui [dir]`               | Open the Terminal UI, synchronized through the daemon.              |
| `helix web [dir]`               | Open the Web UI, synchronized through the daemon.                   |
| `helix gate [dir]`              | Run deterministic checks against the workspace.                     |
| `helix knowledge compact [dir]` | Review and compact quarantined episodic knowledge offline.          |
| `helix doctor [dir]`            | Audit the generated Helix pack and local integration setup.         |
| `helix measure [dir]`           | Measure generated instruction-pack token costs.                     |
| `helix bench [dir]`             | Run benchmark scenarios.                                            |
| `helix eval [dir]`              | Run evaluation suites.                                              |

For flags, provider setup, and additional commands, see the [CLI reference](docs/CLI.md). Helix requires Node.js **26.4 or newer** when installed through npm; standalone distributions bundle Node.

## Documentation

- [Quick Start](docs/QUICKSTART.md) · [Installation](docs/INSTALL.md) · [Updating](docs/UPDATING.md)
- [Architecture](docs/ARCHITECTURE.md) · [Configuration](docs/CONFIGURATION.md) · [CLI reference](docs/CLI.md)
- [Evidence and measurements](docs/EVIDENCE.md) · [Benchmarks](docs/benchmarks/README.md) · [Troubleshooting](docs/TROUBLESHOOTING.md)
- [Distribution](docs/DISTRIBUTION.md) · [Platform support](docs/PLATFORM_SUPPORT.md) · [Uninstall](docs/UNINSTALLING.md)

## Platform capability matrix

<!-- matrix:start -->

| Platform           | verified   | instructions | mcp        | skills     | subagents  | hooks                  | plugin     | structured-output | session-continuation | sandboxing | lsp        |
| ------------------ | ---------- | ------------ | ---------- | ---------- | ---------- | ---------------------- | ---------- | ----------------- | -------------------- | ---------- | ---------- |
| Claude Code        | 2026-10-11 | emitted      | emitted    | emitted    | emitted    | emitted                | emitted    | unverified        | unverified           | unverified | unverified |
| Cursor             | 2026-10-10 | emitted      | emitted    | emitted    | emitted    | unverified             | unverified | unverified        | unverified           | unverified | unverified |
| Codex              | 2026-10-09 | emitted      | emitted    | emitted    | emitted    | emitted                | unverified | unverified        | unverified           | unverified | unverified |
| Gemini CLI         | no         | unverified   | unverified | unverified | unverified | unverified             | unverified | unverified        | unverified           | unverified | unverified |
| GitHub Copilot     | 2026-10-10 | emitted      | emitted    | unverified | unverified | unverified             | unverified | unverified        | unverified           | unverified | unverified |
| Windsurf           | no         | unverified   | unverified | unverified | unverified | unverified             | unverified | unverified        | unverified           | unverified | unverified |
| Cline              | no         | unverified   | unverified | unverified | unverified | unverified             | unverified | unverified        | unverified           | unverified | unverified |
| Aider              | no         | unverified   | unverified | unverified | unverified | unverified             | unverified | unverified        | unverified           | unverified | unverified |
| OpenCode           | 2026-10-09 | emitted      | emitted    | emitted    | emitted    | unverified             | unverified | unverified        | unverified           | unverified | unverified |
| Google Antigravity | 2026-10-10 | emitted      | emitted    | emitted    | emitted    | supported, not emitted | unverified | unverified        | unverified           | unverified | unverified |
| Devin CLI          | no         | unverified   | unverified | unverified | unverified | unverified             | unverified | unverified        | unverified           | unverified | unverified |
| Factory Droid      | no         | unverified   | unverified | unverified | unverified | unverified             | unverified | unverified        | unverified           | unverified | unverified |
| Kiro               | no         | unverified   | unverified | unverified | unverified | unverified             | unverified | unverified        | unverified           | unverified | unverified |
| Amp                | no         | unverified   | unverified | unverified | unverified | unverified             | unverified | unverified        | unverified           | unverified | unverified |
| Kilo Code          | no         | unverified   | unverified | unverified | unverified | unverified             | unverified | unverified        | unverified           | unverified | unverified |

<!-- matrix:end -->

## Development

```sh
npm install
npm run build
npm run typecheck
npm run lint
npm test
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for development guidelines.
