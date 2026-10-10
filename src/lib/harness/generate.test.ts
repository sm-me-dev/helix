import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { generatePack, packAsText } from "./generate.ts";
import { DEFAULT_HARNESS_CONFIG } from "../store.ts";
import type { HarnessConfig } from "./types.ts";

const BASE: HarnessConfig = {
  crew: ["scout"],
  skills: ["graph-first"],
  mcps: ["graphify"],
  platforms: ["codex"],
  graphFirst: true,
  progressiveDisclosure: true,
  defaultSingleAgent: true,
  hooksEnabled: true,
};

describe("generatePack", () => {
  it("always emits .helix/README.md and AGENTS.md first", () => {
    const paths = generatePack(BASE).map((f) => f.path);
    assert.deepEqual(paths.slice(0, 2), [".helix/README.md", "AGENTS.md"]);
  });

  it("emits hooks only when enabled", () => {
    const cfg: HarnessConfig = { ...BASE, platforms: ["claude-code"] };
    const on = generatePack(cfg).map((f) => f.path);
    assert.ok(on.includes(".helix/hooks/prefer-graph.mjs"));
    assert.ok(on.includes(".helix/hooks/format-lint.mjs"));
    assert.ok(on.includes(".helix/hooks/test-on-stop.mjs"));
    const off = generatePack({ ...cfg, hooksEnabled: false }).map((f) => f.path);
    assert.ok(!off.some((p) => p.startsWith(".helix/hooks/")));
  });

  it("emits settings.json that parses with a Stop hook and secret denies", () => {
    const cfg: HarnessConfig = { ...BASE, platforms: ["claude-code"] };
    const settings = generatePack(cfg).find((f) => f.path === ".claude/settings.json");
    assert.ok(settings);
    const parsed = JSON.parse(settings.body) as {
      permissions: { deny: string[] };
      hooks: Record<string, unknown[]>;
    };
    assert.ok(parsed.permissions.deny.some((d) => d.includes(".env")));
    assert.ok(
      parsed.permissions.deny.some((d) => d.startsWith("Edit(")),
      "NotebookEdit is not covered by Read denies — an Edit deny must exist (verified 2026-10-09, permissions docs)",
    );
    assert.ok(Array.isArray(parsed.hooks.PostToolUse));
    assert.ok(Array.isArray(parsed.hooks.Stop));
    assert.ok(Array.isArray(parsed.hooks.PreToolUse));
    const noGraph = generatePack({ ...cfg, graphFirst: false }).find(
      (f) => f.path === ".claude/settings.json",
    );
    assert.ok(!("PreToolUse" in (JSON.parse(noGraph?.body ?? "{}") as { hooks: object })));
  });

  it("scopes platform files to the enabled platforms", () => {
    const codex = generatePack(BASE).map((f) => f.path);
    assert.ok(codex.includes(".codex/config.toml"));
    assert.ok(!codex.some((p) => p.startsWith(".claude/")));
    const claude = generatePack({ ...BASE, platforms: ["claude-code"] }).map((f) => f.path);
    assert.ok(claude.includes("CLAUDE.md"));
    assert.ok(claude.includes(".claude/agents/scout.md"));
    assert.ok(claude.includes(".claude/settings.json"));
  });

  it("emits only tier roles, never retired ones; dispatch lives in AGENTS.md", () => {
    const claude = generatePack({
      ...BASE,
      crew: ["scout", "architect", "builder", "reviewer"],
      platforms: ["claude-code"],
    });
    const paths = claude.map((f) => f.path);
    for (const retired of ["conductor", "prover", "auditor"]) {
      assert.ok(!paths.some((p) => p.includes(retired)), `retired role emitted: ${retired}`);
    }
    const agents = claude.find((f) => f.path === "AGENTS.md");
    assert.match(agents?.body ?? "", /trivial|standard|complex/);
  });

  it("stays under 40 lines and threads detected repo facts instead of generic advice", () => {
    // Full 4-role crew: the realistic always-on file, not the 1-role BASE.
    const full = { ...BASE, crew: ["scout", "architect", "builder", "reviewer"] as const };
    const plain = generatePack({ ...full, crew: [...full.crew] }).find(
      (f) => f.path === "AGENTS.md",
    );
    assert.ok((plain?.body.match(/\n/g) ?? []).length + 1 <= 40, "AGENTS.md over 40 lines");
    assert.match(plain?.body ?? "", /Read package\.json/);
    const withStack = generatePack({
      ...BASE,
      stack: {
        language: "typescript",
        packageManager: "npm",
        testCommand: "npm test",
        lintCommand: "npm run lint",
        formatCommand: null,
      },
    }).find((f) => f.path === "AGENTS.md");
    assert.ok((withStack?.body.match(/\n/g) ?? []).length + 1 <= 40, "AGENTS.md over 40 lines");
    assert.match(withStack?.body ?? "", /npm test/);
    assert.match(withStack?.body ?? "", /npm run lint/);
    assert.ok(!(withStack?.body ?? "").includes("Read package.json"));
  });

  it("gives every emitted agent a tools allow-list, a model, and a delegating description", () => {
    const claude = generatePack({
      ...BASE,
      crew: ["scout", "architect", "builder", "reviewer"],
      platforms: ["claude-code"],
    });
    const agents = claude.filter((f) => f.path.startsWith(".claude/agents/"));
    assert.ok(agents.length > 0);
    for (const a of agents) {
      assert.match(a.body, /^tools: .+/m, `${a.path} needs a tools allow-list`);
      assert.match(a.body, /^model: (haiku|sonnet|opus|inherit)/m, `${a.path} needs a model tier`);
      assert.match(
        a.body,
        /^description: Use proactively .+\.$/m,
        `${a.path} needs a delegating description`,
      );
    }
    for (const id of ["scout", "reviewer"]) {
      const file = agents.find((a) => a.path === `.claude/agents/${id}.md`);
      const toolsLine = (file?.body.match(/^tools: (.+)$/m) ?? [])[1] ?? "";
      assert.ok(
        !toolsLine.includes("Edit") && !toolsLine.includes("Write"),
        `${id} must stay read-only`,
      );
    }
  });

  it("emits each skill once, at the location the enabled platform reads", () => {
    const claudeOnly = generatePack({ ...BASE, platforms: ["claude-code"] }).map((f) => f.path);
    assert.ok(!claudeOnly.some((p) => p.startsWith("skills/")));
    assert.ok(claudeOnly.some((p) => p.startsWith(".claude/skills/graph-first/")));
    const codexOnly = generatePack({ ...BASE, platforms: ["codex"] }).map((f) => f.path);
    assert.ok(codexOnly.includes(".agents/skills/graph-first/SKILL.md"));
    assert.ok(!codexOnly.some((p) => p.startsWith(".claude/skills/")));
  });

  it("keeps the default AGENTS.md under 60 lines and ~500 rough tokens", () => {
    const agents = generatePack(DEFAULT_HARNESS_CONFIG).find((f) => f.path === "AGENTS.md");
    assert.ok(agents);
    assert.ok(agents.body.split("\n").length < 60, `got ${agents.body.split("\n").length} lines`);
    assert.ok(
      agents.body.length / 4 < 500,
      `got ~${Math.round(agents.body.length / 4)} rough tokens`,
    );
    assert.ok(
      !agents.body.includes("## Skills"),
      "skill bodies load via frontmatter, not the always-on file",
    );
  });

  it("dedupes shared skill paths across platform families", () => {
    const paths = generatePack({
      ...BASE,
      platforms: ["codex", "claude-code"],
    }).map((f) => f.path);
    const count = (p: string) => paths.filter((x) => x === p).length;
    assert.equal(count(".agents/skills/graph-first/SKILL.md"), 1);
    assert.equal(count(".claude/skills/graph-first/SKILL.md"), 1);
  });

  it("emits Codex MCP as config.toml with mcp_servers and skills under .agents", () => {
    const paths = generatePack({ ...BASE, platforms: ["codex"] }).map((f) => f.path);
    assert.ok(paths.includes(".codex/config.toml"));
    assert.ok(paths.includes(".agents/skills/graph-first/SKILL.md"));
    assert.ok(!paths.includes(".mcp.json"), "Codex reads config.toml, not .mcp.json");
    assert.ok(
      !paths.some((p) => p.startsWith("skills/")),
      "Codex reads .agents/skills, not skills/",
    );
    const toml = generatePack({ ...BASE, platforms: ["codex"] }).find(
      (f) => f.path === ".codex/config.toml",
    );
    assert.match(toml?.body ?? "", /\[mcp_servers\.graphify\]/);
  });

  it("emits portable MCP JSON with an mcpServers key for Claude and Cursor", () => {
    for (const platform of ["claude-code", "cursor"] as const) {
      const files = generatePack({ ...BASE, platforms: [platform] });
      const path = platform === "cursor" ? ".cursor/mcp.json" : ".mcp.json";
      const body = files.find((f) => f.path === path)?.body ?? "";
      const parsed = JSON.parse(body) as { mcpServers: Record<string, unknown> };
      assert.ok(parsed.mcpServers.graphify, `${path} must carry the graphify server`);
    }
  });

  it("emits VS Code MCP JSON with a servers key and a type on every server", () => {
    const body =
      generatePack({ ...BASE, platforms: ["copilot"] }).find((f) => f.path === ".vscode/mcp.json")
        ?.body ?? "";
    const parsed = JSON.parse(body) as { servers: Record<string, { type?: string }> };
    assert.ok(parsed.servers.graphify);
    for (const [name, server] of Object.entries(parsed.servers)) {
      assert.ok(["stdio", "http", "sse"].includes(server.type ?? ""), `${name} needs a type`);
    }
  });

  it("pins every MCP version and leaves no @latest or bare git ref", () => {
    const files = generatePack(DEFAULT_HARNESS_CONFIG);
    for (const f of files) {
      if (!f.path.endsWith(".json") && !f.path.endsWith(".toml")) continue;
      assert.ok(!f.body.includes("@latest"), `${f.path} must not float on @latest`);
      assert.ok(!/git\+https:[^"'\s]*["'\s](?!.*@v)/.test(f.body), `${f.path} must pin git refs`);
    }
  });

  it("emits only the instructions file for unverified platforms", () => {
    const paths = generatePack({ ...BASE, platforms: ["opencode"] }).map((f) => f.path);
    assert.ok(!paths.some((p) => p.startsWith("skills/")));
    assert.ok(!paths.includes(".mcp.json"));
  });

  it("makes no LSP claims in the pack README (no adapter emits LSP config)", () => {
    const readme = generatePack(BASE).find((f) => f.path === ".helix/README.md");
    assert.ok(!readme?.body.includes("- LSP —"));
    assert.ok(!readme?.body.includes("vtsls"));
  });

  it("throws a named error on unknown ids instead of a TypeError", () => {
    assert.throws(
      () => generatePack({ ...BASE, crew: ["nope" as never] }),
      /unknown crew role id: nope/,
    );
    assert.throws(
      () => generatePack({ ...BASE, platforms: ["nope" as never] }),
      /unknown platform id: nope/,
    );
  });
});

describe("packAsText", () => {
  it("joins files with path separators", () => {
    const text = packAsText(generatePack(BASE));
    assert.ok(text.includes("===== AGENTS.md ====="));
    assert.ok(text.includes("===== .helix/README.md ====="));
  });
});

describe("skills earn their index entry", () => {
  it("no skill is role-exclusive (those belong in the role body, not an extra load turn)", async () => {
    const { SKILLS } = await import("./skills.ts");
    const { CREW } = await import("./crew.ts");
    for (const s of SKILLS) {
      const users = CREW.filter((c) => c.skills.includes(s.id));
      assert.ok(
        users.length !== 1,
        `skill ${s.id} is used by exactly one role (${users[0]?.id}); fold it into that role's job`,
      );
    }
  });
});

// F4 (2026-10-10): lean generated pack.
describe("lean pack", () => {
  const FULL = ["scout", "architect", "builder", "reviewer"] as const;
  const cfg = (over: Partial<HarnessConfig>): HarnessConfig => ({
    ...BASE,
    crew: [...FULL],
    mcps: ["context7"],
    graphFirst: false,
    ...over,
  });
  const body = (c: HarnessConfig, path: string) =>
    generatePack(c).find((f) => f.path === path)?.body ?? "";

  it("drops the crew table when every selected platform loads agent descriptions itself", () => {
    for (const p of ["claude-code", "codex", "opencode", "cursor", "antigravity"] as const) {
      assert.doesNotMatch(body(cfg({ platforms: [p] }), "AGENTS.md"), /## Crew/, p);
    }
    // Role names stay discoverable through the Dispatch rules.
    assert.match(body(cfg({ platforms: ["claude-code"] }), "AGENTS.md"), /scout/);
  });

  it("keeps the crew table where some platform has no agent files", () => {
    assert.match(body(cfg({ platforms: [] }), "AGENTS.md"), /## Crew/);
    assert.match(body(cfg({ platforms: ["claude-code", "copilot"] }), "AGENTS.md"), /## Crew/);
  });

  it("never prints empty 'none detected' placeholders", () => {
    const a = body(
      cfg({
        platforms: ["claude-code"],
        stack: {
          language: "javascript",
          packageManager: "npm",
          testCommand: "npm test",
          lintCommand: null,
          formatCommand: null,
        },
      }),
      "AGENTS.md",
    );
    assert.doesNotMatch(a, /none detected/);
    assert.match(a, /npm test/);
  });

  it("names Graphify tools in agent allow-lists only when the graphify MCP is configured", () => {
    const off = body(cfg({ platforms: ["claude-code"] }), ".claude/agents/scout.md");
    assert.doesNotMatch(off, /mcp__graphify__/);
    assert.match(
      off,
      /^tools: .*\bGrep\b.*\bGlob\b/m,
      "scout needs a search tool without Graphify",
    );
    const on = body(
      cfg({ platforms: ["claude-code"], mcps: ["graphify"], graphFirst: true }),
      ".claude/agents/scout.md",
    );
    assert.match(on, /mcp__graphify__query_graph/);
    for (const id of ["architect", "reviewer"]) {
      assert.doesNotMatch(
        body(cfg({ platforms: ["claude-code"] }), `.claude/agents/${id}.md`),
        /mcp__graphify__/,
      );
    }
  });

  it("keeps builder's tools unchanged", () => {
    assert.match(
      body(cfg({ platforms: ["claude-code"] }), ".claude/agents/builder.md"),
      /^tools: Read, Edit, Write, Bash$/m,
    );
  });

  it("tells scout to use the repo map, not Graphify, when the graphify MCP is absent", () => {
    const off = body(cfg({ platforms: ["claude-code"] }), ".claude/agents/scout.md");
    assert.doesNotMatch(off, /Query Graphify/);
    assert.match(off, /\.helix\/map\.mjs/);
    const on = body(
      cfg({ platforms: ["claude-code"], mcps: ["graphify"], graphFirst: true }),
      ".claude/agents/scout.md",
    );
    assert.match(on, /Query Graphify/);
  });

  it("drops the graph-first skill when the graphify MCP is not configured", () => {
    const off = generatePack(cfg({ platforms: ["claude-code"] })).map((f) => f.path);
    assert.ok(!off.some((p) => p.includes("graph-first")), "unusable skill must not ship");
    const on = generatePack(
      cfg({ platforms: ["claude-code"], mcps: ["graphify"], graphFirst: true }),
    ).map((f) => f.path);
    assert.ok(on.some((p) => p.includes("graph-first")));
  });
});
