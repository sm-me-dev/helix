// Paired statistics for eval result JSON: does an arm cost fewer tokens than the baseline at
// equal pass rate, and is the difference bigger than the noise?
//
// Usage: node scripts/paired-stats.mjs <results.json> [--baseline none] [--out stats.json] [--seed 1]
//
// Why paired: the same task and run index is executed in every arm back to back (the runner's
// interleaved order), so pairing removes task difficulty and most provider drift. Why a
// bootstrap on log ratios: token counts are skewed and tasks differ in size; a ratio is scale
// free, and resampling pairs makes no normality assumption. Why a sign test for passes: the
// exact test on discordant pairs is the standard paired test for binary outcomes. With every
// arm near 100% pass there are almost no discordant pairs, so a "no difference" pass result
// only means "not worse than detectable", never "better". The verdict says that plainly.
import { readFileSync, writeFileSync } from "node:fs";

/** Seeded PRNG (mulberry32) so the same input always yields the same interval. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Exact two-sided sign test: k successes of n discordant pairs under p = 0.5. */
export function signTestP(k, n) {
  if (n === 0) return 1;
  const m = Math.min(k, n - k);
  let tail = 0;
  let c = 1; // C(n, 0)
  for (let i = 0; i <= m; i++) {
    tail += c;
    c = (c * (n - i)) / (i + 1);
  }
  return Math.min(1, (2 * tail) / 2 ** n);
}

const usable = (r) => !r.invalid && !r.hung;

/** Pair cells of `armA` (baseline) and `armB` by task and run. A pair needs both sides valid. */
export function pairCells(cells, armA, armB) {
  const key = (r) => `${r.task}#${r.run}`;
  const a = new Map(cells.filter((r) => r.arm === armA).map((r) => [key(r), r]));
  const pairs = [];
  let dropped = 0;
  for (const rb of cells.filter((r) => r.arm === armB)) {
    const ra = a.get(key(rb));
    if (!ra) continue;
    if (!usable(ra) || !usable(rb) || !(ra.uncachedTokens > 0) || !(rb.uncachedTokens > 0)) {
      dropped++;
      continue;
    }
    pairs.push({ task: rb.task, run: rb.run, a: ra, b: rb });
  }
  return { pairs, dropped };
}

const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;
const median = (xs) => {
  const s = [...xs].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const pct = (logRatio) => (Math.exp(logRatio) - 1) * 100;

/** Compare armB to baseline armA over paired cells. Percent figures are arm vs baseline:
 * negative means the arm used fewer uncached tokens. */
export function compareArms(cells, armA, armB, { seed = 1, boots = 10000 } = {}) {
  const { pairs, dropped } = pairCells(cells, armA, armB);
  const logs = pairs.map((p) => Math.log(p.b.uncachedTokens / p.a.uncachedTokens));
  const n = logs.length;
  const rand = rng(seed);
  const means = [];
  if (n > 0) {
    for (let i = 0; i < boots; i++) {
      let s = 0;
      for (let j = 0; j < n; j++) s += logs[(rand() * n) | 0];
      means.push(s / n);
    }
    means.sort((x, y) => x - y);
  }
  const passLost = pairs.filter((p) => p.a.pass && !p.b.pass).length;
  const passGained = pairs.filter((p) => !p.a.pass && p.b.pass).length;
  const wall = pairs.map((p) => (p.b.wallSec ?? 0) / Math.max(p.a.wallSec ?? 1, 1));
  return {
    armA,
    armB,
    pairs: n,
    dropped,
    tokenChangePct: n ? pct(mean(logs)) : null,
    ciLowPct: n ? pct(means[Math.floor(0.025 * boots)]) : null,
    ciHighPct: n ? pct(means[Math.ceil(0.975 * boots) - 1]) : null,
    medianBaselineUncached: n ? median(pairs.map((p) => p.a.uncachedTokens)) : null,
    medianArmUncached: n ? median(pairs.map((p) => p.b.uncachedTokens)) : null,
    passBaseline: pairs.filter((p) => p.a.pass).length,
    passArm: pairs.filter((p) => p.b.pass).length,
    passLost,
    passGained,
    passSignP: signTestP(passLost, passLost + passGained),
    wallRatioMedian: n ? median(wall) : null,
  };
}

/** One honest label per comparison. Order matters: a pass-rate loss beats any token saving. */
export function verdict(r) {
  if (r.pairs < 8) return "too few pairs";
  if (r.passLost > r.passGained && r.passSignP < 0.05) return "loses passes";
  if (r.ciHighPct < 0) return "saves tokens";
  if (r.ciLowPct > 0) return "costs tokens";
  return "no detectable difference";
}

/** Group comparisons: every arm against the baseline, pooled and per task. */
export function analyze(results, baseline = "none", opts = {}) {
  const cells = results.results ?? results;
  const arms = [...new Set(cells.map((r) => r.arm))].filter((a) => a !== baseline);
  const tasks = [...new Set(cells.map((r) => r.task))];
  return arms.map((arm) => ({
    arm,
    pooled: compareArms(cells, baseline, arm, opts),
    perTask: tasks.map((t) => ({
      task: t,
      ...compareArms(
        cells.filter((r) => r.task === t),
        baseline,
        arm,
        opts,
      ),
    })),
  }));
}

if (process.argv[1]?.endsWith("paired-stats.mjs")) {
  const args = process.argv.slice(2);
  const file = args.find(
    (a) =>
      !a.startsWith("--") &&
      args[args.indexOf(a) - 1] !== "--baseline" &&
      args[args.indexOf(a) - 1] !== "--out" &&
      args[args.indexOf(a) - 1] !== "--seed",
  );
  const opt = (name, d) => (args.includes(name) ? args[args.indexOf(name) + 1] : d);
  if (!file) {
    console.error(
      "usage: node scripts/paired-stats.mjs <results.json> [--baseline none] [--out file] [--seed n]",
    );
    process.exit(2);
  }
  const data = JSON.parse(readFileSync(file, "utf8"));
  const out = analyze(data, opt("--baseline", "none"), { seed: Number(opt("--seed", 1)) });
  const f = (x) => (x == null ? "n/a" : `${x >= 0 ? "+" : ""}${x.toFixed(1)}%`);
  for (const a of out) {
    const p = a.pooled;
    console.log(
      `${a.arm} vs ${p.armA}: ${f(p.tokenChangePct)} uncached tokens (95% CI ${f(p.ciLowPct)} .. ${f(p.ciHighPct)}), ` +
        `${p.pairs} pairs, pass ${p.passArm}/${p.pairs} vs ${p.passBaseline}/${p.pairs}, verdict: ${verdict(p)}`,
    );
  }
  if (opt("--out", null)) writeFileSync(opt("--out", ""), JSON.stringify(out, null, 2) + "\n");
}
