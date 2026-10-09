// Codex and Antigravity adapters. Vendor facts verified 2026-10-09:
//  Codex: https://learn.chatgpt.com/docs/agent-configuration/subagents (.codex/agents/*.toml),
//         https://learn.chatgpt.com/docs/hooks (.codex/hooks.json, Stop exit 2 + stderr).
//  Antigravity: https://antigravity.google/docs/{skills,mcp,hooks,subagents,rules}.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { generatePack } from "./generate.ts";
import { antigravityMcpJson, MCPS } from "./mcps.ts";
import { ANTIGRAVITY_TOOLS } from "./adapters/antigravity.ts";
import type { HarnessConfig, PlatformId } from "./types";

const cfg = (platforms: PlatformId[], hooksEnabled = true): HarnessConfig => ({
  crew: ["scout", "architect", "builder", "reviewer"],
  skills: ["graph-first", "hook-guards"],
  mcps: ["context7", "graphify"],
  platforms,
  graphFirst: true,
  progressiveDisclosure: true,
  defaultSingleAgent: true,
  hooksEnabled,
});
const pack = (platforms: PlatformId[], hooksEnabled = true) =>
  new Map(generatePack(cfg(platforms, hooksEnabled)).map((f) => [f.path, f.body]));

describe("codex adapter", () => {
  const files = pack(["codex"]);

  it("emits one custom-agent TOML per crew role with the three required fields", () => {
    for (const id of ["scout", "architect", "builder", "reviewer"]) {
      const body = files.get(`.codex/agents/${id}.toml`);
      assert.ok(body, `missing .codex/agents/${id}.toml`);
      assert.match(body, new RegExp(`^name = "${id}"$`, "m"));
      assert.match(body, /^description = ".+"$/m);
      assert.match(body, /^developer_instructions = '''\n[\s\S]+\n'''$/m);
      assert.ok(!body.slice(body.indexOf("'''") + 3, body.lastIndexOf("'''")).includes("'''"));
    }
  });

  it("inherits the parent model and sandboxes read-only roles", () => {
    for (const [id, readOnly] of [
      ["scout", true],
      ["architect", true],
      ["reviewer", true],
      ["builder", false],
    ] as const) {
      const body = files.get(`.codex/agents/${id}.toml`) ?? "";
      assert.ok(!/^model\s*=/m.test(body), `${id} must not pin a vendor model slug`);
      assert.equal(/^sandbox_mode = "read-only"$/m.test(body), readOnly, id);
    }
  });

  it("emits a Stop hook that resolves from the git root, and no tool hooks", () => {
    const json = JSON.parse(files.get(".codex/hooks.json") ?? "null");
    const stop = json.hooks.Stop[0].hooks[0];
    assert.equal(stop.type, "command");
    assert.match(stop.command, /git rev-parse --show-toplevel/);
    assert.match(stop.command, /\.helix\/hooks\/codex-stop\.mjs/);
    assert.equal(json.hooks.PreToolUse, undefined);
    assert.equal(json.hooks.PostToolUse, undefined);
    assert.ok(files.has(".helix/hooks/codex-stop.mjs"));
  });

  it("emits no hook files when hooks are disabled", () => {
    const off = pack(["codex"], false);
    assert.ok(!off.has(".codex/hooks.json"));
    assert.ok(!off.has(".helix/hooks/codex-stop.mjs"));
  });
});

describe("codex stop hook behavior", () => {
  const script = pack(["codex"]).get(".helix/hooks/codex-stop.mjs") ?? "";
  const env = (home: string) => {
    const e: Record<string, string> = {
      PATH: `${dirname(process.execPath)}:/usr/bin:/bin`,
      HOME: home,
      GIT_AUTHOR_NAME: "t",
      GIT_AUTHOR_EMAIL: "t@t",
      GIT_COMMITTER_NAME: "t",
      GIT_COMMITTER_EMAIL: "t@t",
    };
    return e;
  };
  function repo(gateExit: number | null) {
    const dir = mkdtempSync(join(tmpdir(), "helix-codex-stop-"));
    const run = (args: string[]) =>
      spawnSync("git", ["-c", "commit.gpgsign=false", ...args], { cwd: dir, env: env(dir) });
    run(["init", "-q"]);
    mkdirSync(join(dir, ".helix", "hooks"), { recursive: true });
    writeFileSync(join(dir, ".helix", "hooks", "codex-stop.mjs"), script);
    if (gateExit !== null) {
      writeFileSync(
        join(dir, ".helix", "gate.mjs"),
        gateExit === 0 ? "process.exit(0)\n" : 'console.error("boom"); process.exit(1)\n',
      );
    }
    writeFileSync(join(dir, "a.txt"), "one\n");
    run(["add", "-A"]);
    run(["commit", "-q", "-m", "init"]);
    return { dir, run };
  }
  const fire = (dir: string, stopActive = false) =>
    spawnSync(process.execPath, [join(dir, ".helix", "hooks", "codex-stop.mjs")], {
      cwd: dir,
      env: env(dir),
      input: JSON.stringify({ cwd: dir, stop_hook_active: stopActive }),
      encoding: "utf8",
    });

  it("passes silently on a clean tree even when the gate would fail", () => {
    const { dir } = repo(1);
    try {
      assert.equal(fire(dir).status, 0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("blocks with the gate tail on a dirty tree when the gate fails", () => {
    const { dir } = repo(1);
    try {
      writeFileSync(join(dir, "a.txt"), "two\n");
      const r = fire(dir);
      assert.equal(r.status, 2);
      assert.match(r.stderr, /boom/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("stands down when already continued (loop guard) or when the gate passes", () => {
    const bad = repo(1);
    const good = repo(0);
    try {
      writeFileSync(join(bad.dir, "a.txt"), "two\n");
      writeFileSync(join(good.dir, "a.txt"), "two\n");
      assert.equal(fire(bad.dir, true).status, 0);
      assert.equal(fire(good.dir).status, 0);
    } finally {
      for (const d of [bad.dir, good.dir]) rmSync(d, { recursive: true, force: true });
    }
  });

  it("ignores changes under the pack's own directories and fails open without a gate", () => {
    const withGate = repo(1);
    const noGate = repo(null);
    try {
      writeFileSync(join(withGate.dir, ".helix", "note.md"), "x\n");
      assert.equal(fire(withGate.dir).status, 0);
      writeFileSync(join(noGate.dir, "a.txt"), "two\n");
      assert.equal(fire(noGate.dir).status, 0);
    } finally {
      for (const d of [withGate.dir, noGate.dir]) rmSync(d, { recursive: true, force: true });
    }
  });
});

function frontmatter(md: string): Record<string, string | string[]> {
  const m = md.match(/^---\n([\s\S]*?)\n---\n/);
  assert.ok(m, "agent file needs YAML frontmatter");
  const out: Record<string, string | string[]> = {};
  let listKey: string | null = null;
  for (const line of m[1].split("\n")) {
    const item = line.match(/^\s+-\s+(.+)$/);
    if (item && listKey) {
      (out[listKey] as string[]).push(item[1].trim());
      continue;
    }
    const kv = line.match(/^([A-Za-z]+):\s*(.*)$/);
    assert.ok(kv, `unparseable frontmatter line: ${line}`);
    if (kv[2] === "") {
      listKey = kv[1];
      out[listKey] = [];
    } else {
      listKey = null;
      out[kv[1]] = kv[2];
    }
  }
  return out;
}

describe("antigravity adapter", () => {
  const files = pack(["antigravity"]);

  it("writes skills and MCP where Antigravity reads them, and no GEMINI.md pointer", () => {
    assert.ok(files.has(".agents/skills/graph-first/SKILL.md"));
    assert.ok(files.has(".agents/mcp_config.json"));
    assert.ok(!files.has("GEMINI.md"), "AGENTS.md is read natively; no pointer needed");
    assert.ok(files.has("AGENTS.md"));
  });

  it("uses serverUrl for remote MCP servers and never url or httpUrl", () => {
    const all = JSON.parse(antigravityMcpJson(MCPS.map((m) => m.id)));
    let remote = 0;
    for (const s of Object.values(all.mcpServers) as Record<string, unknown>[]) {
      assert.equal("url" in s, false);
      assert.equal("httpUrl" in s, false);
      assert.ok("command" in s || "serverUrl" in s);
      if ("serverUrl" in s) remote++;
    }
    const cfgJson = JSON.parse(files.get(".agents/mcp_config.json") ?? "null");
    assert.ok(Object.keys(cfgJson.mcpServers).length > 0);
    assert.ok(remote >= 0);
  });

  it("emits subagents with only documented tool names and documented model tiers", () => {
    for (const id of ["scout", "architect", "builder", "reviewer"]) {
      const fm = frontmatter(files.get(`.agents/agents/${id}.md`) ?? "");
      assert.equal(fm.name, id);
      assert.ok(fm.description);
      assert.equal(fm.subagent, "true");
      assert.equal(fm.mainAgent, "false");
      assert.ok(["inherit", "flash", "pro"].includes(fm.model as string), `${id} ${fm.model}`);
      const tools = (fm.tools ?? []) as string[];
      assert.ok(tools.length > 0, `${id} needs at least one tool`);
      for (const t of tools) {
        assert.ok((ANTIGRAVITY_TOOLS as readonly string[]).includes(t), `${id}: unknown tool ${t}`);
      }
    }
  });

  it("gives the builder write and run tools and the read-only roles neither", () => {
    const tools = (id: string) =>
      (frontmatter(files.get(`.agents/agents/${id}.md`) ?? "").tools ?? []) as string[];
    for (const t of ["write_to_file", "replace_file_content", "run_command"]) {
      assert.ok(tools("builder").includes(t), `builder lacks ${t}`);
    }
    for (const id of ["scout", "architect", "reviewer"]) {
      for (const t of ["write_to_file", "replace_file_content", "run_command"]) {
        assert.ok(!tools(id).includes(t), `${id} must not have ${t}`);
      }
    }
  });

  it("emits no hooks file: the Stop protocol has no loop guard to rely on", () => {
    assert.ok(!files.has(".agents/hooks.json"));
  });
});

describe("codex and antigravity together", () => {
  it("shares .agents/skills without emitting a path twice", () => {
    const list = generatePack(cfg(["codex", "antigravity"])).map((f) => f.path);
    assert.equal(new Set(list).size, list.length);
    assert.equal(list.filter((p) => p === ".agents/skills/graph-first/SKILL.md").length, 1);
  });
});
