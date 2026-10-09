// Repo-map provider interface. Graphify is the preferred provider; when it is
// absent (or the repo is too small to repay a graph) the pack falls back to a
// built-in symbol outline that needs no install, no index and no network.
//
// Honest scope of the fallback: a regex outline of top-level declarations for
// TS/JS, Python, Go and Rust. It is NOT tree-sitter and NOT an LSP: no
// references, no call edges, no cross-file resolution. It answers "what lives
// where", which is the part of graph-first that a cold session pays most for.
// ctags/tree-sitter/LSP providers were not added: none is guaranteed on a
// user's machine, and each would be a new dependency or an unverified flag set.

export type RepoMapProviderId = "graphify" | "outline";

export type RepoMapProvider = {
  id: RepoMapProviderId;
  /** What AGENTS.md tells the agent to use. */
  instruction: string;
};

export const REPO_MAP_PROVIDERS: Record<RepoMapProviderId, RepoMapProvider> = {
  graphify: {
    id: "graphify",
    instruction:
      "Graph first: query_graph, get_neighbors, shortest_path. Read a file only when the graph cites it.",
  },
  outline: {
    id: "outline",
    instruction:
      "Map first: `node .helix/map.mjs [subdir]` lists files and top-level symbols. Read a file only when the map or a search names it.",
  },
};

/** Graphify when present and worthwhile, otherwise the built-in outline. */
export function selectRepoMap(facts: {
  graphifyAvailable: boolean;
  fileCount: number;
}): RepoMapProviderId {
  return facts.graphifyAvailable && facts.fileCount >= 20 ? "graphify" : "outline";
}

export const MAP_SOURCE = `#!/usr/bin/env node
// Helix repo map (fallback when Graphify is absent): files and top-level symbols.
// node .helix/map.mjs [subdir] [--max CHARS]   default cap 6000 chars (~1.5k tokens)
// Regex outline for TS/JS, Python, Go, Rust. No references or call edges.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
let max = 6000;
let sub = "";
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--max") max = Number(args[++i]) || max;
  else if (args[i].startsWith("--")) {
    process.stderr.write("helix map: unknown option " + args[i] + "\\n");
    process.exit(2);
  } else sub = args[i];
}
const RULES = {
  ".ts": /^(?:export\\s+)?(?:default\\s+)?(?:declare\\s+)?(?:abstract\\s+)?(?:async\\s+)?(?:function\\*?|class|interface|type|enum|const|let|var)\\s+([A-Za-z_$][\\w$]*)/,
  ".py": /^(?:async\\s+)?(?:def|class)\\s+(\\w+)/,
  ".go": /^(?:func\\s+(?:\\([^)]*\\)\\s*)?|type\\s+)(\\w+)/,
  ".rs": /^(?:pub(?:\\([^)]*\\))?\\s+)?(?:async\\s+)?(?:fn|struct|enum|trait|mod)\\s+(\\w+)/,
};
for (const e of [".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts"]) RULES[e] = RULES[".ts"];
const SKIP = /(^|\\/)(node_modules|\\.git|dist|build|target|vendor|graphify-out|\\.next|coverage)(\\/|$)/;

function listFiles() {
  const r = spawnSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (r.status === 0) return String(r.stdout).split("\\0").filter(Boolean);
  const out = [];
  (function walk(dir) {
    let names = [];
    try {
      names = fs.readdirSync(dir);
    } catch (e) {
      return;
    }
    for (const n of names) {
      const full = path.join(dir, n);
      const rel = path.relative(".", full);
      if (SKIP.test(rel)) continue;
      let st;
      try {
        st = fs.statSync(full);
      } catch (e) {
        continue;
      }
      if (st.isDirectory()) walk(full);
      else out.push(rel);
    }
  })(".");
  return out;
}

const prefix = sub ? sub.replace(/\\/+$/, "") + "/" : "";
const files = listFiles().filter((f) => !SKIP.test(f) && f.startsWith(prefix)).sort();
const lines = [];
let skipped = 0;
for (const f of files) {
  const re = RULES[path.extname(f)];
  if (!re) continue;
  let text;
  try {
    if (fs.statSync(f).size > 512 * 1024) continue;
    text = fs.readFileSync(f, "utf8");
  } catch (e) {
    continue;
  }
  const syms = [];
  for (const line of text.split("\\n")) {
    const m = re.exec(line);
    if (m) syms.push(m[1]);
    if (syms.length >= 24) break;
  }
  lines.push(f + (syms.length ? ": " + syms.join(", ") : ""));
}
let total = 0;
const out = [];
for (const l of lines) {
  if (total + l.length + 1 > max) {
    skipped = lines.length - out.length;
    break;
  }
  out.push(l);
  total += l.length + 1;
}
if (skipped) out.push("... " + skipped + " more file(s); pass a subdir to narrow, or --max to widen");
if (out.length === 0) out.push("(no recognized source files under " + (sub || ".") + ")");
process.stdout.write(out.join("\\n") + "\\n");
`;
