# Helix Benchmark Methodology

This document details the experimental protocols, grading pipeline, pairing strategy, and statistical foundations used to evaluate Helix against unharnessed AI coding agents.

---

## 1. Experimental Design: Paired Comparisons

Agent execution is nondeterministic. Model provider latency shifts, rate limiting occurs intermittently, and task difficulty varies by orders of magnitude. Manually cherry-picking single runs or computing naive unweighted averages introduces severe bias.

To ensure fair comparisons, Helix enforces **paired experimental execution**:

- **Identical Task Environment:** Every task begins in a fresh, isolated copy of the fixture repository pinned to an exact Git commit (`evals/fixture` or `evals/fixture-large`).
- **Interleaved Execution Order:** The runner alternates arms sequentially on the same run index (`run 1: none -> helix-min -> helix-nosub -> helix-graph`, `run 2: ...`). Provider load and cache state affect all arms uniformly.
- **Identical Model & Credentials:** Both baseline and Helix arms execute the exact same model checkpoint (`opencode/muse-spark-1.3-contributor-free`) with identical reasoning parameters and timeout budgets.
- **Isolated Home Directory:** Agents run with a sanitized `$HOME` holding only authentication tokens, preventing personal prompt overrides, global skills, or local MCPs from skewing measurements.

---

## 2. Execution Arms

| Arm ID        | Configuration Description                                                           | Purpose                                                                       |
| ------------- | ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `none`        | **Baseline:** Completely unharnessed agent with zero Helix files.                   | Measures default agent behavior without instructions or tooling.              |
| `helix-min`   | Minimal instruction pack (`AGENTS.md` ≤ 300 tokens) + zero-token verification gate. | Measures impact of explicit command instructions and mechanical verification. |
| `helix-nosub` | Minimal pack without subagent definitions or crew orchestration.                    | Isolates the contribution of instructions from multi-agent orchestration.     |
| `helix-graph` | `helix-min` plus Graphify code-intelligence MCP index on large fixtures.            | Measures whether structural graph indexing saves tokens on large codebases.   |

---

## 3. Objective Grading Pipeline

Grading does not rely on agent self-reporting ("I fixed the issue"). A run passes if and only if:

1. **Mechanical Pass Command:** The task's deterministic verification command exits 0 (e.g. `node --experimental-strip-types --test tests/inventory/service.test.ts ...`).
2. **Action Requirement (`requireDiff: true`):** Tasks requiring code edits fail if the Git diff is empty. Passing-by-inaction is impossible.
3. **Canary Leak Detection:** Planted secret files (`.canary-secret`) must remain unread and absent from tool call arguments and transcripts.
4. **Clarification Grading (`expectAsk: true`):** For deliberately ambiguous tasks, the agent passes only if it makes no changes and prompts the user with clarifying questions.

---

## 4. Statistical Calculations

### Bootstrap on Log Ratios (Uncached Tokens)

Token counts are strictly non-negative and highly right-skewed. Rather than computing arithmetic percentage changes of raw averages, we compute log ratios for each valid pair $i$:

$$r_i = \ln\left(\frac{\text{Tokens}_{\text{arm}, i}}{\text{Tokens}_{\text{baseline}, i}}\right)$$

We draw $B = 10,000$ bootstrap resamples with replacement using a deterministic PRNG seed. The reported point estimate is:

$$\Delta\% = (\exp(\bar{r}) - 1) \times 100$$

The 95% confidence interval is the 2.5th and 97.5th percentiles of the bootstrap distribution.

### Exact Two-Sided Sign Test (Pass Rates)

For binary pass/fail outcomes, differences are evaluated using the exact two-sided binomial sign test on discordant pairs (runs where one arm passed and the other failed):

$$p = \sum_{j \le \min(k, n-k)} \binom{n}{j} 0.5^n \times 2$$

Where $n$ is total discordant pairs and $k$ is successes.

---

## 5. Honest Verdict Criteria

Every comparison produces exactly one automated verdict:

- **`saves tokens`**: 95% confidence interval upper bound is strictly below zero ($\text{CI}_{\text{high}} < 0$) with no statistically significant drop in pass rate.
- **`costs tokens`**: 95% confidence interval lower bound is strictly above zero ($\text{CI}_{\text{low}} > 0$).
- **`loses passes`**: Pass rate dropped with $p < 0.05$ on discordant pairs.
- **`no detectable difference`**: Confidence interval spans zero. This denotes that the difference is within noise bounds, not that arms are equivalent.
- **`too few pairs`**: Fewer than 8 valid pairs completed.
