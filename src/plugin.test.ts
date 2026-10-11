// F2: Claude Code plugin packaging. Every rule below comes from the vendor docs fetched
// 2026-10-10 (see docs/DECISIONS.md, "F2"): plugins-reference, plugins/components,
// plugin-marketplaces, hooks. Tests encode the documented contract, not our guesses.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { generatePack } from "./generate.ts";
import { pluginPack, scopeMcpTool, PLUGIN_NAME, MARKETPLACE_NAME } from "./plugin.ts";
import { DEFAULT_HARNESS_CONFIG } from "./defaults.ts";
import type { HarnessConfig } from "./types.ts";

const CFG: HarnessConfig = {
  ...DEFAULT_HARNESS_CONFIG,
  crew: ["scout", "architect", "builder", "reviewer"],
  skills: ["graph-first"],
  mcps: ["graphify"],
  platforms: ["claude-code"],
  graphFirst: true,
  hooksEnabled: true,
};

const ROOT = `plugins/${PLUGIN_NAME}`;
const byPath = (files: { path: string; body: string }[]) =>
  Object.fromEntries(files.map((f) => [f.path, f.body]));
const frontmatter = (body: string): Record<string, string> => {
  const m = body.match(/^---\n([\s\S]*?)\n---\n/);
  assert.ok(m, "missing frontmatter");
  return Object.fromEntries(
    m[1].split("\n").map((l) => [l.slice(0, l.indexOf(":")), l.slice(l.indexOf(":") + 1).trim()]),
  );
};

// plugins-reference "Fields" table (top-level keys that load without a validate warning)
const MANIFEST_KEYS = new Set([
  "$schema",
  "name",
  "displayName",
  "version",
  "description",
  "author",
  "homepage",
  "repository",
  "license",
  "keywords",
  "metadata",
  "defaultEnabled",
  "dependencies",
  "settings",
  "userConfig",
  "skills",
  "commands",
  "agents",
  "hooks",
  "mcpServers",
  "lspServers",
  "outputStyles",
  "workflows",
  "experimental",
]);
// plugins/components "Frontmatter fields in plugin agents"
const AGENT_SUPPORTED = new Set([
  "name",
  "description",
  "model",
  "effort",
  "maxTurns",
  "tools",
  "disallowedTools",
  "skills",
  "memory",
  "background",
  "omitClaudeMd",
  "isolation",
  "color",
]);
const AGENT_IGNORED = ["permissionMode", "hooks", "mcpServers", "initialPrompt"];

describe("pluginPack layout", () => {
  const files = pluginPack(CFG);
  const f = byPath(files);

  it("emits manifest, marketplace, skills, agents, hooks and MCP at documented locations", () => {
    assert.ok(f[".claude-plugin/marketplace.json"], "marketplace.json at marketplace root");
    assert.ok(f[`${ROOT}/.claude-plugin/plugin.json`], "plugin.json inside .claude-plugin/");
    assert.ok(f[`${ROOT}/skills/graph-first/SKILL.md`]);
    for (const id of CFG.crew) assert.ok(f[`${ROOT}/agents/${id}.md`], `agent ${id}`);
    assert.ok(f[`${ROOT}/hooks/hooks.json`]);
    assert.ok(f[`${ROOT}/.mcp.json`]);
  });

  it("puts nothing but plugin.json inside .claude-plugin/ of the plugin", () => {
    const inside = files.map((x) => x.path).filter((p) => p.startsWith(`${ROOT}/.claude-plugin/`));
    assert.deepEqual(inside, [`${ROOT}/.claude-plugin/plugin.json`]);
  });

  it("never ships a CLAUDE.md or settings.json in the plugin (CLAUDE.md is not loaded; only agent keys of settings.json apply)", () => {
    const paths = files.map((x) => x.path);
    assert.ok(!paths.some((p) => p.endsWith("CLAUDE.md")));
    assert.ok(!paths.some((p) => p === `${ROOT}/settings.json`));
  });

  it("is deterministic", () => {
    assert.deepEqual(pluginPack(CFG), pluginPack(CFG));
  });
});

describe("plugin.json and marketplace.json", () => {
  const f = byPath(pluginPack(CFG));
  const manifest = JSON.parse(f[`${ROOT}/.claude-plugin/plugin.json`]);
  const market = JSON.parse(f[".claude-plugin/marketplace.json"]);

  it("manifest has only documented top-level keys and a kebab-case, non-reserved name", () => {
    for (const k of Object.keys(manifest)) assert.ok(MANIFEST_KEYS.has(k), `unknown key ${k}`);
    assert.equal(manifest.name, PLUGIN_NAME);
    assert.match(manifest.name, /^[a-z0-9]+(-[a-z0-9]+)*$/);
    assert.doesNotMatch(manifest.name, /^(claude|anthropic|anthropics|cc-plugin)(-|$)/);
    assert.equal(typeof manifest.version, "string");
    assert.ok(manifest.description.length > 0);
  });

  it("marketplace has name, owner.name and a plugins array whose entry name equals the manifest name", () => {
    assert.equal(market.name, MARKETPLACE_NAME);
    assert.ok(market.owner?.name);
    assert.equal(market.plugins.length, 1);
    assert.equal(market.plugins[0].name, manifest.name);
  });

  it("entry source is a ./ relative path with no .. that points at the emitted plugin directory", () => {
    const src: string = market.plugins[0].source;
    assert.match(src, /^\.\//);
    assert.ok(!src.includes(".."));
    assert.equal(src, `./${ROOT}`);
  });

  it("marketplace name is not an official reserved one", () => {
    assert.doesNotMatch(market.name, /^(claude|anthropic)/);
  });
});

describe("plugin agents", () => {
  const files = pluginPack(CFG);
  const f = byPath(files);
  const mcp = JSON.parse(f[`${ROOT}/.mcp.json`]);
  const serverKeys = Object.keys(mcp.mcpServers);

  it("use only supported frontmatter fields and none of the ignored ones", () => {
    for (const id of CFG.crew) {
      const fm = frontmatter(f[`${ROOT}/agents/${id}.md`]);
      for (const k of Object.keys(fm)) assert.ok(AGENT_SUPPORTED.has(k), `${id}: unsupported ${k}`);
      for (const k of AGENT_IGNORED) assert.ok(!(k in fm), `${id}: ignored field ${k}`);
    }
  });

  it("name MCP tools the way a plugin-bundled server is named: mcp__plugin_<plugin>_<server>__<tool>", () => {
    let seen = 0;
    for (const id of CFG.crew) {
      const tools = frontmatter(f[`${ROOT}/agents/${id}.md`])
        .tools.split(",")
        .map((t) => t.trim());
      assert.ok(
        !tools.some((t) => t.startsWith("mcp__graphify__")),
        `${id} uses a bare server name`,
      );
      for (const t of tools.filter((x) => x.startsWith("mcp__"))) {
        const m = t.match(new RegExp(`^mcp__plugin_${PLUGIN_NAME}_([^_].*?)__.+$`));
        assert.ok(m, `${id}: ${t} is not plugin-scoped`);
        assert.ok(serverKeys.includes(m[1]), `${id}: server ${m[1]} not in plugin .mcp.json`);
        seen++;
      }
    }
    assert.ok(seen > 0, "expected at least one plugin-scoped MCP tool");
  });

  it("drops graphify tools when graph-first MCP is off (same rule as the repo pack)", () => {
    const off = byPath(pluginPack({ ...CFG, mcps: [], graphFirst: false }));
    for (const id of CFG.crew) assert.ok(!off[`${ROOT}/agents/${id}.md`].includes("graphify"));
    assert.deepEqual(JSON.parse(off[`${ROOT}/.mcp.json`]).mcpServers, {});
  });

  it("emits only the selected crew", () => {
    const one = pluginPack({ ...CFG, crew: ["scout"] }).map((x) => x.path);
    assert.ok(one.includes(`${ROOT}/agents/scout.md`));
    assert.ok(!one.includes(`${ROOT}/agents/builder.md`));
  });
});

describe("scopeMcpTool", () => {
  it("scopes a bare server name and replaces characters outside A-Za-z0-9_- with _", () => {
    assert.equal(
      scopeMcpTool("mcp__graphify__query_graph"),
      "mcp__plugin_helix_graphify__query_graph",
    );
    assert.equal(scopeMcpTool("mcp__my.server__x"), "mcp__plugin_helix_my_server__x");
    assert.equal(scopeMcpTool("mcp__chrome-devtools__x"), "mcp__plugin_helix_chrome-devtools__x");
  });
  it("leaves built-in tools alone", () => {
    for (const t of ["Read", "Grep", "Edit", "Bash"]) assert.equal(scopeMcpTool(t), t);
  });
});

describe("plugin hooks", () => {
  const files = pluginPack(CFG);
  const f = byPath(files);
  const hooks = JSON.parse(f[`${ROOT}/hooks/hooks.json`]);

  it("hooks.json wraps the event map in a top-level hooks key and carries no permissions", () => {
    for (const k of Object.keys(hooks)) assert.ok(["hooks", "description"].includes(k), k);
    assert.ok(hooks.hooks.Stop && hooks.hooks.PostToolUse && hooks.hooks.PreToolUse);
  });

  it("every command uses exec form with ${CLAUDE_PLUGIN_ROOT} and points at a file in the pack", () => {
    const cmds = Object.values(hooks.hooks)
      .flat()
      .flatMap((g: any) => g.hooks);
    assert.ok(cmds.length >= 3);
    for (const h of cmds as any[]) {
      assert.equal(h.type, "command");
      assert.equal(h.command, "node");
      assert.equal(h.args.length, 1);
      assert.match(h.args[0], /^\$\{CLAUDE_PLUGIN_ROOT\}\/hooks\/[a-z-]+\.mjs$/);
      const rel = h.args[0].replace("${CLAUDE_PLUGIN_ROOT}/", "");
      assert.ok(f[`${ROOT}/${rel}`], `missing ${rel}`);
    }
  });

  it("respects graphFirst and hooksEnabled", () => {
    const noGraph = JSON.parse(
      byPath(pluginPack({ ...CFG, graphFirst: false }))[`${ROOT}/hooks/hooks.json`],
    );
    assert.ok(!noGraph.hooks.PreToolUse);
    const off = byPath(pluginPack({ ...CFG, hooksEnabled: false }));
    assert.deepEqual(JSON.parse(off[`${ROOT}/hooks/hooks.json`]), { hooks: {} });
    assert.ok(!Object.keys(off).some((p) => p.startsWith(`${ROOT}/hooks/`) && p.endsWith(".mjs")));
  });
});

describe("claude-code plugin mode for helix init (claudePlugin: true)", () => {
  const paths = (cfg: HarnessConfig) => generatePack(cfg).map((x) => x.path);
  const plug: HarnessConfig = { ...CFG, claudePlugin: true };

  it("skips everything the plugin supplies, so nothing is registered twice", () => {
    const p = paths(plug);
    assert.ok(!p.some((x) => x.startsWith(".claude/agents/")));
    assert.ok(!p.some((x) => x.startsWith(".claude/skills/")));
    assert.ok(!p.some((x) => x.startsWith(".helix/hooks/")));
    assert.ok(!p.includes(".mcp.json"));
  });

  it("still writes AGENTS.md, the CLAUDE.md pointer and the gate", () => {
    const p = paths(plug);
    assert.ok(p.includes("AGENTS.md") && p.includes("CLAUDE.md"));
    assert.ok(p.some((x) => x.startsWith(".helix/")));
  });

  it("keeps the fail-closed secret denies in the repo (a plugin cannot ship permissions) but no hooks", () => {
    const s = JSON.parse(byPath(generatePack(plug))[".claude/settings.json"]);
    assert.ok(s.permissions.deny.includes("Read(.env)"));
    assert.deepEqual(s.hooks, {});
  });

  it("default (non-plugin) mode is unchanged", () => {
    const p = paths(CFG);
    assert.ok(p.some((x) => x.startsWith(".claude/agents/")));
    assert.ok(p.includes(".mcp.json"));
    assert.ok(p.includes(".helix/hooks/test-on-stop.mjs"));
  });

  // Plugin agents ignore frontmatter `hooks` (sub-agents doc, verified 2026-10-11), so the
  // reviewer's Bash guard cannot exist there: the plugin reviewer must not get Bash at all.
  it("gives plugin agents maxTurns but no Bash-for-reviewer and no frontmatter hooks", () => {
    const files = byPath(pluginPack(CFG));
    for (const id of ["scout", "architect", "builder", "reviewer"]) {
      assert.match(files[`${ROOT}/agents/${id}.md`], /^maxTurns: \d+$/m, id);
      assert.doesNotMatch(files[`${ROOT}/agents/${id}.md`], /^hooks:/m, id);
    }
    assert.doesNotMatch(files[`${ROOT}/agents/reviewer.md`], /^tools: .*\bBash\b/m);
    assert.ok(!Object.keys(files).some((p) => p.endsWith("gate-only.mjs")));
  });
});
