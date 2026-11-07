# Helix v2 documentation

Helix is an AI coding harness and execution engine built around progressive disclosure, gated writes, three-tier quarantined knowledge, optional heterogeneous-model coordination, and synchronized daemon clients.

## Start here

- [Installation](INSTALL.md) — Node.js requirement, npm and standalone installation channels.
- [Quick Start](QUICKSTART.md) — initialize a project, configure a provider, and run a task.
- [CLI reference](CLI.md) — primary commands and operational workflows.
- [Configuration](CONFIGURATION.md) — provider precedence, trust guard, URL normalization, and handshake.

## Architecture and evidence

- [Architecture](ARCHITECTURE.md) — five-stage workflow, four execution modes, knowledge tiers, gates, and daemon clients.
- [Architecture diagram](diagrams/architecture.md) and [development workflow](diagrams/development-workflow.md).
- [Evidence](EVIDENCE.md) — generated token-cost measurements and their methods.
- [Benchmark methodology](benchmarks/methodology.md), [results](benchmarks/results.md), and [limitations](benchmarks/limitations.md) — experimental findings with scope and caveats.
- [Architectural decisions](DECISIONS.md) — dated decision and verification record.

## Operations and development

- [Troubleshooting](TROUBLESHOOTING.md), [updating](UPDATING.md), [uninstalling](UNINSTALLING.md), and [platform support](PLATFORM_SUPPORT.md).
- [Distribution](DISTRIBUTION.md) — package channels and release artifacts.
- [Contributing](../CONTRIBUTING.md) and [security policy](../SECURITY.md).

## Main CLI commands

| Command                                      | Description                                      |
| -------------------------------------------- | ------------------------------------------------ |
| `helix init [dir]`                           | Generate the project pack.                       |
| `helix run [task] [--tmux]`                  | Execute a coding task.                           |
| `helix serve`, `helix tui`, `helix web`      | Start the daemon or attach synchronized clients. |
| `helix gate`                                 | Run deterministic checks.                        |
| `helix knowledge compact`                    | Review and compact episodic quarantine.          |
| `helix doctor`                               | Audit the generated pack and local integrations. |
| `helix measure`, `helix bench`, `helix eval` | Measure packs or run benchmarks and evaluations. |

See the [full command reference](CLI.md) for arguments and additional commands. npm installations require Node.js **>= 26.4**; standalone distributions bundle Node.
