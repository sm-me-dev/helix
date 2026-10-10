#!/usr/bin/env node
// Projected token cost of the Helix Claude Code plugin, as reported by Claude Code itself.
//
// Method: `helix plugin` writes the marketplace into a throwaway directory, the plugin is
// installed into a throwaway HOME/CLAUDE_CONFIG_DIR (the real ~/.claude is never read or
// written), then `claude plugin details helix` is parsed. No model call, no cost.
// The numbers are Claude Code's own ESTIMATES ("may differ from actual usage"), not measured
// usage, and the command is deterministic, so there is no run-to-run variance to report.
//
// Usage: node scripts/measure-plugin.mjs [--label after] [--out fixtures/measurements/plugin-details.json]
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};
const label = opt("--label", "current");
const outFile = resolve(ROOT, opt("--out", "fixtures/measurements/plugin-details.json"));

const tmp = mkdtempSync(join(tmpdir(), "helix-measure-plugin-"));
const env = { ...process.env, HOME: tmp, CLAUDE_CONFIG_DIR: join(tmp, ".claude") };
delete env.NODE_ENV;

function run(cmd, argv, extra = {}) {
  const r = spawnSync(cmd, argv, { encoding: "utf8", env, timeout: 120_000, ...extra });
  if (r.status !== 0) {
    throw new Error(`${cmd} ${argv.join(" ")} failed (${r.status}): ${r.stderr || r.stdout}`);
  }
  return r.stdout;
}

try {
  const version = run("claude", ["--version"]).trim();
  run(process.execPath, [
    "--experimental-strip-types",
    join(ROOT, "cli/helix.mjs"),
    "plugin",
    "--out",
    join(tmp, "mkt"),
  ]);
  run("claude", ["plugin", "marketplace", "add", join(tmp, "mkt")]);
  run("claude", ["plugin", "install", "helix@helix-harness"]);
  const text = run("claude", ["plugin", "details", "helix"]);

  const always = text.match(/Always-on:\s+~(\d+) tok/);
  if (!always) throw new Error(`could not find the always-on line in:\n${text}`);
  const components = {};
  for (const m of text.matchAll(/^\s{2}([a-z-]+)\s+~(\d+)\s+~(\d+)\s*$/gm)) {
    components[m[1]] = { alwaysOn: Number(m[2]), onInvoke: Number(m[3]) };
  }
  const result = {
    label,
    date: new Date().toISOString().slice(0, 10),
    method:
      "claude plugin details helix, plugin installed into a throwaway HOME; estimates by Claude Code, no model call",
    claudeVersion: version,
    alwaysOnTokens: Number(always[1]),
    components,
    raw: text,
  };
  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, JSON.stringify(result, null, 2) + "\n");
  console.log(`always-on ~${result.alwaysOnTokens} tok (${version}) -> ${outFile}`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
