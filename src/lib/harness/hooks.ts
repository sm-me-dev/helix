// Real Claude Code hook scripts, shipped verbatim into the pack.
// Verified 2026-10-07 against https://code.claude.com/docs/en/hooks :
// command hooks read event JSON on stdin; exit 0 = allow, exit 2 = block
// with stderr feedback; PreToolUse decides via hookSpecificOutput, Stop can
// block to continue the conversation, PostToolUse cannot block.
// Each source is dependency-free (node: only), cross-platform, <100 lines.

const LOG_HELPER = `
function log(msg) {
  try {
    var dir = path.join(process.cwd(), ".helix", "hooks");
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(
      path.join(dir, "hooks.log"),
      new Date().toISOString() + " " + msg + "\\n",
    );
  } catch (e) { /* fail open */ }
}
`;

export const PREFER_GRAPH_HOOK = `#!/usr/bin/env node
// Helix PreToolUse (matcher Read|Grep|Glob): steer wide searches to Graphify.
// Advisory only, exit 0 always. The hint travels in hookSpecificOutput
// additionalContext on stdout — stderr on exit 0 reaches only the debug log,
// never the model (verified 2026-10-09 against
// https://code.claude.com/docs/en/hooks). A Read with an explicit line range
// passes untouched (no output at all).
import fs from "node:fs";
import path from "node:path";
${LOG_HELPER}
function hint() {
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", additionalContext: "Wide filesystem search in this repo. The mcp__graphify__query_graph / get_neighbors / shortest_path tools usually answer it; then Read the cited range." } }) + "\\n");
}
function wide(s) {
  return typeof s === "string" && (s.includes("**") || s === "./" || s === "." || s.endsWith("/*"));
}
try {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  const input = JSON.parse(chunks.join("") || "{}");
  const tool = input.tool_name || "";
  const arg = input.tool_input || {};
  if (tool === "Glob" || tool === "Grep") {
    if (wide(arg.pattern) || wide(arg.path)) hint();
  } else if (tool === "Read") {
    if (arg.offset === undefined && arg.limit === undefined) {
      const fp = arg.file_path || "";
      if (wide(fp)) {
        hint();
      } else {
        try {
          const lines = fs.readFileSync(path.resolve(process.cwd(), fp), "utf8").split("\\n").length;
          if (lines > 400) hint();
        } catch (e) { /* unreadable: the tool itself will error */ }
      }
    }
  }
  process.exit(0);
} catch (e) {
  log("prefer-graph error " + String((e && e.message) || e));
  process.exit(0);
}
`;

export const FORMAT_LINT_HOOK = `#!/usr/bin/env node
// Helix PostToolUse (matcher Edit|Write): run the repo formatter on the edited file only.
// Fail open: exit 0 always; internal errors go to .helix/hooks/hooks.log.
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
${LOG_HELPER}
const TIMEOUT = 20000;
function run(cmd, args, cwd) {
  return new Promise((resolve) => {
    execFile(cmd, args, { cwd, timeout: TIMEOUT }, (err) => resolve(!err));
  });
}
function walkUp(start, names) {
  let dir = start;
  while (true) {
    for (const n of names) if (fs.existsSync(path.join(dir, n))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}
function pkgHas(pkgPath, dep) {
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    return Boolean(Object.assign({}, pkg.dependencies, pkg.devDependencies)[dep]);
  } catch (e) {
    return false;
  }
}
function bin(root, name) {
  const b = path.join(root, "node_modules", ".bin", name);
  return process.platform === "win32" ? b + ".cmd" : b;
}
try {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  const input = JSON.parse(chunks.join("") || "{}");
  const fp = input.tool_input && input.tool_input.file_path;
  if (!fp) process.exit(0);
  const abs = path.resolve(process.cwd(), fp);
  if (!fs.existsSync(abs)) process.exit(0);
  const ext = path.extname(abs);
  const start = path.dirname(abs);
  if (ext === ".go" && walkUp(start, ["go.mod"])) {
    await run("gofmt", ["-w", abs], start);
  } else if (ext === ".rs" && walkUp(start, ["Cargo.toml"])) {
    await run("rustfmt", [abs], start);
  } else if (ext === ".py" && walkUp(start, ["ruff.toml", ".ruff.toml", "pyproject.toml"])) {
    await run("ruff", ["format", abs], start);
    await run("ruff", ["check", "--fix", abs], start);
  } else if (".js.jsx.ts.tsx.mjs.cjs.json.css.md.".includes(ext + ".")) {
    const root = walkUp(start, ["package.json"]);
    if (root) {
      const pkg = path.join(root, "package.json");
      if (pkgHas(pkg, "prettier") || walkUp(start, [".prettierrc", ".prettierrc.json", "prettier.config.js"])) {
        if (fs.existsSync(bin(root, "prettier"))) await run(bin(root, "prettier"), ["--write", abs], root);
      }
      if (pkgHas(pkg, "eslint") || walkUp(start, ["eslint.config.js", "eslint.config.mjs", ".eslintrc.json"])) {
        if (fs.existsSync(bin(root, "eslint"))) await run(bin(root, "eslint"), ["--fix", abs], root);
      }
      if (pkgHas(pkg, "@biomejs/biome") || walkUp(start, ["biome.json", "biome.jsonc"])) {
        if (fs.existsSync(bin(root, "biome"))) await run(bin(root, "biome"), ["check", "--write", abs], root);
      }
    }
  }
  process.exit(0);
} catch (e) {
  log("format-lint error " + String((e && e.message) || e));
  process.exit(0);
}
`;

export const TEST_ON_STOP_HOOK = `#!/usr/bin/env node
// Helix Stop: run the repo test command only if Edit/Write happened this session.
// Pass (or no edits, or no test command) -> exit 0 silent.
// Fail -> exit 2 with a short tail, the documented Stop channel to continue the turn.
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
${LOG_HELPER}
function walkUp(start, names) {
  let dir = start;
  while (true) {
    for (const n of names) if (fs.existsSync(path.join(dir, n))) return { dir, found: n };
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}
function testCmd(dir) {
  const hit = walkUp(dir, ["package.json", "Makefile", "justfile", "Justfile"]);
  if (!hit) return null;
  if (hit.found === "package.json") {
    try {
      if (!JSON.parse(fs.readFileSync(path.join(hit.dir, "package.json"), "utf8")).scripts.test) return null;
    } catch (e) {
      return null;
    }
    let pm = ["npm", "test"];
    if (fs.existsSync(path.join(hit.dir, "bun.lockb"))) pm = ["bun", "run", "test"];
    else if (fs.existsSync(path.join(hit.dir, "yarn.lock"))) pm = ["yarn", "test"];
    else if (fs.existsSync(path.join(hit.dir, "pnpm-lock.yaml"))) pm = ["pnpm", "test"];
    if (process.platform === "win32") pm = [pm[0] + ".cmd", ...pm.slice(1)];
    return { cmd: pm[0], args: pm.slice(1), cwd: hit.dir };
  }
  if (hit.found === "Makefile") return { cmd: "make", args: ["test"], cwd: hit.dir };
  return { cmd: "just", args: ["test"], cwd: hit.dir };
}
try {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  const input = JSON.parse(chunks.join("") || "{}");
  const cwd = input.cwd || process.cwd();
  let edited = false;
  try {
    const lines = fs.readFileSync(input.transcript_path, "utf8").split("\\n").slice(-4000);
    edited = lines.some((l) => /"name"\\s*:\\s*"(Edit|Write|MultiEdit|NotebookEdit)"/.test(l));
  } catch (e) {
    process.exit(0);
  }
  if (!edited) process.exit(0);
  const t = testCmd(cwd);
  if (!t) process.exit(0);
  execFile(t.cmd, t.args, { cwd: t.cwd, timeout: 55000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
    if (!err) process.exit(0);
    if (err.killed || err.code === "ENOENT" || err.code === "ETIMEDOUT") {
      log("test-on-stop skipped (" + String(err.code || "timeout") + ")");
      process.exit(0);
    }
    const tail = String(stdout + "\\n" + stderr).trim().split("\\n").slice(-30).join("\\n");
    process.stderr.write("[helix] tests failed after this session edits:\\n" + tail + "\\n");
    process.exit(2);
  });
} catch (e) {
  log("test-on-stop error " + String((e && e.message) || e));
  process.exit(0);
}
`;

export const HOOK_SOURCES = {
  "prefer-graph": PREFER_GRAPH_HOOK,
  "format-lint": FORMAT_LINT_HOOK,
  "test-on-stop": TEST_ON_STOP_HOOK,
} as const;
