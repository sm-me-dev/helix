// Runs both test suites to completion, then fails if either failed. The old `a && b` chain let a
// red .mjs suite hide the whole TypeScript suite (2026-10-12: a red eval test meant no TS result).
import { spawnSync } from "node:child_process";

const npm = process.env.npm_execpath;
const run = (script) => {
  const [cmd, args] = npm
    ? [process.execPath, [npm, "run", "--silent", script]]
    : ["npm", ["run", "--silent", script]];
  console.log(`\n==> ${script}`);
  return spawnSync(cmd, args, { stdio: "inherit" }).status ?? 1;
};

const results = Object.fromEntries(["test:mjs", "test:ts"].map((s) => [s, run(s)]));
const failed = Object.entries(results).filter(([, code]) => code !== 0);
for (const [name, code] of failed) console.error(`FAILED: ${name} (exit ${code})`);
process.exitCode = failed.length > 0 ? 1 : 0;
