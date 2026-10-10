// Measure the instruction tokens an agent sees when it works ON this repo (audit F1).
//
// Usage: node --experimental-strip-types scripts/measure-repo-always-on.mjs [--label before]
//
// Method: o200k_base BPE via gpt-tokenizer (same counter as src/lib/harness/measure.ts).
// Counts, per file, the instruction files that agents auto-load from the repo root or
// from well-known per-agent locations. Which agent loads which file is an ASSUMPTION
// taken from each file's name, not verified here (see docs/DECISIONS.md for vendor
// citations); the `agents` field says which assumption each row rests on.
// Also reports static noise: tracked file/token totals for `.grok/` and the template dirs.
// Static size only: this says nothing about tokens actually spent per task.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { countTokens, TOKENIZER_METHOD } from "../src/lib/harness/measure.ts";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const label = process.argv[process.argv.indexOf("--label") + 1] ?? "run";

const read = (p) => readFileSync(join(ROOT, p), "utf8");
const lines = (t) => (t === "" ? 0 : t.replace(/\n$/, "").split("\n").length);
const tracked = (...paths) =>
  execFileSync("git", ["ls-files", "-z", "--", ...paths], { cwd: ROOT, encoding: "utf8" })
    .split("\0")
    .filter(Boolean);

// [path, agents that auto-load it (assumption by file name)]
const CANDIDATES = [
  ["AGENTS.md", "Codex, Cursor, Copilot, OpenCode, Antigravity (AGENTS.md convention)"],
  ["AGENTS.project.md", "none auto-load it; only read when root AGENTS.md or the user points at it"],
  ["AGENTS.override.md", "Codex (wins over AGENTS.md in the same directory)"],
  ["CLAUDE.md", "Claude Code"],
  ["GEMINI.md", "Gemini CLI / Antigravity"],
  [".github/copilot-instructions.md", "GitHub Copilot"],
];
const files = [];
for (const [p, agents] of CANDIDATES) {
  if (!existsSync(join(ROOT, p))) continue;
  const t = read(p);
  files.push({
    path: p,
    tracked: tracked(p).length > 0,
    lines: lines(t),
    tokens: countTokens(t),
    agents,
  });
}
const cursorDir = join(ROOT, ".cursor", "rules");
if (existsSync(cursorDir)) {
  for (const f of readdirSync(cursorDir)) {
    const p = `.cursor/rules/${f}`;
    const t = read(p);
    files.push({ path: p, tracked: tracked(p).length > 0, lines: lines(t), tokens: countTokens(t), agents: "Cursor" });
  }
}

const noise = (label, paths) => {
  const list = paths.flatMap((p) => tracked(p));
  let tokens = 0;
  for (const f of list) {
    try {
      tokens += countTokens(read(f));
    } catch {
      /* binary or unreadable: not counted */
    }
  }
  return { label, trackedFiles: list.length, tokens };
};

const root = files.find((f) => f.path === "AGENTS.md");
const tok = (p) => files.find((f) => f.path === p)?.tokens ?? 0;
const has = (p) => files.some((f) => f.path === p);
// Claude Code: CLAUDE.md plus its resolved @imports (one level), else AGENTS.md.
const claudeImports = has("CLAUDE.md")
  ? [...read("CLAUDE.md").matchAll(/^@(\S+)$/gm)].map((m) => m[1]).filter((p) => existsSync(join(ROOT, p)))
  : [];
const claudeTokens = has("CLAUDE.md")
  ? tok("CLAUDE.md") + claudeImports.reduce((n, p) => n + countTokens(read(p)), 0)
  : tok("AGENTS.md");
// Effective always-on instruction tokens per agent, derived from the vendor rules in
// docs/F1-MIGRATION-PLAN.md section 2. `status` says what was checked in the real agent.
const perAgent = {
  "claude-code": {
    tokens: claudeTokens,
    chain: has("CLAUDE.md") ? ["CLAUDE.md", ...claudeImports] : ["AGENTS.md"],
    status: has("CLAUDE.md") ? "confirmed 2026-10-10: `claude -p /context` Memory Files lists CLAUDE.md + AGENTS.project.md, not AGENTS.md (its own token column printed 0 in print mode, so this number is ours)" : "rule documented, not run",
  },
  codex: {
    tokens: has("AGENTS.override.md") ? tok("AGENTS.override.md") : tok("AGENTS.md"),
    chain: [has("AGENTS.override.md") ? "AGENTS.override.md" : "AGENTS.md"],
    status: has("AGENTS.override.md") ? "confirmed 2026-10-10: `codex debug prompt-input` contains the Helix rules and none of the root AGENTS.md text" : "rule documented, not run",
  },
  opencode: { tokens: tok("AGENTS.md"), chain: ["AGENTS.md"], status: "rule documented (AGENTS.md beats CLAUDE.md; no skip); not run" },
  "cursor, copilot, antigravity, grok": { tokens: tok("AGENTS.md"), chain: ["AGENTS.md"], status: "ASSUMED (AGENTS.md convention); see DECISIONS.md for what was verified" },
};
const out = {
  label,
  measuredAt: new Date().toISOString().slice(0, 10),
  method: `${TOKENIZER_METHOD}; static size of instruction files; agent-to-file mapping is an assumption`,
  files,
  rootAgentsMdReferencesProject: root ? /AGENTS\.project\.md/.test(read("AGENTS.md")) : null,
  // What a Codex-style agent reads on every session here: AGENTS.md only, unless it follows a pointer.
  alwaysOnRootAgentsMd: root?.tokens ?? 0,
  alwaysOnAllRootFiles: files.filter((f) => !f.path.startsWith(".cursor") && f.path !== "AGENTS.project.md").reduce((n, f) => n + f.tokens, 0),
  perAgent,
  withProjectFile: files.filter((f) => f.path === "AGENTS.md" || f.path === "AGENTS.project.md").reduce((n, f) => n + f.tokens, 0),
  noise: [
    noise(".grok/ (platform chrome)", [".grok"]),
    noise("src/lib/auth + src/lib/app-data + src/components/ui (template)", [
      "src/lib/auth",
      "src/lib/app-data",
      "src/components/ui",
    ]),
  ],
};
console.log(JSON.stringify(out, null, 2));
