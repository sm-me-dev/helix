# Quick Start

Helix v2 provides a progressive-disclosure coding loop, guarded writes, quarantined project knowledge, and synchronized CLI, Terminal UI, and Web UI sessions.

## 1. Install

For npm, install with Node.js **>= 26.4**:

```sh
npm install --global @sm-me-dev/helix@0.2.0
```

Standalone bundles include Node.js. See [Installation](INSTALL.md) for Homebrew, Scoop, Winget, and platform archives.

## 2. Initialize the repository

From the project root:

```sh
helix init .
```

Review the generated instructions and workspace trust prompt. Helix starts with a bootstrap prompt under 600 tokens and a Tier 0 domain route catalog under 250 tokens. Relevant Tier 1 skills and tools are loaded only when selected.

## 3. Configure an AI provider

Helix accepts provider settings from runtime overrides, CLI flags, environment variables, a trusted `.helix/config.toml`, and the global `~/.config/helix/providers.toml`, followed by built-in defaults. For a local OpenAI-compatible server, a workspace config can look like:

```toml
provider = "local"
model = "qwen2.5-coder:14b"
base_url = "http://localhost:11434"
```

Keyless loopback servers receive the synthetic `sk-helix-local` key. Helix removes known operation suffixes from a configured URL before forming API requests. See [Configuration](CONFIGURATION.md) for precedence, trust behavior, and the provider handshake.

## 4. Run a task

```sh
helix run "Add validation for malformed cache keys"
```

The normal workflow is `INIT → DISCOVER → EXECUTE → VERIFY → COMPLETE`. The master loop is the routine path. Helix may select a read-only scout, a two-stage cross-model auditor, or peer-team DAG coordination when configured and appropriate. `VisibilityGate` controls available tools; `WriteGate` checks proposed writes and approvals.

When context reaches its configured 92% threshold, older tool output is archived in `.helix/runtime/<session>/NOTES.md` and replaced with concise references. The threshold is a trigger, not a measured compression ratio.

## 5. Use the shared UI session

Start the daemon and attach a client:

```sh
helix serve .
helix tui .
# or
helix web .
```

The TUI and Web UI receive the daemon's event stream and share session state. Build from source with `npm run build` before running `helix web` in a development checkout.

## 6. Maintain project knowledge

Domain `domain.md` frontmatter provides deterministic Tier 0 routes. Canonical Tier 1 skills and references are read-only. Retrieved episodic memories stay in `.helix/knowledge/helix-memory.db` quarantine; inspect and compact them offline:

```sh
helix knowledge compact .
```

See [Architecture](ARCHITECTURE.md), the [CLI reference](CLI.md), and [Evidence](EVIDENCE.md) for system details and measured results.
