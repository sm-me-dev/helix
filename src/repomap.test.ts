import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { generatePack } from "./generate.ts";
import { MAP_SOURCE, selectRepoMap } from "./repomap.ts";

function project(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "helix-map-repo-"));
  for (const [p, body] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, p)), { recursive: true });
    writeFileSync(join(dir, p), body);
  }
  mkdirSync(join(dir, ".helix"), { recursive: true });
  writeFileSync(join(dir, ".helix", "map.mjs"), MAP_SOURCE);
  symlinkSync(resolve("node_modules"), join(dir, "node_modules"), "junction");
  return dir;
}
const map = (dir: string, ...args: string[]) => {
  const r = spawnSync(process.execPath, [join(dir, ".helix", "map.mjs"), ...args], {
    cwd: dir,
    encoding: "utf8",
  });
  return { code: r.status, out: String(r.stdout), err: String(r.stderr) };
};

describe("repo map provider selection", () => {
  it("picks graphify only when present and the repo is big enough", () => {
    assert.equal(selectRepoMap({ graphifyAvailable: true, fileCount: 200 }), "graphify");
    assert.equal(selectRepoMap({ graphifyAvailable: false, fileCount: 200 }), "outline");
    assert.equal(selectRepoMap({ graphifyAvailable: true, fileCount: 5 }), "outline");
  });
});

describe("outline map (fallback when Graphify is absent)", () => {
  it("lists files with top-level symbols for ts, py, go, rs", () => {
    const dir = project({
      "src/a.ts":
        "import { helper } from './helper.js';\nexport function alpha() { function nested() {} }\nexport const beta = 1;\n",
      "lib/b.py": "def gamma():\n    pass\nclass Delta:\n    def inner(self): pass\n",
      "main.go": "package main\nfunc Epsilon() {}\nfunc (s *S) Zeta() {}\ntype Eta struct{}\n",
      "x.rs": "pub fn theta() {}\nstruct Iota;\n",
      "notes.txt": "ignored",
    });
    const r = map(dir);
    assert.equal(r.code, 0);
    assert.match(r.out, /src\/a\.ts: alpha, beta; imports: '\.\/helper\.js'/);
    assert.match(r.out, /lib\/b\.py: gamma, Delta\n/);
    assert.match(r.out, /main\.go: Epsilon, Zeta, Eta\n/);
    assert.match(r.out, /x\.rs: theta, Iota\n/);
    assert.ok(!r.out.includes("notes.txt"));
    assert.ok(!r.out.includes("nested"));
  });

  it("narrows by subdir and caps output with a pointer instead of dumping", () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < 80; i++) files[`pkg/m${i}.ts`] = `export function f${i}() {}\n`;
    files["other/o.ts"] = "export function only() {}\n";
    const dir = project(files);
    const capped = map(dir, "--max", "300");
    assert.match(capped.out, /more file\(s\); pass a subdir/);
    assert.ok(capped.out.length < 500);
    const narrow = map(dir, "other");
    assert.match(narrow.out, /other\/o\.ts: only/);
    assert.ok(!narrow.out.includes("pkg/"));
  });

  it("skips node_modules and rejects unknown options", () => {
    const dir = project({
      "deep/node_modules/x/i.ts": "export function leak() {}\n",
      "a.ts": "export function ok() {}\n",
    });
    const r = map(dir);
    assert.ok(!r.out.includes("leak"));
    assert.equal(map(dir, "--nope").code, 2);
  });
});

describe("pack wiring for the fallback", () => {
  const base = {
    crew: [],
    skills: [],
    mcps: [],
    platforms: ["claude-code"],
    progressiveDisclosure: true,
    defaultSingleAgent: true,
    hooksEnabled: true,
  } as const;
  const cfg = (graphFirst: boolean) => ({
    ...base,
    crew: [],
    skills: [],
    mcps: [],
    platforms: ["claude-code" as const],
    graphFirst,
  });

  it("emits map.mjs and a map-first AGENTS.md (no graph tools) when graph-first is off", () => {
    const pack = generatePack(cfg(false));
    assert.ok(pack.some((f) => f.path === ".helix/map.mjs"));
    const agents = pack.find((f) => f.path === "AGENTS.md")?.body ?? "";
    assert.match(agents, /node \.helix\/map\.mjs/);
    assert.ok(!agents.includes("query_graph"));
  });

  it("emits no map.mjs when graph-first is on", () => {
    const pack = generatePack(cfg(true));
    assert.ok(!pack.some((f) => f.path === ".helix/map.mjs"));
    assert.match(pack.find((f) => f.path === "AGENTS.md")?.body ?? "", /query_graph/);
  });
});
