// Stage A of the verification pipeline, shipped verbatim as .helix/gate.mjs and
// run by `helix gate`. It performs secret scan, lint, typecheck, and affected
// tests with zero model tokens. Stage B lives in engine/validator.ts and may
// run only after this deterministic gate reports success.
//
// Verified 2026-10-09 (tool CLIs, not platform protocol):
// - Jest: `jest --passWithNoTests --findRelatedTests <files...>` — files must
//   come last (https://jestjs.io/docs/cli, archive.jestjs.io/docs/en/cli).
// - Vitest: `vitest related <files...> --run --passWithNoTests`
//   (https://github.com/vitest-dev/vitest/blob/main/docs/guide/cli.md).
// Any other runner has no verified "related" mode, so the gate runs the full
// configured test command rather than guess flags.
//
// Exit codes: 0 all checks passed (or nothing changed) · 1 a check failed ·
// 2 usage error. Passing steps print one line; failing steps print a capped tail.

export const GATE_SOURCE = `#!/usr/bin/env node
// Helix gate Stage A: deterministic pre-finish check. Never invokes an LLM.
// node .helix/gate.mjs [--all] [--dry] [--json]
//   (default) changed files only · --all every tracked file and the full suite
//   --dry print the plan, run nothing · --json machine-readable result
// Exit: 0 pass or nothing changed · 1 a check failed · 2 usage error.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const argv = process.argv.slice(2);
const bad = argv.filter((a) => a !== "--all" && a !== "--dry" && a !== "--json");
if (bad.length) {
  process.stderr.write("helix gate: unknown option " + bad[0] + " (use --all, --dry, --json)\\n");
  process.exit(2);
}
const ALL = argv.includes("--all");
const DRY = argv.includes("--dry");
const AS_JSON = argv.includes("--json");
const TAIL_LINES = 25;
const TAIL_CHARS = 2000;
const TIMEOUT = Number(process.env.HELIX_GATE_TIMEOUT_MS) || 600000;

function git(cwd, args) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return r.status === 0 ? String(r.stdout) : null;
}
const top = git(process.cwd(), ["rev-parse", "--show-toplevel"]);
const root = top ? top.trim() : process.cwd();
const readText = (p) => {
  try {
    return fs.readFileSync(p, "utf8");
  } catch (e) {
    return null;
  }
};
const readJson = (p) => {
  try {
    return JSON.parse(readText(p));
  } catch (e) {
    return null;
  }
};

function changedFiles() {
  if (ALL) {
    const out = git(root, ["ls-files", "-z"]);
    return out === null ? null : out.split("\\0").filter(Boolean);
  }
  const out = git(root, ["status", "--porcelain=v1", "-z", "-uall"]);
  if (out === null) return null;
  const parts = out.split("\\0");
  const files = [];
  for (let i = 0; i < parts.length; i++) {
    const e = parts[i];
    if (e.length < 4) continue;
    const xy = e.slice(0, 2);
    if (xy[0] === "R" || xy[0] === "C") i++;
    if (xy.indexOf("D") !== -1) continue;
    files.push(e.slice(3));
  }
  return files;
}

function pathContainmentFailures(files) {
  if (!files) return [];
  const rootReal = fs.realpathSync(root);
  const failures = [];
  for (const file of files) {
    const target = path.resolve(root, file);
    const relative = path.relative(root, target);
    if (relative === ".." || relative.startsWith(".." + path.sep) || path.isAbsolute(relative)) {
      failures.push(file + " escapes the repository root");
      continue;
    }
    if (!fs.existsSync(target)) continue;
    try {
      const real = fs.realpathSync(target);
      const realRelative = path.relative(rootReal, real);
      if (realRelative === ".." || realRelative.startsWith(".." + path.sep) || path.isAbsolute(realRelative)) {
        failures.push(file + " resolves outside the repository root");
      }
    } catch (e) {
      failures.push(file + " could not be resolved safely");
    }
  }
  return failures;
}

function normalizeRouteGlob(glob) {
  const normalized = glob.replace(/\\\\/g, "/").replace(/^\\.\\//, "").replace(/\\/$/, "");
  return !/[*?{}]/.test(normalized) && !/\\.[a-z0-9]+$/i.test(normalized) ? normalized + "/**" : normalized;
}

function pathMatchesGlob(file, glob) {
  const target = file.replace(/\\\\/g, "/");
  const memo = new Map();
  function match(fileIndex, globIndex) {
    const key = fileIndex + ":" + globIndex;
    if (memo.has(key)) return memo.get(key);
    let result;
    if (globIndex === glob.length) result = fileIndex === target.length;
    else if (glob[globIndex] === "*" && glob[globIndex + 1] === "*") {
      result = match(fileIndex, globIndex + 2) || (fileIndex < target.length && match(fileIndex + 1, globIndex));
    } else if (glob[globIndex] === "*") {
      result = match(fileIndex, globIndex + 1) || (fileIndex < target.length && target[fileIndex] !== "/" && match(fileIndex + 1, globIndex));
    } else if (glob[globIndex] === "?") {
      result = fileIndex < target.length && target[fileIndex] !== "/" && match(fileIndex + 1, globIndex + 1);
    } else {
      result = fileIndex < target.length && target[fileIndex] === glob[globIndex] && match(fileIndex + 1, globIndex + 1);
    }
    memo.set(key, result);
    return result;
  }
  return match(0, 0);
}

function touchedDomainScripts(files) {
  if (!files || files.length === 0) return [];
  const domainRoot = path.join(root, ".helix", "knowledge", "domains");
  if (!fs.existsSync(domainRoot)) return [];
  const normalizedFiles = files.map((file) => file.replace(/\\\\/g, "/"));
  const scripts = [];
  for (const entry of fs.readdirSync(domainRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const domainDir = path.join(domainRoot, entry.name);
    const domainPrefix = ".helix/knowledge/domains/" + entry.name + "/";
    const metadata = readText(path.join(domainDir, "domain.md")) || readText(path.join(domainDir, "SKILL.md")) || "";
    let readingGlobs = false;
    const globs = [];
    for (const line of metadata.split(/\\r?\\n/)) {
      if (/^\\s*(source_paths|path_globs|pathGlobs):\\s*$/.test(line)) {
        readingGlobs = true;
        continue;
      }
      if (readingGlobs && /^\\s*-\\s+/.test(line)) {
        const value = line.replace(/^\\s*-\\s+/, "").trim().replace(/^['"]|['"]$/g, "");
        if (value) globs.push(normalizeRouteGlob(value));
        continue;
      }
      if (readingGlobs && line.trim() && !/^\\s/.test(line)) readingGlobs = false;
    }
    const domainFiles = normalizedFiles.filter((file) =>
      file.startsWith(domainPrefix) || globs.some((glob) => pathMatchesGlob(file, glob)),
    );
    if (domainFiles.length === 0) continue;
    const scriptRoot = path.join(domainDir, "scripts");
    if (!fs.existsSync(scriptRoot)) continue;
    for (const script of fs.readdirSync(scriptRoot).filter((name) => name.endsWith(".mjs")).sort()) {
      const scriptPath = path.join(scriptRoot, script);
      if (fs.statSync(scriptPath).isFile()) {
        scripts.push({
          name: "domain-script:" + entry.name + "/" + script,
          argv: [process.execPath, path.relative(root, scriptPath), ...domainFiles],
        });
      }
    }
  }
  return scripts;
}

const cfg = readJson(path.join(root, ".helix", "gate.json")) || {};
const pkg = readJson(path.join(root, "package.json"));
const makefile = readText(path.join(root, "Makefile")) || readText(path.join(root, "makefile"));

function pm() {
  if (cfg.packageManager) return cfg.packageManager;
  const has = (n) => fs.existsSync(path.join(root, n));
  if (has("bun.lockb") || has("bun.lock")) return "bun";
  if (has("yarn.lock")) return "yarn";
  if (has("pnpm-lock.yaml")) return "pnpm";
  return "npm";
}
function script(name) {
  if (!pkg || !pkg.scripts || !pkg.scripts[name]) return null;
  const m = pm();
  if (name === "test" && (m === "npm" || m === "yarn")) return m + " test";
  return m + " run " + name;
}
function pick(key, scripts, target) {
  if (typeof cfg[key] === "string") return cfg[key];
  for (const s of scripts) {
    const c = script(s);
    if (c) return c;
  }
  if (makefile && new RegExp("^" + target + ":", "m").test(makefile)) return "make " + target;
  return null;
}
function typecheckCmd() {
  const c = pick("typecheck", ["typecheck", "type-check"], "typecheck");
  if (c) return c;
  const tsc = path.join(root, "node_modules", ".bin", "tsc");
  if (fs.existsSync(path.join(root, "tsconfig.json")) && fs.existsSync(tsc)) return "npx --no-install tsc --noEmit";
  return null;
}
function affectedTest(files) {
  if (ALL || !pkg || !files) return null;
  const deps = Object.assign({}, pkg.dependencies, pkg.devDependencies);
  const src = files.filter((f) => /\\.[cm]?[jt]sx?$/.test(f));
  if (src.length === 0) return null;
  const npx = process.platform === "win32" ? "npx.cmd" : "npx";
  if (deps.vitest) {
    return {
      argv: [npx, "--no-install", "vitest", "related"].concat(src, ["--run", "--passWithNoTests"]),
      note: "vitest related, " + src.length + " file(s)",
    };
  }
  if (deps.jest) {
    return {
      argv: [npx, "--no-install", "jest", "--passWithNoTests", "--findRelatedTests"].concat(src),
      note: "jest related, " + src.length + " file(s)",
    };
  }
  return null;
}

const SECRET_PATTERNS = [
  ["aws-access-key", /\\bAKIA[0-9A-Z]{16}\\b/],
  ["private-key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ["github-token", /\\bgh[pousr]_[A-Za-z0-9]{36,}\\b/],
  ["slack-token", /\\bxox[baprs]-[A-Za-z0-9-]{10,}/],
  ["sk-api-key", /\\bsk-[A-Za-z0-9_-]{32,}/],
  ["assigned-secret", /(?:api[_-]?key|secret|token|passw(?:or)?d)["']?\\s*[:=]\\s*["'][^"'\\s]{16,}["']/i],
];
const PLACEHOLDER = /example|changeme|placeholder|your[_-]|xxxx|\\*\\*\\*|\\$\\{|process\\.env|<[a-z_-]+>/i;
const SKIP_FILE = /(^|\\/)(node_modules|\\.git)\\/|(^|\\/)(package-lock\\.json|yarn\\.lock|pnpm-lock\\.yaml|bun\\.lockb?|Cargo\\.lock|[^/]*\\.lock)$/;
function scanSecrets(files) {
  const found = [];
  for (const f of files) {
    if (SKIP_FILE.test(f)) continue;
    const base = path.basename(f);
    if (/^\\.env(\\..+)?$/.test(base) && !/\\.(example|sample|template|dist)$/.test(base)) {
      found.push(f + " env-file (never commit real env files)");
      continue;
    }
    let buf;
    try {
      const abs = path.join(root, f);
      if (fs.statSync(abs).size > 1024 * 1024) continue;
      buf = fs.readFileSync(abs);
    } catch (e) {
      continue;
    }
    if (buf.slice(0, 8000).includes(0)) continue;
    const lines = buf.toString("utf8").split("\\n");
    for (let i = 0; i < lines.length; i++) {
      for (const [name, re] of SECRET_PATTERNS) {
        const m = re.exec(lines[i]);
        if (m && !PLACEHOLDER.test(m[0])) found.push(f + ":" + (i + 1) + " " + name);
      }
    }
  }
  return found;
}

function tail(text) {
  const clean = String(text).replace(/\\x1b\\[[0-9;]*[A-Za-z]/g, "").trimEnd();
  let out = clean.split("\\n").slice(-TAIL_LINES).join("\\n");
  if (out.length > TAIL_CHARS) out = "..." + out.slice(-TAIL_CHARS);
  return out;
}
function exec(step) {
  const t0 = Date.now();
  const opts = { cwd: root, encoding: "utf8", timeout: TIMEOUT, maxBuffer: 64 * 1024 * 1024 };
  const r = step.argv
    ? spawnSync(step.argv[0], step.argv.slice(1), opts)
    : spawnSync(step.cmd, Object.assign({ shell: true }, opts));
  step.ms = Date.now() - t0;
  if (r.error) {
    step.status = "fail";
    step.code = r.error.code === "ETIMEDOUT" ? "timeout" : String(r.error.code || r.error.message);
    step.tail = tail(String(r.stdout || "") + String(r.stderr || "") + "\\n" + step.code);
    return;
  }
  step.code = r.status;
  step.status = r.status === 0 ? "pass" : "fail";
  if (step.status === "fail") step.tail = tail(String(r.stdout || "") + "\\n" + String(r.stderr || ""));
}

const files = changedFiles();
if (!DRY && files !== null && files.length === 0) {
  process.stdout.write(AS_JSON ? JSON.stringify({ ok: true, changed: 0, steps: [] }) + "\\n" : "helix gate: nothing changed\\n");
  process.exit(0);
}

const steps = [];
steps.push(files === null ? { name: "secrets", skip: "not a git repo" } : { name: "secrets", scan: true });
steps.push(files === null ? { name: "path-containment", skip: "not a git repo" } : { name: "path-containment", containment: true });
steps.push(...touchedDomainScripts(files));
const lint = pick("lint", ["lint"], "lint");
steps.push(lint ? { name: "lint", cmd: lint } : { name: "lint", skip: "none detected" });
const tc = typecheckCmd();
steps.push(tc ? { name: "typecheck", cmd: tc } : { name: "typecheck", skip: "none detected" });
const aff = affectedTest(files);
const full = pick("test", ["test"], "test");
if (aff) steps.push({ name: "test", argv: aff.argv, note: aff.note });
else if (full) steps.push({ name: "test", cmd: full, note: ALL ? "full suite" : "full suite (no verified related-test mode for this runner)" });
else steps.push({ name: "test", skip: "none detected" });

const label = (s) => (s.skip ? "skip: " + s.skip : s.argv ? s.argv.slice(1).join(" ") : s.scan ? "pattern scan of " + (files || []).length + " file(s)" : s.cmd) + (s.note ? " [" + s.note + "]" : "");
if (DRY) {
  for (const s of steps) process.stdout.write("plan " + s.name + ": " + label(s) + "\\n");
  process.exit(0);
}

for (const s of steps) {
  if (s.skip) {
    s.status = "skip";
  } else if (s.scan) {
    const hits = scanSecrets(files);
    s.status = hits.length ? "fail" : "pass";
    s.code = hits.length ? 1 : 0;
    if (hits.length) s.tail = hits.slice(0, TAIL_LINES).join("\\n");
  } else if (s.containment) {
    const failures = pathContainmentFailures(files);
    s.status = failures.length ? "fail" : "pass";
    s.code = failures.length ? 1 : 0;
    if (failures.length) s.tail = failures.slice(0, TAIL_LINES).join("\\n");
  } else {
    exec(s);
  }
}
const failed = steps.filter((s) => s.status === "fail");
if (AS_JSON) {
  process.stdout.write(JSON.stringify({ ok: failed.length === 0, changed: files ? files.length : null, steps: steps.map((s) => ({ name: s.name, status: s.status, command: s.skip ? null : label(s), code: s.code, ms: s.ms, tail: s.tail })) }) + "\\n");
} else {
  const out = ["helix gate: " + (files ? files.length + " changed file(s)" : "all files")];
  for (const s of steps) {
    const ms = s.ms === undefined ? "" : " (" + (s.ms / 1000).toFixed(1) + "s)";
    out.push(s.status.toUpperCase() + " " + s.name + (s.status === "skip" ? " (" + s.skip + ")" : s.status === "fail" ? " (exit " + s.code + ")" + ms + ": " + label(s) : ms));
    if (s.tail) out.push(s.tail.split("\\n").map((l) => "  " + l).join("\\n"));
  }
  out.push("gate: " + (failed.length ? "FAIL (" + failed.length + " of " + steps.length + ")" : "PASS"));
  process.stdout.write(out.join("\\n") + "\\n");
}
process.exit(failed.length ? 1 : 0);
`;
