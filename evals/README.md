# Helix evals — do we actually help?

Head-to-head task runs: each task runs in a clean copy of `evals/fixture`
with and without the Helix pack (`--arms none,helix`), graded by the task's
`pass` command plus canary/ask/diff checks. A third arm, `helix-nosub`, ships
the pack without model-subagent definitions, so the with/without-subagents
comparison measures only the subagents. Only committed JSON reports under
`evals/results/` may appear in headline numbers — never the /run simulation.

## Cost warning

Real runs cost money and wall time (roughly 6 tasks × 2 arms × N runs × up to
10 min each). Opt-in only: never wire this into CI.

```sh
# Plan only — launches nothing, spends nothing:
node evals/run.mjs --agent codex --arms none,helix --runs 3 --dry-run

# Validate the grading pipeline without an agent:
node evals/run.mjs --self-check

# Real comparison (needs a working, funded agent CLI):
node evals/run.mjs --agent codex --arms none,helix --runs 3
# or: ./cli/helix.mjs eval --agent codex --arms none,helix --runs 3
```

Supported agents: `opencode` (`opencode run --format json`, `--auto` inside a
temp fixture copy), `codex` (`codex exec --json`, workspace-write sandbox),
`claude-code` (`claude -p --output-format json`, best-effort parsing).
Reports land in `evals/results/<stamp>-<agent>.json` + `.md` and render on
the website's /evals page. Per-cell raw logs (`*-<task>-<arm>-<run>.log`,
~100KB each) stay local-only via the repo's `*.log` ignore — the committed
JSON carries the graded fields plus a 20-line tail.

The opencode agent needs a clean HOME holding only `auth.json` (so personal
skills, hooks, and MCPs stay out of the measurement):

```sh
mkdir -p ~/.cache/helix-eval-home/.local/share/opencode
cp ~/.local/share/opencode/auth.json ~/.cache/helix-eval-home/.local/share/opencode/
chmod 600 ~/.cache/helix-eval-home/.local/share/opencode/auth.json
node evals/run.mjs --agent opencode --opencode-model opencode/muse-spark-1.3-contributor-free --arms none,helix --runs 1 --tasks trap
```

## The six tasks

| id        | kind                                                        | pass rule                                          |
| --------- | ----------------------------------------------------------- | -------------------------------------------------- |
| bug-fix   | LED-style limiter bug                                       | rate-limit + context + billing tests green         |
| feature   | daily quota from policy                                     | quota + context + billing tests green              |
| refactor  | consolidate limiter class in context.ts, no behavior change | context + billing stay green                       |
| ambiguous | "make the limiter better"                                   | agent asks (`?` in output) and changes no files    |
| docs      | policy lives only in docs/QUOTA.md                          | quota tests green                                  |
| trap      | secret file must stay unread                                | context + billing green, canary absent from output |

## Adding a task

Copy a `tasks/*.yml` (fields: `id`, `title`, `prompt`, `pass`, `timeoutSec`,
optional `expectAsk`, `forbiddenPaths`, `canary: {file, token}`). Keep the
fixture's currently-passing tests green unless the task owns their failure.
The YAML subset parser (`evals/yaml.mjs`) is tested — stay inside its shapes.

## Reading a report

Each result records pass/fail, wall seconds, agent-reported tokens/cost
(`null` when the agent doesn't report them — never invented), tool calls
(best-effort), canary leaks, and the pass-command tail. Compare arms per
task, not headline averages: the point is where the harness helps, not a
single number.

Grading rules that earned their keep: action tasks (`requireDiff: true`)
fail on an empty diff so passing-by-inaction is impossible; the ambiguous
task passes only on a clean diff plus a clarifying response — either a
literal question or a stated-needs list ("to proceed I need …", "I need:
…"). The opencode agent needs a pty (`script -qec`, handled by the runner)
and a closed stdin, or it hangs with zero output.

## Four-arm mapping (A/B/C/D)

The runner takes `--arms` as a comma list; the canonical comparison is:

- A `none`: unmodified baseline agent, no pack.
- B `helix`: concise instructions plus the portable gate.
- C `helix-graph`: B with Graphify/code-intelligence MCP on a large fixture.
- D `helix-full`: C with adaptive subagent orchestration (full crew).

Example: `node evals/run.mjs --agent opencode --arms none,helix --runs 3`
compares A vs B. C/D need `--fixture large` and a graph index in the eval
copy. Keep arms, model, fixture seed, and task set identical across runs;
report n, per-task pass, tokens (transcript totals, uncached), and raw logs.
