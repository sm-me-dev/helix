// End-to-end CLI behaviour: spawn the real binary in a scratch repo.
// These guard defects a green unit suite did not catch (found by running it).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { nodeOnlyBin } from "./test-env.mjs";
import { fileURLToPath } from "node:url";
import { SYMLINK_SKIP, linkDir, linkFile } from "./symlink-helper.mjs";

const BIN = fileURLToPath(new URL("./helix.mjs", import.meta.url));

function scratch() {
  const dir = mkdtempSync(join(tmpdir(), "helix-cli-"));
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name: "s", scripts: { test: "node --test" } }),
  );
  return dir;
}

function helix(dir, args, extraEnv = {}) {
  // input: "" closes stdin immediately, like CI, a pipe or an agent shell.
  // Hermetic PATH (node only): platform detection must not depend on which
  // agent CLIs happen to be installed on the machine running the tests.
  const env = { ...process.env, PATH: nodeOnlyBin(), ...extraEnv };
  return spawnSync(process.execPath, [BIN, ...args], {
    cwd: dir,
    input: "",
    encoding: "utf8",
    timeout: 30_000,
    env,
  });
}

describe("helix cli", () => {
  for (const flag of ["--help", "-h"]) {
    it(`init ${flag} prints usage and writes nothing`, () => {
      const dir = scratch();
      const r = helix(dir, ["init", flag]);
      assert.equal(r.status, 0, r.stderr);
      assert.match(r.stdout, /helix init/);
      assert.deepEqual(readdirSync(dir), ["package.json"]);
    });
  }

  it("re-running init with closed stdin never hangs, crashes or overwrites", () => {
    const dir = scratch();
    assert.equal(helix(dir, ["init"]).status, 0);
    const agents = join(dir, "AGENTS.md");
    writeFileSync(agents, "# mine\n");
    const r = helix(dir, ["init"]);
    assert.equal(r.error, undefined, "must not time out");
    assert.equal(r.status, 0, r.stderr);
    assert.equal(
      readFileSync(agents, "utf8"),
      "# mine\n",
      "differing file must be kept without --force",
    );
    assert.match(r.stdout, /skipped/);
  });

  it("--force still overwrites", () => {
    const dir = scratch();
    helix(dir, ["init"]);
    const agents = join(dir, "AGENTS.md");
    writeFileSync(agents, "# mine\n");
    assert.equal(helix(dir, ["init", "--force"]).status, 0);
    assert.notEqual(readFileSync(agents, "utf8"), "# mine\n");
  });

  it("never writes or touches the user's top-level README.md", () => {
    const dir = scratch();
    writeFileSync(join(dir, "README.md"), "# my project\n");
    assert.equal(helix(dir, ["init", "--force"]).status, 0);
    assert.equal(readFileSync(join(dir, "README.md"), "utf8"), "# my project\n");
    const fresh = scratch();
    helix(fresh, ["init"]);
    assert.ok(!existsSync(join(fresh, "README.md")));
  });

  it("merges OpenCode MCP output into existing config even with --force", () => {
    const dir = scratch();
    const path = join(dir, "opencode.json");
    writeFileSync(
      path,
      JSON.stringify({
        $schema: "https://opencode.ai/config.json",
        theme: "nord",
        mcp: { internal: { type: "local", command: ["node", "internal.mjs"] } },
      }),
    );
    const r = helix(dir, ["init", "--platform", "opencode", "--force"]);
    assert.equal(r.status, 0, r.stderr);
    const merged = JSON.parse(readFileSync(path, "utf8"));
    assert.equal(merged.theme, "nord");
    assert.deepEqual(merged.mcp.internal, { type: "local", command: ["node", "internal.mjs"] });
    assert.equal(merged.mcp.context7.type, "remote");
  });

  it("unknown command exits 2 with usage", () => {
    const r = helix(scratch(), ["bogus"]);
    assert.equal(r.status, 2);
    assert.match(r.stdout, /helix init/);
  });

  describe("platform selection", () => {
    const written = (dir) => {
      const out = [];
      const walk = (d, rel = "") => {
        for (const e of readdirSync(d, { withFileTypes: true })) {
          const r = rel ? `${rel}/${e.name}` : e.name;
          if (e.isDirectory()) walk(join(d, e.name), r);
          else out.push(r);
        }
      };
      walk(dir);
      return out.filter((f) => f !== "package.json").sort();
    };

    it("no agent config in the repo: universal pack only, no platform dirs", () => {
      const dir = scratch();
      const r = helix(dir, ["init"]);
      assert.equal(r.status, 0, r.stderr);
      assert.deepEqual(written(dir), [
        ".helix/README.md",
        ".helix/gate.json",
        ".helix/gate.mjs",
        ".helix/map.mjs",
        "AGENTS.md",
      ]);
      assert.match(r.stdout, /no agent config detected/);
    });

    it("emits only for agents whose config already exists in the repo", () => {
      const dir = scratch();
      mkdirSync(join(dir, ".cursor/rules"), { recursive: true });
      writeFileSync(join(dir, ".cursor/rules/mine.mdc"), "mine\n");
      writeFileSync(join(dir, "GEMINI.md"), "# gemini\n");
      const r = helix(dir, ["init"]);
      assert.equal(r.status, 0, r.stderr);
      const files = written(dir);
      assert.ok(files.includes(".cursor/rules/helix.mdc"), files.join());
      assert.ok(
        !files.some(
          (f) => f.startsWith(".claude/") || f === "CLAUDE.md" || f.startsWith(".codex/"),
        ),
        files.join(),
      );
      assert.match(r.stdout, /platforms: .*cursor.*gemini|platforms: .*gemini.*cursor/);
    });

    it("falls back to agent CLIs on PATH when the repo has no agent config", () => {
      const dir = scratch();
      const bin = mkdtempSync(join(tmpdir(), "helix-bin-"));
      writeFileSync(join(bin, "claude"), "#!/bin/sh\n", { mode: 0o755 });
      const r = helix(dir, ["init"], { PATH: `${nodeOnlyBin()}:${bin}` });
      assert.equal(r.status, 0, r.stderr);
      assert.ok(existsSync(join(dir, ".claude/settings.json")));
      assert.ok(!existsSync(join(dir, ".cursor")));
    });

    it("--platform overrides detection; --platform all emits every default platform", () => {
      const dir = scratch();
      mkdirSync(join(dir, ".cursor/rules"), { recursive: true });
      writeFileSync(join(dir, ".cursor/rules/mine.mdc"), "mine\n");
      assert.equal(helix(dir, ["init", "--platform", "codex"]).status, 0);
      assert.ok(!existsSync(join(dir, ".cursor/rules/helix.mdc")));
      const all = scratch();
      assert.equal(helix(all, ["init", "--platform", "all"]).status, 0);
      assert.ok(
        existsSync(join(all, ".claude/settings.json")) && existsSync(join(all, ".cursor/mcp.json")),
      );
    });
  });
});

// Containment: a pre-existing symlink in the target must never redirect a read
// or write outside it. Fail closed = exit 1, a diagnostic, and nothing written.
describe("helix init containment", { skip: SYMLINK_SKIP }, () => {
  /** An "outside" dir holding a file the pack must never touch. */
  function outsideWith(name, content) {
    const outside = mkdtempSync(join(tmpdir(), "helix-outside-"));
    writeFileSync(join(outside, name), content);
    return outside;
  }
  const listing = (d) => readdirSync(d).sort();

  it("refuses a symlinked pack directory pointing outside; writes nothing anywhere", () => {
    const dir = scratch();
    const outside = outsideWith("keep.txt", "KEEP");
    linkDir(outside, join(dir, ".claude"));
    const r = helix(dir, ["init", "--platform", "claude-code", "--force"]);
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr, /refusing \.claude\/.*outside the target/);
    assert.match(r.stderr, /nothing was written/);
    assert.doesNotMatch(r.stdout, /done:/);
    assert.deepEqual(listing(outside), ["keep.txt"], "no file created outside");
    assert.equal(readFileSync(join(outside, "keep.txt"), "utf8"), "KEEP");
    assert.ok(!existsSync(join(dir, "AGENTS.md")), "safe files are not written either");
  });

  it("refuses a destination symlinked to an outside file, even with --force", () => {
    const dir = scratch();
    const outside = outsideWith("target.md", "OUTSIDE ORIGINAL");
    linkFile(join(outside, "target.md"), join(dir, "AGENTS.md"));
    const r = helix(dir, ["init", "--force"]);
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr, /refusing AGENTS\.md/);
    assert.equal(readFileSync(join(outside, "target.md"), "utf8"), "OUTSIDE ORIGINAL");
    assert.ok(!existsSync(join(dir, ".helix")), "nothing else was written");
  });

  it("refuses an opencode.json symlinked outside: no read-merge, no overwrite", () => {
    const dir = scratch();
    const original = JSON.stringify({ theme: "outside-secret", mcp: {} });
    const outside = outsideWith("opencode.json", original);
    linkFile(join(outside, "opencode.json"), join(dir, "opencode.json"));
    const r = helix(dir, ["init", "--platform", "opencode", "--force"]);
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr, /refusing opencode\.json/);
    assert.equal(readFileSync(join(outside, "opencode.json"), "utf8"), original);
    assert.doesNotMatch(r.stdout + r.stderr, /outside-secret/, "outside content is never echoed");
  });

  it("allows a symlink that stays inside the target and keeps the link", () => {
    const dir = scratch();
    writeFileSync(join(dir, "CLAUDE.md"), "# mine\n");
    linkFile(join(dir, "CLAUDE.md"), join(dir, "AGENTS.md"));
    const r = helix(dir, ["init", "--force"]);
    assert.equal(r.status, 0, r.stderr);
    assert.notEqual(readFileSync(join(dir, "CLAUDE.md"), "utf8"), "# mine\n");
    assert.equal(
      readFileSync(join(dir, "AGENTS.md"), "utf8"),
      readFileSync(join(dir, "CLAUDE.md"), "utf8"),
    );
  });
});

// F7 (2026-10-11): the default pack is the universal one (no model subagents until asked for),
// CI backstop and the index step.
describe("helix init defaults", () => {
  const read = (dir, p) => readFileSync(join(dir, p), "utf8");
  const claudeRepo = () => {
    const dir = scratch();
    writeFileSync(join(dir, "CLAUDE.md"), "# mine\n");
    return dir;
  };

  it("installs no subagents by default, even for a detected agent that supports them", () => {
    const dir = claudeRepo();
    const r = helix(dir, ["init"]);
    assert.equal(r.status, 0, r.stderr);
    assert.ok(existsSync(join(dir, ".claude/settings.json")));
    assert.ok(!existsSync(join(dir, ".claude/agents")), "no agent files without --crew");
    assert.match(read(dir, "AGENTS.md"), /No subagents installed/);
  });

  it("--crew installs the four roles, with a guarded reviewer", () => {
    const dir = claudeRepo();
    const r = helix(dir, ["init", "--crew"]);
    assert.equal(r.status, 0, r.stderr);
    for (const id of ["scout", "architect", "builder", "reviewer"]) {
      assert.ok(existsSync(join(dir, `.claude/agents/${id}.md`)), id);
    }
    assert.match(read(dir, ".claude/agents/reviewer.md"), /gate-only\.mjs/);
    assert.ok(existsSync(join(dir, ".helix/hooks/gate-only.mjs")));
    assert.doesNotMatch(read(dir, "AGENTS.md"), /No subagents installed/);
    assert.doesNotMatch(read(dir, ".claude/agents/scout.md"), /omitClaudeMd/);
  });

  it("--lean-subagents (with --crew) starts read-only roles without AGENTS.md", () => {
    const dir = claudeRepo();
    assert.equal(helix(dir, ["init", "--crew", "--lean-subagents"]).status, 0);
    assert.match(read(dir, ".claude/agents/scout.md"), /^omitClaudeMd: true$/m);
    assert.doesNotMatch(read(dir, ".claude/agents/builder.md"), /omitClaudeMd/);
  });

  it("--lean-subagents alone says it does nothing", () => {
    const r = helix(claudeRepo(), ["init", "--lean-subagents"]);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /--lean-subagents has no effect without --crew/);
  });

  describe("CI backstop", () => {
    const wf = ".github/workflows/helix-gate.yml";

    it("is written when the repo already uses GitHub, and runs the gate", () => {
      const dir = scratch();
      mkdirSync(join(dir, ".github"));
      writeFileSync(join(dir, ".github/CODEOWNERS"), "* @me\n");
      assert.equal(helix(dir, ["init"]).status, 0);
      assert.match(read(dir, wf), /node \.helix\/gate\.mjs --all/);
    });

    it("is not written for a repo with no .github unless asked", () => {
      const dir = scratch();
      assert.equal(helix(dir, ["init"]).status, 0);
      assert.ok(!existsSync(join(dir, wf)));
      const asked = scratch();
      assert.equal(helix(asked, ["init", "--ci"]).status, 0);
      assert.ok(existsSync(join(asked, wf)));
    });

    it("--no-ci wins over detection", () => {
      const dir = scratch();
      mkdirSync(join(dir, ".github"));
      writeFileSync(join(dir, ".github/CODEOWNERS"), "* @me\n");
      assert.equal(helix(dir, ["init", "--no-ci"]).status, 0);
      assert.ok(!existsSync(join(dir, wf)));
    });

    it("explains when it cannot write one for this stack", () => {
      const dir = mkdtempSync(join(tmpdir(), "helix-cli-"));
      writeFileSync(join(dir, "go.mod"), "module x\n");
      const r = helix(dir, ["init", "--ci"]);
      assert.equal(r.status, 0, r.stderr);
      assert.ok(!existsSync(join(dir, wf)));
      assert.match(r.stdout, /ci: skipped/);
    });
  });

  describe("graph index", () => {
    // A bigger repo (graph-first needs >= 20 files) and a fake `graphify` on PATH that logs
    // its calls and, when told to, produces the report the real one would.
    function bigRepo() {
      const dir = scratch();
      mkdirSync(join(dir, "src"));
      for (let i = 0; i < 24; i++)
        writeFileSync(join(dir, `src/f${i}.ts`), `export const v${i} = ${i};\n`);
      return dir;
    }
    function fakeGraphify({ builds }) {
      const bin = mkdtempSync(join(tmpdir(), "helix-fakegraph-"));
      const log = join(bin, "calls.log");
      writeFileSync(
        join(bin, "graphify"),
        `#!/bin/sh\necho "$@" >> "${log}"\n` +
          (builds
            ? `if [ "$1" = "update" ]; then /bin/mkdir -p graphify-out; echo 'Built from commit: \`abc\`' > graphify-out/GRAPH_REPORT.md; fi\n`
            : "") +
          "exit 0\n",
        { mode: 0o755 },
      );
      return {
        env: { PATH: `${nodeOnlyBin()}:${bin}` },
        calls: () => (existsSync(log) ? readFileSync(log, "utf8") : ""),
      };
    }

    it("builds the index during init and keeps graph-first when it succeeds", () => {
      const dir = bigRepo();
      const g = fakeGraphify({ builds: true });
      const r = helix(dir, ["init"], g.env);
      assert.equal(r.status, 0, r.stderr);
      assert.match(g.calls(), /^update \.$/m);
      assert.match(read(dir, "AGENTS.md"), /query_graph/);
    });

    it("falls back to the outline map when the index cannot be built", () => {
      const dir = bigRepo();
      const g = fakeGraphify({ builds: false });
      const r = helix(dir, ["init"], g.env);
      assert.equal(r.status, 0, r.stderr);
      assert.doesNotMatch(read(dir, "AGENTS.md"), /query_graph/);
      assert.ok(existsSync(join(dir, ".helix/map.mjs")));
      assert.match(r.stdout, /no usable index/);
    });

    it("--no-index never runs graphify and uses the outline map", () => {
      const dir = bigRepo();
      const g = fakeGraphify({ builds: true });
      const r = helix(dir, ["init", "--no-index"], g.env);
      assert.equal(r.status, 0, r.stderr);
      assert.ok(!g.calls().includes("update"));
      assert.doesNotMatch(read(dir, "AGENTS.md"), /query_graph/);
    });

    it("keeps an existing index and does not rebuild it", () => {
      const dir = bigRepo();
      mkdirSync(join(dir, "graphify-out"));
      writeFileSync(join(dir, "graphify-out/GRAPH_REPORT.md"), "Built from commit: `abc`\n");
      const g = fakeGraphify({ builds: false });
      assert.equal(helix(dir, ["init"], g.env).status, 0);
      assert.ok(!g.calls().includes("update"));
      assert.match(read(dir, "AGENTS.md"), /query_graph/);
    });
  });
});
