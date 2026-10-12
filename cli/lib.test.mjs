import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  assertSafePackPath,
  configForStack,
  defaultConfig,
  detectStack,
  diffLines,
  doctorPack,
  graphFreshness,
  mcpSummary,
  mergeOpenCodeConfig,
  measureReport,
  packJson,
  packPathSegments,
  reconstructConfig,
} from "./lib.ts";
import { generatePack } from "../src/generate.ts";
import { PLATFORM_BY_ID } from "../src/platforms.ts";

describe("detectStack", () => {
  it("detects a TypeScript npm repo with test and lint scripts", () => {
    const d = detectStack({
      names: new Set(["package.json", "tsconfig.json", "package-lock.json", "Makefile"]),
      packageJson: { scripts: { test: "vitest run", lint: "eslint ." } },
      makefile: null,
      justfile: null,
    });
    assert.equal(d.language, "typescript");
    assert.equal(d.packageManager, "npm");
    assert.equal(d.testCommand, "npm test");
    assert.equal(d.lintCommand, "npm run lint");
  });

  it("falls back to Makefile and justfile targets", () => {
    const d = detectStack({
      names: new Set(["Makefile", "go.mod"]),
      packageJson: null,
      makefile: "test:\n\tgo test ./...\n",
      justfile: null,
    });
    assert.equal(d.language, "go");
    assert.equal(d.testCommand, "make test");
  });

  it("lists existing agent files for the overwrite prompt", () => {
    const d = detectStack({
      names: new Set(["AGENTS.md", ".mcp.json"]),
      packageJson: null,
      makefile: null,
      justfile: null,
    });
    assert.deepEqual(d.existingAgentFiles, ["AGENTS.md", ".mcp.json"]);
  });

  it("counts files and spots UI by framework dep or component files", () => {
    const ui = detectStack({
      names: new Set(["package.json", "src/app.tsx", "index.html"]),
      packageJson: { dependencies: { react: "^19.0.0" } },
      makefile: null,
      justfile: null,
    });
    assert.equal(ui.fileCount, 3);
    assert.equal(ui.uiPresent, true);
    const cli = detectStack({
      names: new Set(["go.mod", "main.go"]),
      packageJson: null,
      makefile: null,
      justfile: null,
    });
    assert.equal(cli.fileCount, 2);
    assert.equal(cli.uiPresent, false);
  });
});

describe("configForStack", () => {
  it("drops graphify and graph-first under 20 files", () => {
    const c = configForStack(["claude-code"], { fileCount: 5, uiPresent: false });
    assert.ok(!c.mcps.includes("graphify"));
    assert.equal(c.graphFirst, false);
  });

  it("falls back to the outline map when graphify is not installed, even on a big repo", () => {
    const c = configForStack(["claude-code"], {
      fileCount: 500,
      uiPresent: false,
      graphifyAvailable: false,
    });
    assert.ok(!c.mcps.includes("graphify"));
    assert.equal(c.graphFirst, false);
    const kept = configForStack(["claude-code"], {
      fileCount: 500,
      uiPresent: false,
      graphifyAvailable: true,
    });
    assert.ok(kept.mcps.includes("graphify"));
  });

  it("drops playwright without a UI, keeps it with one", () => {
    const noUi = configForStack(["claude-code"], { fileCount: 200, uiPresent: false });
    assert.ok(!noUi.mcps.includes("playwright"));
    const ui = configForStack(["claude-code"], { fileCount: 200, uiPresent: true });
    assert.ok(ui.mcps.includes("playwright"));
    assert.ok(ui.mcps.includes("graphify"));
  });

  it("keeps the full crew (isolation is per-task, not init-time)", () => {
    const c = configForStack(["claude-code"], { fileCount: 5, uiPresent: false });
    assert.deepEqual(c.crew, ["scout", "architect", "builder", "reviewer"]);
  });
});

describe("diffLines", () => {
  it("reports identical files", () => {
    assert.equal(diffLines("a\nb\n", "a\nb\n"), "identical");
  });

  it("shows changed hunks with context", () => {
    const out = diffLines("1\n2\n3\n4\n", "1\n2\nX\n4\n");
    assert.match(out, /- 3/);
    assert.match(out, /\+ X/);
  });
});

describe("doctorPack", () => {
  it("passes a helix-generated pack", () => {
    const files = new Map(
      generatePack(defaultConfig(["claude-code", "codex"])).map((f) => [f.path, f.body]),
    );
    const failures = doctorPack(files).filter((f) => f.check !== "mcp-measured");
    assert.deepEqual(failures, []);
  });

  it("fails broken configs with actionable messages", () => {
    const failures = doctorPack(
      new Map([
        [".mcp.json", "{not json"],
        [".vscode/mcp.json", JSON.stringify({ mcpServers: {} })],
      ]),
    );
    assert.ok(failures.some((f) => f.check === "config:.mcp.json"));
    assert.ok(failures.some((f) => f.check === "config:.vscode/mcp.json"));
    assert.ok(failures.some((f) => f.check === "agents-md"));
  });

  it("passes an outline-fallback pack with no graphify and flags a missing map file", () => {
    const cfg = { ...defaultConfig(["claude-code"]), graphFirst: false, mcps: [] };
    const files = new Map(generatePack(cfg).map((f) => [f.path, f.body]));
    assert.deepEqual(
      doctorPack(files).filter((f) => f.check !== "mcp-measured"),
      [],
    );
    files.delete(".helix/map.mjs");
    assert.ok(doctorPack(files).some((f) => f.check === "map"));
  });

  it("flags a pack whose AGENTS.md demands the gate but whose gate file is gone", () => {
    const files = new Map(
      generatePack(defaultConfig(["claude-code"])).map((f) => [f.path, f.body]),
    );
    files.delete(".helix/gate.mjs");
    const failures = doctorPack(files).filter((f) => f.check === "gate");
    assert.equal(failures.length, 1);
  });

  it("flags unpinned uvx --from specs", () => {
    const failures = doctorPack(
      new Map([
        [
          ".mcp.json",
          JSON.stringify({
            mcpServers: {
              g: { command: "uvx", args: ["--from", "graphifyy[mcp]", "graphify-mcp"] },
            },
          }),
        ],
      ]),
    );
    assert.ok(
      failures.some((f) => f.check === "pin:.mcp.json"),
      "uvx --from without a version pin must fail doctor",
    );
  });
});

describe("reconstructConfig", () => {
  it("detects enabled platforms from emitted files", () => {
    const files = new Map(generatePack(defaultConfig(["codex"])).map((f) => [f.path, f.body]));
    const cfg = reconstructConfig(files);
    assert.ok(cfg.platforms.includes("codex"));
    assert.ok(!cfg.platforms.includes("cursor"));
  });

  it("reads mcps, skills and crew from the files, not from the catalog defaults", () => {
    const files = new Map([
      ["AGENTS.md", "# x\n"],
      [".mcp.json", JSON.stringify({ mcpServers: { context7: { url: "https://x" } } })],
      [".agents/skills/graph-first/SKILL.md", "---\nname: graph-first\n---\n"],
      [".claude/agents/scout.md", "---\nname: scout\n---\n"],
    ]);
    const cfg = reconstructConfig(files);
    assert.deepEqual(cfg.mcps, ["context7"]);
    assert.deepEqual(cfg.skills, ["graph-first"]);
    assert.deepEqual(cfg.crew, ["scout"]);
  });

  it("reports an empty mcp, skill and crew set for a universal pack", () => {
    const files = new Map([
      ["AGENTS.md", "# x\n"],
      [".helix/gate.json", "{}"],
    ]);
    const cfg = reconstructConfig(files);
    assert.deepEqual(cfg.mcps, []);
    assert.deepEqual(cfg.skills, []);
    assert.deepEqual(cfg.crew, []);
  });

  it("reads codex toml and vscode servers", () => {
    const files = new Map([
      [".codex/config.toml", '[mcp_servers.context7]\nurl = "https://x"\n'],
      [
        ".vscode/mcp.json",
        JSON.stringify({ servers: { github: { type: "http", url: "https://y" } } }),
      ],
    ]);
    assert.deepEqual([...reconstructConfig(files).mcps].sort(), ["context7", "github"]);
  });
});

describe("mcpSummary and graphFreshness", () => {
  it("reports per-server tokens with freshness", () => {
    const lines = mcpSummary(defaultConfig(["claude-code"]));
    assert.ok(lines.some((l) => l.startsWith("graphify:") && /measured|estimate/.test(l)));
  });

  it("flags a stale graph index", () => {
    const stale = graphFreshness(
      () => "Built from commit: `aaaaaaa`",
      () => "bbbbbbb",
    );
    assert.equal(stale.length, 1);
    const fresh = graphFreshness(
      () => "Built from commit: `aaaaaaa`",
      () => "aaaaaaa",
    );
    assert.deepEqual(fresh, []);
    const missing = graphFreshness(
      () => null,
      () => "aaaaaaa",
    );
    assert.equal(missing.length, 1);
  });
});
describe("measureReport and packJson", () => {
  it("prints computed numbers with the method", () => {
    const out = measureReport(defaultConfig(["claude-code"]));
    assert.match(out, /always-on/);
    assert.match(out, /o200k_base/);
  });

  it("emits scriptable JSON for one platform", () => {
    const parsed = JSON.parse(packJson(defaultConfig(["codex"])));
    assert.ok(parsed.files.some((f) => f.path === ".codex/config.toml"));
  });
});

describe("mergeOpenCodeConfig", () => {
  it("preserves unrelated config and existing same-name MCP definitions", () => {
    const existing = {
      $schema: "https://example.invalid/open-code-config.json",
      theme: "nord",
      mcp: {
        graphify: { type: "local", command: ["custom-graphify", "--private-option"] },
        internal: { type: "local", command: ["node", "internal-mcp.mjs"] },
      },
    };
    const generated = {
      $schema: "https://opencode.ai/config.json",
      mcp: {
        graphify: { type: "local", command: ["uvx", "--from", "graphifyy[mcp]"] },
        context7: { type: "remote", url: "https://example.invalid/mcp" },
      },
    };
    const result = mergeOpenCodeConfig(JSON.stringify(existing), JSON.stringify(generated));
    const merged = JSON.parse(result.content);
    assert.equal(merged.theme, "nord");
    assert.equal(merged["$schema"], existing["$schema"]);
    assert.deepEqual(merged.mcp.graphify, existing.mcp.graphify);
    assert.deepEqual(merged.mcp.internal, existing.mcp.internal);
    assert.deepEqual(merged.mcp.context7, generated.mcp.context7);
    assert.deepEqual(result.preservedMcpServers, ["graphify"]);
  });

  it("fails closed on malformed or wrong-shaped JSON", () => {
    assert.throws(() => mergeOpenCodeConfig("{", "{}"), /JSON|position/i);
    assert.throws(() => mergeOpenCodeConfig("[]", '{"mcp":{}}'), /must be a JSON object/);
    assert.throws(
      () => mergeOpenCodeConfig("{}", '{"mcp":[]}'),
      /generated mcp config must be a JSON object/,
    );
  });
});

describe("assertSafePackPath", () => {
  it("accepts normal and nested relative pack paths", () => {
    for (const p of [
      "AGENTS.md",
      ".helix/gate.mjs",
      ".claude/skills/x/SKILL.md",
      ".github/copilot-instructions.md",
      "a/b/c/d/e.txt",
      "name..with..dots.md",
      "dir\\file.md", // backslash is a separator after normalization, so this is nested
    ]) {
      assert.equal(assertSafePackPath(p), null, p);
    }
  });

  it("accepts every path the generator emits for every platform", () => {
    for (const id of Object.keys(PLATFORM_BY_ID)) {
      for (const f of generatePack(defaultConfig([id]))) {
        assert.equal(assertSafePackPath(f.path), null, `${id}: ${f.path}`);
      }
    }
  });

  const rejected = {
    "POSIX absolute": ["/etc/passwd", "/", "\\etc\\passwd"],
    "Windows drive-rooted": ["C:\\foo", "C:/foo", "c:\\foo", "Z:\\"],
    "Windows drive-relative": ["C:foo", "C:", "d:foo\\bar", "C:..\\x"],
    "UNC and extended": [
      "\\\\server\\share\\x",
      "//server/share/x",
      "\\\\?\\C:\\Windows\\x",
      "//?/C:/x",
      "\\\\.\\pipe\\x",
      "\\\\?\\UNC\\server\\share",
    ],
    "parent traversal": [
      "..",
      "../x",
      "..\\x",
      "a/../../x",
      "a\\..\\..\\x",
      "a/..\\x",
      "a\\../x",
      "a/b/..",
    ],
    "Windows-trimmed dot and space segments": [".. /x", "a/.. ", "...", "a./b", "a /b"],
    "null byte and control characters": ["a\0b", "\0", "AGENTS.md\0.txt", "a\nb", "a\tb", "a\x7fb"],
    "malformed or empty": ["", "a//b", "a/", "./a", "a/./b", "a\\\\b", "x".repeat(257)],
    "colon in a segment": ["a/b:stream", "a:b", "x/C:y"],
    "non-string input": [undefined, null, 42, {}],
  };
  for (const [label, inputs] of Object.entries(rejected)) {
    it(`rejects ${label}`, () => {
      for (const p of inputs) {
        assert.ok(assertSafePackPath(p), `should reject ${JSON.stringify(p)}`);
      }
    });
  }

  it("normalizes separators the same way the validator does", () => {
    assert.deepEqual(packPathSegments("a\\b/c"), ["a", "b", "c"]);
  });
});

describe("doctorPack: reviewer guard", () => {
  const reviewer = (extra = "") =>
    `---\nname: reviewer\ntools: Read, Bash\nmodel: opus\n${extra}---\n\nbody\n`;
  const base = () =>
    new Map([
      ["AGENTS.md", "# x\n"],
      [".helix/gate.mjs", "// gate\n"],
    ]);

  it("fails a reviewer with Bash but no gate-only hook wired", () => {
    const files = base();
    files.set(".claude/agents/reviewer.md", reviewer());
    const f = doctorPack(files).find((x) => x.check === "reviewer-guard");
    assert.ok(f, "unguarded reviewer Bash must fail doctor");
  });

  it("fails when the hook is referenced but the script is missing", () => {
    const files = base();
    files.set(
      ".claude/agents/reviewer.md",
      reviewer(
        'hooks:\n  PreToolUse:\n    - matcher: "Bash"\n      hooks:\n        - type: command\n          command: "node .helix/hooks/gate-only.mjs"\n',
      ),
    );
    assert.ok(doctorPack(files).some((x) => x.check === "reviewer-guard"));
  });

  it("passes when the hook and its script are both present", () => {
    const files = base();
    files.set(
      ".claude/agents/reviewer.md",
      reviewer(
        'hooks:\n  PreToolUse:\n    - matcher: "Bash"\n      hooks:\n        - type: command\n          command: "node .helix/hooks/gate-only.mjs"\n',
      ),
    );
    files.set(".helix/hooks/gate-only.mjs", "// guard\n");
    assert.ok(!doctorPack(files).some((x) => x.check === "reviewer-guard"));
  });

  it("ignores a reviewer without Bash", () => {
    const files = base();
    files.set(".claude/agents/reviewer.md", "---\nname: reviewer\ntools: Read\n---\n");
    assert.ok(!doctorPack(files).some((x) => x.check === "reviewer-guard"));
  });
});
