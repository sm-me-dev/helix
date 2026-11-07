# CLI reference

The executable is `helix`. Run `helix --help` or append `--help` to a command for options available in the installed version.

| Command                                                 | Purpose                                                 |
| ------------------------------------------------------- | ------------------------------------------------------- |
| `helix init [dir]`                                      | Initialize the generated Helix pack in a workspace.     |
| `helix run [task] [--tmux]`                             | Run a coding task through the v2 execution workflow.    |
| `helix serve [dir]`                                     | Start `helixd`, the local HTTP/SSE session daemon.      |
| `helix tui [dir]`                                       | Attach the Terminal UI to the daemon.                   |
| `helix web [dir]`                                       | Attach the Web UI to the daemon.                        |
| `helix gate [dir]`                                      | Run deterministic workspace gates.                      |
| `helix knowledge compact [dir] [--paired-results file]` | Review and compact episodic quarantine records offline. |
| `helix doctor [dir]`                                    | Audit the generated pack and local integration setup.   |
| `helix measure [dir]`                                   | Measure generated pack token counts.                    |
| `helix bench [dir]`                                     | Run benchmark workloads.                                |
| `helix eval [dir]`                                      | Run evaluation suites.                                  |

The CLI also provides plugin, telemetry, report, export, learn, link/unlink, update, uninstall, and UI commands. Use `helix --help` for the complete current command list.

## Initialize a workspace

```sh
helix init .
```

Initialization writes the instruction pack and workspace setup. Review generated files and make sure the workspace trust state matches your expectations before relying on sensitive project-level provider settings.

## Run a task

```sh
helix run "Fix the failing cache test"
helix run "Trace the request timeout" --tmux
```

The engine progresses through `INIT → DISCOVER → EXECUTE → VERIFY → COMPLETE`, with direct-execution and question paths where applicable. Domain skills and tools are loaded on demand. Writes pass through the WriteGate; deterministic verification runs before any configured cross-model audit.

## Start the synchronized clients

```sh
helix serve .
helix tui .
helix web .
```

The daemon owns live sessions and streams events over SSE. TUI and Web clients attach to the same daemon and share session state. `helix web` requires the built Web UI; `npm run build` produces it from a source checkout.

## Knowledge maintenance

```sh
helix knowledge compact .
helix knowledge compact . --paired-results path/to/results.json
```

Tier 2 records remain in `.helix/knowledge/helix-memory.db` quarantine until reviewed and compacted. Compaction is an offline maintenance operation and does not make retrieved records canonical without the configured review rules.

## Doctor checks

`helix doctor [dir]` checks the generated pack and integrations. The provider `/doctor` setup flow performs a two-stage-compatible handshake: it first requests `{base_url}/models`, then falls back to a minimal chat-completions request only for 404/405 responses. See [Configuration](CONFIGURATION.md).

## Verification and measurement

`helix gate` executes configured deterministic checks. `helix measure` reports generated pack token costs. `helix bench` and `helix eval` run their respective suites; consult their output and the [evidence documentation](EVIDENCE.md) for sample size and measurement method before generalizing results.
