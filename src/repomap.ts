// Graphify is preferred when available; this deterministic fallback maps files,
// JavaScript/TypeScript symbols and imports with ast-grep, plus non-JS outlines.

export type RepoMapProviderId = "graphify" | "outline";

export type RepoMapProvider = {
  id: RepoMapProviderId;
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
      "Map first: `node .helix/map.mjs [subdir]` lists files, symbols and imports. Read a file only when the map or a search names it.",
  },
};

/** Graphify when present and worthwhile, otherwise the built-in outline. */
export function selectRepoMap(facts: {
  graphifyAvailable: boolean;
  fileCount: number;
}): RepoMapProviderId {
  return facts.graphifyAvailable && facts.fileCount >= 20 ? "graphify" : "outline";
}

export const MAP_SOURCE = String.raw`#!/usr/bin/env node
// Helix repo map (fallback when Graphify is absent): AST symbols and imports.
// node .helix/map.mjs [subdir] [--max CHARS]
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
let max = 6000;
let sub = "";
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--max") max = Number(args[++i]) || max;
  else if (args[i].startsWith("--")) {
    process.stderr.write("helix map: unknown option " + args[i] + "\n");
    process.exit(2);
  } else sub = args[i];
}
const JS_EXTS = new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"]);
const OTHER_RULES = {
  ".py": /^(?:async\s+)?(?:def|class)\s+(\w+)/,
  ".go": /^(?:func\s+(?:\([^)]*\)\s*)?|type\s+)(\w+)/,
  ".rs": /^(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?(?:fn|struct|enum|trait|mod)\s+(\w+)/,
};
const SKIP = /(^|\/)(node_modules|\.git|\.helix|dist|build|target|vendor|graphify-out|\.next|coverage)(\/|$)/;

function listFiles() {
  const out = [];
  (function walk(dir) {
    let names = [];
    try { names = fs.readdirSync(dir); } catch { return; }
    for (const name of names) {
      const full = path.join(dir, name);
      const rel = path.relative(".", full).split(path.sep).join("/");
      if (SKIP.test(rel)) continue;
      let stat;
      try { stat = fs.statSync(full); } catch { continue; }
      if (stat.isDirectory()) walk(full);
      else if (stat.isFile()) out.push(rel);
    }
  })(".");
  return out;
}

function langFor(ast, ext) {
  if (ext === ".tsx" || ext === ".jsx") return ast.Lang.Tsx;
  if ([".js", ".mjs", ".cjs"].includes(ext)) return ast.Lang.JavaScript;
  return ast.Lang.TypeScript;
}

async function jsStructure(source, ext) {
  let ast;
  try { ast = await import("@ast-grep/napi"); }
  catch { return { symbols: [], imports: [], unavailable: true }; }
  const root = ast.parse(langFor(ast, ext), source).root();
  const symbols = [];
  const nestedKinds = new Set(["function_declaration", "function_expression", "arrow_function", "method_definition", "class_declaration"]);
  const kindMap = new Map([["function_declaration", "function"], ["class_declaration", "class"], ["interface_declaration", "interface"], ["type_alias_declaration", "type"], ["enum_declaration", "type"]]);
  const imports = [];
  const stack = [root];
  while (stack.length) {
    const node = stack.pop();
    const nodeKind = node.kind();
    if (nodeKind === "import_statement") {
      const importedFrom = node.field("source")?.text();
      if (importedFrom) imports.push(importedFrom);
    }
    const symbolKind = kindMap.get(nodeKind);
    if (symbolKind && !node.ancestors().some((parent) => nestedKinds.has(parent.kind()))) {
      const name = node.field("name")?.text();
      if (name) symbols.push({ name, kind: symbolKind, line: node.range().start.line + 1 });
    }
    if (nodeKind === "variable_declarator" && !node.ancestors().some((parent) => nestedKinds.has(parent.kind()))) {
      const name = node.field("name")?.text();
      if (name) symbols.push({ name, kind: "variable", line: node.range().start.line + 1 });
    }
    stack.push(...node.children());
  }
  symbols.sort((a, b) => a.line - b.line || a.name.localeCompare(b.name));
  return { symbols: symbols.slice(0, 24), imports: [...new Set(imports)].slice(0, 24), unavailable: false };
}

const prefix = sub ? sub.replace(/\\/g, "/").replace(/\/+$/, "") + "/" : "";
const lines = [];
let skipped = 0;
for (const file of listFiles().filter((item) => !SKIP.test(item) && item.startsWith(prefix)).sort()) {
  const ext = path.extname(file).toLowerCase();
  if (!JS_EXTS.has(ext) && !OTHER_RULES[ext]) continue;
  let source;
  try { if (fs.statSync(file).size > 512 * 1024) continue; source = fs.readFileSync(file, "utf8"); } catch { continue; }
  let symbols = [];
  let imports = [];
  if (JS_EXTS.has(ext)) {
    const structure = await jsStructure(source, ext);
    symbols = structure.symbols.map((item) => item.name);
    imports = structure.imports;
    if (structure.unavailable) process.stderr.write("helix map: install @ast-grep/napi to map JS/TS symbols\n");
  } else {
    const rule = OTHER_RULES[ext];
    for (const line of source.split("\n")) {
      const match = rule.exec(line);
      if (match) symbols.push(match[1]);
      if (symbols.length >= 24) break;
    }
  }
  const suffix = [symbols.length ? symbols.join(", ") : "", imports.length ? "imports: " + imports.join(", ") : ""].filter(Boolean).join("; ");
  lines.push(file + (suffix ? ": " + suffix : ""));
}
let total = 0;
const out = [];
for (const line of lines) {
  if (total + line.length + 1 > max) { skipped = lines.length - out.length; break; }
  out.push(line);
  total += line.length + 1;
}
if (skipped) out.push("... " + skipped + " more file(s); pass a subdir to narrow, or --max to widen");
if (out.length === 0) out.push("(no recognized source files under " + (sub || ".") + ")");
process.stdout.write(out.join("\n") + "\n");
`;
