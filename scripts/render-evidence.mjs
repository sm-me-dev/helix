// Render the evidence diagrams in docs/EVIDENCE.md from committed result JSON.
//
// Usage:
//   node scripts/render-evidence.mjs           # rewrite the generated block
//   node scripts/render-evidence.mjs --check   # exit 1 if the block is stale
//
// Every number in the block comes from evals/results/static-cost.json
// (scripts/static-cost.mjs). Nothing is typed by hand, so a diagram cannot drift
// from the data; scripts/evidence.test.mjs fails if it does.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { verdict } from "./paired-stats.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const DOC = `${ROOT}docs/EVIDENCE.md`;
const START = "<!-- evidence:static:start -->";
const END = "<!-- evidence:static:end -->";

export function renderStatic(cost) {
  const base = cost.packs.filter((p) => !p.label.endsWith("+ --crew"));
  const crew = cost.packs.filter((p) => p.label.endsWith("+ --crew"));
  const short = (p) => p.label.replace(/ \(.*\)$/, "").replace(" + --crew", "");
  const labels = base.map((p) => `"${short(p)}"`).join(", ");
  const max = Math.max(...cost.packs.map((p) => p.alwaysOn));
  const top = Math.ceil((max * 1.15) / 1000) * 1000;
  const caps = [...cost.mcpCaptures].sort((a, b) => b.schemaTokens - a.schemaTokens);
  const capLabels = caps.map((c) => `"${c.server} (${c.toolCount} tools)"`).join(", ");
  const capTop = Math.ceil((caps[0].schemaTokens * 1.15) / 1000) * 1000;
  const progressive = cost.progressiveDisclosure;
  const est = [
    ...new Set(cost.packs.flatMap((p) => p.mcps.filter((m) => !m.measured).map((m) => m.id))),
  ];

  return [
    START,
    "### Always-on tokens Helix adds, by repo shape",
    "",
    "What an agent carries on every request: `AGENTS.md`, skill index, MCP schemas (and the crew index with `--crew`). A plain agent adds 0, so this is Helix's **cost**.",
    "",
    "```mermaid",
    "xychart-beta",
    '    title "Helix always-on tokens (default pack vs --crew)"',
    `    x-axis [${labels}]`,
    `    y-axis "tokens" 0 --> ${top}`,
    `    bar [${base.map((p) => p.alwaysOn).join(", ")}]`,
    `    bar [${crew.map((p) => p.alwaysOn).join(", ")}]`,
    "```",
    "",
    "| Repo shape | AGENTS.md | skill index | MCP schemas | crew index (`--crew`) | always-on | with `--crew` |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...base.map((p, i) => {
      const c = crew[i];
      return `| ${short(p)} | ${p.agentsMd} | ${p.skillIndex} | ${p.mcpSchemas} | ${c.crewIndex} | ${p.alwaysOn} | ${c.alwaysOn} |`;
    }),
    "",
    `MCP schema weights are measured from live \`tools/list\` captures except ${est.length ? est.join(", ") + " (catalog estimate, unmeasured)" : "none"}. On Claude Code the schemas are deferred by tool search (verified 2026-10-10), so the MCP column does not load there by default; other platforms are assumed to load it.`,
    "",
    "### Progressive disclosure bootstrap",
    "",
    `The always-on bootstrap is **${progressive.coreAndTier0Tokens} tokens**, including a **${progressive.tier0CatalogTokens}-token Tier 0 route catalog**. Compared with the ${progressive.comparisonBaseline} (**${progressive.baselineTokens} tokens**), that is an **${progressive.reductionPercent}% reduction**. The bootstrap stays below 600 tokens, Tier 0 below 250 tokens, and the reduction above 80%.`,
    `Measured ${progressive.measuredAt} using ${cost.method}.`,
    "",
    "```mermaid",
    "xychart-beta",
    '    title "Always-on baseline vs progressive bootstrap"',
    '    x-axis ["baseline", "bootstrap"]',
    `    y-axis "tokens" 0 --> ${Math.ceil((progressive.baselineTokens * 1.15) / 100) * 100}`,
    `    bar [${progressive.baselineTokens}, ${progressive.coreAndTier0Tokens}]`,
    "```",
    "",
    "### What unmanaged MCP loading would cost",
    "",
    `Real captured schemas, loaded every request with no curation: **${cost.mcpAllCapturedLoaded} tokens** for four servers. Helix ships at most five and defaults to one or two.`,
    "",
    "```mermaid",
    "xychart-beta",
    '    title "Schema tokens per MCP server (measured)"',
    `    x-axis [${capLabels}]`,
    `    y-axis "tokens" 0 --> ${capTop}`,
    `    bar [${caps.map((c) => c.schemaTokens).join(", ")}]`,
    "```",
    "",
    "### Zero-token checks",
    "",
    `The gate (secrets, lint, typecheck, affected tests) and the hooks are deterministic scripts: **${cost.gate.modelTokens} model tokens**. ${cost.gate.basis}.`,
    "",
    `Method: ${cost.method}. Source: \`evals/results/static-cost.json\`.`,
    END,
  ].join("\n");
}

const P_START = "<!-- evidence:paired:start -->";
const P_END = "<!-- evidence:paired:end -->";
const PAIRED_JSON = `${ROOT}evals/results/paired-stats.json`;

const signed = (x) => (x == null ? "n/a" : `${x >= 0 ? "+" : ""}${x.toFixed(1)}%`);

/** The measured head-to-head block: every number comes from evals/results/paired-stats.json
 * (scripts/paired-stats.mjs over a committed run). `stats` is null until a run is recorded. */
export function renderPaired(stats, meta = {}) {
  if (!stats || stats.length === 0) {
    return [P_START, "No paired run has been recorded yet.", P_END].join("\n");
  }
  const labels = stats.map((s) => `"${s.arm}"`).join(", ");
  const vals = stats.map((s) => s.pooled.tokenChangePct.toFixed(1));
  const lo = Math.floor(Math.min(0, ...stats.map((s) => s.pooled.ciLowPct)) - 5);
  const hi = Math.ceil(Math.max(0, ...stats.map((s) => s.pooled.ciHighPct)) + 5);
  return [
    P_START,
    `Paired runs, ${meta.agent ?? "agent"}, ${meta.fixture ?? "?"} fixture, ${meta.date ?? "?"}. Each task and run index executes in every arm back to back; the baseline is the same agent with no pack.`,
    "",
    "```mermaid",
    "xychart-beta",
    '    title "Uncached tokens vs no harness (negative = fewer; point estimate)"',
    `    x-axis [${labels}]`,
    `    y-axis "% change" ${lo} --> ${hi}`,
    `    bar [${vals.join(", ")}]`,
    "```",
    "",
    "| Arm | Pairs | Uncached tokens vs none | 95% CI | Passed (arm / none) | Passes lost / gained | Verdict |",
    "| --- | ---: | ---: | --- | ---: | ---: | --- |",
    ...stats.map((s) => {
      const p = s.pooled;
      return `| ${s.arm} | ${p.pairs} | ${signed(p.tokenChangePct)} | ${signed(p.ciLowPct)} .. ${signed(p.ciHighPct)} | ${p.passArm}/${p.pairs} vs ${p.passBaseline}/${p.pairs} | ${p.passLost} / ${p.passGained} | ${verdict(p)} |`;
    }),
    "",
    "Per task (point estimate and 95% CI; each task has few pairs, so read these as direction, not proof):",
    "",
    "| Task | " + stats.map((s) => s.arm).join(" | ") + " |",
    "| --- | " + stats.map(() => "---").join(" | ") + " |",
    ...stats[0].perTask.map(
      (t, i) =>
        `| ${t.task} | ` +
        stats
          .map((s) => {
            const x = s.perTask[i];
            return `${signed(x.tokenChangePct)} (${signed(x.ciLowPct)} .. ${signed(x.ciHighPct)}), n=${x.pairs}`;
          })
          .join(" | ") +
        " |",
    ),
    "",
    'Method: uncached tokens (input + output + reasoning + cache writes, cache reads excluded) from the agent\'s own session transcript; paired log-ratio bootstrap (10,000 resamples, seed 1) for the interval; exact sign test on discordant pass/fail pairs. Pairs where either side hit a provider rate limit or hung with zero tokens are dropped. A verdict of "no detectable difference" means the interval includes zero, not that the arms are equal.',
    P_END,
  ].join("\n");
}

function splice(doc, block, start = START, end = END) {
  const a = doc.indexOf(start);
  const b = doc.indexOf(end);
  if (a === -1 || b === -1) throw new Error(`markers ${start} missing in ${DOC}`);
  return doc.slice(0, a) + block + doc.slice(b + end.length);
}

export function renderedDoc() {
  const cost = JSON.parse(readFileSync(`${ROOT}evals/results/static-cost.json`, "utf8"));
  let paired = null;
  let meta = {};
  if (existsSync(PAIRED_JSON)) {
    const raw = JSON.parse(readFileSync(PAIRED_JSON, "utf8"));
    paired = raw.stats ?? (Array.isArray(raw) ? raw : null);
    meta = raw.meta ?? {};
  }
  const withStatic = splice(readFileSync(DOC, "utf8"), renderStatic(cost));
  return splice(withStatic, renderPaired(paired, meta), P_START, P_END);
}

if (process.argv[1] && process.argv[1].endsWith("render-evidence.mjs")) {
  const next = renderedDoc();
  if (process.argv[2] === "--check") {
    if (next !== readFileSync(DOC, "utf8")) {
      console.error("docs/EVIDENCE.md is stale: run node scripts/render-evidence.mjs");
      process.exit(1);
    }
    console.log("docs/EVIDENCE.md is current");
  } else {
    writeFileSync(DOC, next);
    console.log(`rendered ${DOC}`);
  }
}
