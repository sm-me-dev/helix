# Helix Benchmark Limitations and Trade-Offs

> **Scope:** The numerical comparisons below describe a historical 2026-10 static-pack experiment, not the Helix v2 runtime architecture. Do not generalize them to the v2 auditor or peer-team topologies.

Helix is engineered to provide measurable improvements, not marketing claims. This document details known limitations, architectural trade-offs, and conditions where Helix does not improve development workflows.

---

## 1. Where Helix Does Not Help

### 1. Simple Single-Line Tasks in Small Repositories

On trivial single-file edits in repositories under 20 files, an unharnessed agent can solve the task in 1–2 turns. The ~784 always-on tokens added by `AGENTS.md` and pack configuration represent pure overhead that cannot be amortized by search savings.

### 2. Graph Intelligence on Moderate Codebases

Empirical evaluation of `helix-graph` on a 52-file TypeScript fixture demonstrated a **+28.7% token cost** compared to the unharnessed baseline.

- **Why it happened:** The Graphify tool schemas and query results consumed more tokens than the agent saved by avoiding file reads.
- **Recommendation:** Do not enable Graphify MCP unless the repository contains more than 100 files or has deeply layered cross-module architectures.

### 3. Multi-Agent Orchestration on Routine Tasks

Comparing `helix-min` (single agent with gate) against `helix-nosub` and multi-agent strategies confirms that multi-agent swarms increase token consumption by **+61% to +140%** without increasing pass rates on standard bug fixes.

- **When multi-agent is justified:** Only for high-assurance tasks where independent review is mandatory (e.g. auth/security changes or multi-repo migrations).

---

## 2. Incurred Trade-Offs

| Component                                     | Benefit                                                          | Trade-Off Incurred                                                                    |
| --------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| **Mechanical Validation Gate (`helix gate`)** | 0 model tokens, 100% detection of syntax/type regressions        | Adds 15–30 seconds of local wall-clock execution time per task                        |
| **Strict Path Sandboxing**                    | Prevents reading secrets and traversing out of project           | Blocks legitimate operations if target files are improperly configured in task bounds |
| **Worktree Isolation**                        | Protects main repository from dirty, uncommitted changes         | Requires disk space for worktree copies and brief initialization overhead (~2s)       |
| **APKS Persistent Knowledge**                 | Avoids re-explaining project naming conventions and architecture | Requires maintaining canonical `.helix/knowledge/` files when architecture changes    |

---

## 3. Evaluation Limitations

1. **Provider Nondeterminism:** Free-tier model provider endpoints occasionally suffer from latency spikes and unannounced checkpoint updates.
2. **Rate-Limiting Dropped Pairs:** In the 96-run dataset, the `trace-bug` task was dropped from paired comparisons because the provider returned HTTP 429 rate limits, leaving 0 valid pairs for that specific task.
3. **Synthetic Fixtures vs Production Monorepos:** While `evals/fixture-large` contains 52 files with authentic cross-service dependencies, real-world monorepos carry thousands of files and disparate build tools.
4. **Token Approximation:** Static token costs are calculated via `o200k_base` BPE (approximate tokenizer), which may vary by ±5% from proprietary serving tokenizers.
