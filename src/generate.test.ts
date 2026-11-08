import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { generatePack, packAsText } from "./generate.ts";
import { DEFAULT_HARNESS_CONFIG } from "./defaults.ts";
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
      if (platform === "claude-code") {
        for (const server of Object.values(parsed.mcpServers) as Array<Record<string, unknown>>) {
          if ("url" in server) assert.equal(server.type, "http");
        }
      }
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

// F7 (2026-10-11): role controls verified against https://code.claude.com/docs/en/sub-agents
// (maxTurns, omitClaudeMd >= v2.1.271, frontmatter hooks that are ignored for plugin agents).
describe("role controls (Claude Code)", () => {
  const FULL = ["scout", "architect", "builder", "reviewer"] as const;
  const cfg = (over: Partial<HarnessConfig> = {}): HarnessConfig => ({
    ...BASE,
    crew: [...FULL],
    platforms: ["claude-code"],
    mcps: ["graphify"],
    ...over,
  });
  const body = (c: HarnessConfig, path: string) =>
    generatePack(c).find((f) => f.path === path)?.body ?? "";
  const agent = (c: HarnessConfig, id: string) => body(c, `.claude/agents/${id}.md`);
  const front = (c: HarnessConfig, id: string) =>
    agent(c, id).match(/^---\n([\s\S]*?)\n---\n/)?.[1] ?? "";

  it("caps every role with maxTurns so a looping agent has a ceiling", () => {
    for (const id of FULL) {
      const m = agent(cfg(), id).match(/^maxTurns: (\d+)$/m);
      assert.ok(m, `${id} needs maxTurns`);
      assert.ok(Number(m[1]) >= 5 && Number(m[1]) <= 60, `${id} maxTurns ${m[1]} out of range`);
    }
  });

  it("lets the reviewer run the gate and nothing else", () => {
    const rev = agent(cfg(), "reviewer");
    assert.match(rev, /^tools: .*\bBash\b/m);
    assert.match(rev, /^hooks:\n {2}PreToolUse:\n {4}- matcher: "Bash"/m);
    assert.match(rev, /node \.helix\/hooks\/gate-only\.mjs/);
    const paths = generatePack(cfg()).map((f) => f.path);
    assert.ok(paths.includes(".helix/hooks/gate-only.mjs"));
    for (const id of ["scout", "architect"]) {
      assert.doesNotMatch(front(cfg(), id), /\bBash\b|^hooks:/m, id);
    }
  });

  it("never grants the reviewer an unguarded Bash", () => {
    const off = cfg({ hooksEnabled: false });
    assert.doesNotMatch(front(off, "reviewer"), /\bBash\b|^hooks:/m);
    assert.ok(!generatePack(off).some((f) => f.path.endsWith("gate-only.mjs")));
  });

  it("omits CLAUDE.md/AGENTS.md for scout, architect and reviewer only when leanSubagents is on", () => {
    for (const id of FULL) assert.doesNotMatch(agent(cfg(), id), /omitClaudeMd/, `${id} default`);
    const lean = cfg({ leanSubagents: true });
    for (const id of ["scout", "architect", "reviewer"]) {
      assert.match(agent(lean, id), /^omitClaudeMd: true$/m, id);
    }
    assert.doesNotMatch(agent(lean, "builder"), /omitClaudeMd/);
  });

  it("does not call a brief graph-cited when the graphify MCP is absent", () => {
    const off = cfg({ mcps: [], graphFirst: false, platforms: ["claude-code", "cursor", "codex"] });
    for (const f of generatePack(off)) {
      if (/agents\//.test(f.path)) assert.doesNotMatch(f.body, /graph-cited/, f.path);
    }
    assert.match(agent(cfg(), "scout"), /graph-cited/);
  });

  it("denies credential directories outside the repo as well as .env", () => {
    const s = JSON.parse(body(cfg(), ".claude/settings.json")) as {
      permissions: { deny: string[] };
    };
    for (const rule of ["Read(~/.ssh/**)", "Read(~/.aws/**)", "Read(**/*.pem)", "Read(.env)"]) {
      assert.ok(s.permissions.deny.includes(rule), rule);
    }
  });
});

describe("no-crew pack", () => {
  const cfg = (crew: HarnessConfig["crew"]): HarnessConfig => ({
    ...BASE,
    crew,
    platforms: ["claude-code"],
    mcps: ["context7"],
    graphFirst: false,
  });
  const agentsMd = (c: HarnessConfig) =>
    generatePack(c).find((f) => f.path === "AGENTS.md")?.body ?? "";

  it("does not tell the agent to dispatch roles that were not installed", () => {
    const a = agentsMd(cfg([]));
    assert.doesNotMatch(a, /fresh-window reviewer|scout|architect|Dispatch the matching crew/i);
    assert.match(a, /main session/);
    assert.ok(!generatePack(cfg([])).some((f) => f.path.startsWith(".claude/agents/")));
  });

  it("still states the security rule and the gate", () => {
    const a = agentsMd(cfg([]));
    assert.match(a, /Security-sensitive/);
    assert.match(a, /node \.helix\/gate\.mjs/);
  });

  it("keeps the role dispatch rules when a crew is installed", () => {
    assert.match(agentsMd(cfg(["scout", "builder", "reviewer"])), /fresh-window reviewer/);
  });
});

describe("CI backstop", () => {
  const stack = (language: string, packageManager = "npm") => ({
    language,
    packageManager,
    testCommand: "npm test",
    lintCommand: null,
    formatCommand: null,
  });
  const cfg = (over: Partial<HarnessConfig>): HarnessConfig => ({
    ...BASE,
    crew: [],
    platforms: [],
    mcps: [],
    graphFirst: false,
    ...over,
  });
  const wf = (c: HarnessConfig) =>
    generatePack(c).find((f) => f.path === ".github/workflows/helix-gate.yml");

  it("is emitted only when asked for", () => {
    assert.equal(wf(cfg({ stack: stack("typescript") })), undefined);
  });

  it("runs the portable gate on every agent's pushes, with SHA-pinned actions", () => {
    const f = wf(cfg({ ci: "github", stack: stack("typescript") }));
    assert.ok(f);
    assert.match(f.body, /node \.helix\/gate\.mjs --all/);
    assert.match(f.body, /npm ci/);
    for (const m of f.body.matchAll(/uses:\s*([^\s#]+)/g)) {
      assert.match(m[1], /@[0-9a-f]{40}$/, `${m[1]} must be pinned to a SHA`);
    }
    assert.match(f.body, /permissions:\n {2}contents: read/);
  });

  it("uses the detected package manager", () => {
    assert.match(
      wf(cfg({ ci: "github", stack: stack("javascript", "pnpm") }))!.body,
      /pnpm install --frozen-lockfile/,
    );
    assert.match(
      wf(cfg({ ci: "github", stack: stack("javascript", "yarn") }))!.body,
      /yarn install --immutable/,
    );
  });

  it("is skipped for stacks it cannot install, instead of shipping a broken workflow", () => {
    assert.equal(wf(cfg({ ci: "github", stack: stack("go") })), undefined);
    assert.equal(wf(cfg({ ci: "github", stack: stack("javascript", "bun") })), undefined);
    assert.equal(wf(cfg({ ci: "github" })), undefined);
  });
});

describe("minimal instructions", () => {
  const cfg = (extra: Partial<HarnessConfig> = {}): HarnessConfig => ({
    ...BASE,
    crew: [],
    platforms: ["opencode"],
    mcps: [],
    graphFirst: false,
    minimalInstructions: true,
    stack: {
      language: "typescript",
      packageManager: "npm",
      testCommand: "npm test",
      lintCommand: "npm run lint",
      formatCommand: null,
    },
    ...extra,
  });
  const agentsMd = (c: HarnessConfig) =>
    generatePack(c).find((f) => f.path === "AGENTS.md")?.body ?? "";

  it("keeps only what an agent cannot cheaply discover: commands, the gate, the secret rule", () => {
    const a = agentsMd(cfg());
    assert.match(a, /npm test/);
    assert.match(a, /node \.helix\/gate\.mjs/);
    assert.match(a, /secret/i);
    assert.doesNotMatch(a, /Classify|orchestrator|Dispatch|Return summaries|failing test first/);
  });

  it("stays under 90 words and is smaller than the default file", () => {
    const min = agentsMd(cfg());
    const full = agentsMd(cfg({ minimalInstructions: false }));
    assert.ok(min.split(/\s+/).filter(Boolean).length <= 90, min);
    assert.ok(min.length < full.length / 2);
  });

  it("never names subagents or a graph that the pack does not ship", () => {
    const a = agentsMd(cfg());
    assert.doesNotMatch(a, /subagent|query_graph|Graph/i);
  });

  it("refuses to drop the role table when a crew is installed", () => {
    assert.throws(() => generatePack(cfg({ crew: ["scout"] })), /minimalInstructions/);
  });
});
