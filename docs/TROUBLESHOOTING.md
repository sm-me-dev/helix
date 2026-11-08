# Troubleshooting

## Runtime requirement

The npm package requires Node.js **26.4 or newer**. Check with `node --version`. Standalone distributions include a Node runtime. If the TUI or TypeScript entrypoints fail under an older system runtime, upgrade Node or use a standalone package.

## Provider connection fails

Check the resolved provider, model, base URL, and key source. Helix normalizes known API suffixes from the configured base URL. A keyless loopback endpoint receives `sk-helix-local`; remote services require a real key. Provider setup checks `GET /models` first and falls back to a minimal chat request only when the endpoint returns 404 or 405. See [Configuration](CONFIGURATION.md) for precedence and trusted-workspace behavior.

The CLI `helix doctor [dir]` audits the generated pack and local integrations. It is distinct from the provider connectivity handshake shown in provider setup.

## Daemon or UI cannot connect

Start the daemon with `helix serve [dir]`, then attach `helix tui [dir]` or `helix web [dir]`. Both interfaces use the daemon API and SSE event stream. If running from a checkout, build the Web UI with `npm run build` before using `helix web`.

## A write is denied

The WriteGate can reject a path outside the workspace, a path owned by another peer, or an action that has not received required plan approval. Review the task's allowed paths and, in peer mode, the assigned `ownedPaths` before retrying.

## Knowledge does not appear in the route list

Tier 0 routes are compiled from `.helix/knowledge/domains/*/domain.md` frontmatter. Check that the file contains a unique `id`, a short `description`, and one or more `paths`. Canonical skills are loaded after routing and must remain within the 600-token limit.

## Episodic knowledge is quarantined

Retrieved Tier 2 records are hints and do not automatically become canonical guidance. Review and maintain the SQLite store using `helix knowledge compact [dir]`.

## Context auto-compaction

At the configured 92% context-use threshold, older tool output is archived to `.helix/runtime/<session>/NOTES.md` and replaced with digest pointers. The percentage is the trigger threshold, not a statement that 92% of context is compressed.

## FAQ

### What are the execution modes?

`MODE_1_MASTER_LOOP` is the default routine path. Helix also supports read-only disposable scouts, a two-stage adversarial audit, and peer teams with a shared file-locked task DAG. See [Architecture](ARCHITECTURE.md).

### Which commands are available?

Run `helix --help` for the installed command list, or see the [CLI reference](CLI.md).

### Where is configuration stored?

Provider profiles may come from runtime/session overrides, CLI flags, environment variables, trusted workspace `.helix/config.toml`, or global `~/.config/helix/providers.toml`. Runtime session state and task artifacts live under `.helix/runtime/` in the workspace.

### How do I report a bug or vulnerability?

Report bugs through [GitHub Issues](https://github.com/sm-me-dev/helix/issues). Follow the [Security Policy](../SECURITY.md) for vulnerabilities.
