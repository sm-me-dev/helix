import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, writeFile, mkdir, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GATE_SOURCE } from "./gate.ts";
import { HOOK_SOURCES } from "./hooks.ts";

function runHook(
  name: keyof typeof HOOK_SOURCES,
  stdinJson: string,
  cwd: string,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return (async () => {
    const dir = await mkdtemp(join(tmpdir(), "helix-hook-"));
    const file = join(dir, `${name}.mjs`);
    await writeFile(file, HOOK_SOURCES[name]);
    return new Promise((resolve, reject) => {
      const child = execFile(
        process.execPath,
        [file],
        { cwd, timeout: 30000 },
        (err, stdout, stderr) => {
          resolve({ code: (err as { code?: number } | null)?.code ?? 0, stdout, stderr });
        },
      );
      child.stdin?.write(stdinJson);
      child.stdin?.end();
      child.on("error", reject);
    });
  })();
}

const hookInput = (tool_name: string, tool_input: Record<string, unknown>) =>
  JSON.stringify({ session_id: "s1", tool_name, tool_input, cwd: "/tmp/x" });

describe("hook sources", () => {
  it("are dependency-free, cross-platform, and under 100 lines each", () => {
    for (const [name, src] of Object.entries(HOOK_SOURCES)) {
      assert.match(src, /^#!\/usr\/bin\/env node/, `${name} needs a node shebang`);
      assert.ok(!src.includes("require("), `${name} must be ESM-only`);
      const bare = src.match(/from ["'](?!node:)[^"']*["']/);
      assert.equal(bare, null, `${name} must import only node: modules`);
      assert.ok(!src.includes("/home/") && !src.includes("C:\\"), `${name} has no hardcoded paths`);
      assert.ok(src.split("\n").length < 100, `${name} must stay under 100 lines`);
    }
  });
});

describe("prefer-graph hook (PreToolUse, stdin JSON)", () => {
  it("steers a wide Glob toward the graph via additionalContext on stdout", async () => {
    const r = await runHook(
      "prefer-graph",
      hookInput("Glob", { pattern: "src/**/*.ts" }),
      tmpdir(),
    );
    assert.equal(r.code, 0);
    assert.equal(r.stderr, "");
    const out = JSON.parse(r.stdout);
    assert.equal(out.hookSpecificOutput.hookEventName, "PreToolUse");
    assert.match(out.hookSpecificOutput.additionalContext, /graphify/i);
  });

  it("steers a wide Grep toward the graph via additionalContext on stdout", async () => {
    const r = await runHook(
      "prefer-graph",
      hookInput("Grep", { pattern: "TODO", path: "./" }),
      tmpdir(),
    );
    assert.equal(r.code, 0);
    assert.equal(r.stderr, "");
    const out = JSON.parse(r.stdout);
    assert.match(out.hookSpecificOutput.additionalContext, /graphify/i);
  });

  it("passes a Read with an explicit line range untouched", async () => {
    const r = await runHook(
      "prefer-graph",
      hookInput("Read", { file_path: "src/generate.ts", offset: 1, limit: 40 }),
      tmpdir(),
    );
    assert.equal(r.code, 0);
    assert.equal(r.stderr, "");
    assert.equal(r.stdout, "");
  });

  it("fails open on malformed stdin", async () => {
    const r = await runHook("prefer-graph", "not json{{{", tmpdir());
    assert.equal(r.code, 0);
  });
});

describe("format-lint hook (PostToolUse, stdin JSON)", () => {
  it("does nothing silently when no formatter is detected", async () => {
    const dir = await mkdtemp(join(tmpdir(), "helix-nofmt-"));
    const r = await runHook(
      "format-lint",
      hookInput("Edit", { file_path: join(dir, "a.ts") }),
      dir,
    );
    assert.equal(r.code, 0);
    assert.equal(r.stderr, "");
    assert.equal(r.stdout, "");
  });

  it("runs the repo formatter on the edited file only", async () => {
    const dir = await mkdtemp(join(tmpdir(), "helix-fmt-"));
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({ devDependencies: { prettier: "^3.0.0" } }),
    );
    await mkdir(join(dir, "node_modules", ".bin"), { recursive: true });
    const shim = `#!/usr/bin/env node\nrequire("node:fs").appendFileSync(process.argv[process.argv.length - 1], "\\n// formatted\\n");\n`;
    await writeFile(join(dir, "node_modules", ".bin", "prettier"), shim);
    await chmod(join(dir, "node_modules", ".bin", "prettier"), 0o755);
    const target = join(dir, "a.ts");
    await writeFile(target, "const x=1\n");
    const r = await runHook("format-lint", hookInput("Edit", { file_path: target }), dir);
    assert.equal(r.code, 0);
    const { readFile } = await import("node:fs/promises");
    assert.match(await readFile(target, "utf8"), /formatted/);
  });

  it("fails open on malformed stdin", async () => {
    const r = await runHook("format-lint", "not json{{{", tmpdir());
    assert.equal(r.code, 0);
  });
});

describe("test-on-stop hook (Stop, stdin JSON)", () => {
  it("stays silent when no source files changed in the session", async () => {
    const dir = await mkdtemp(join(tmpdir(), "helix-stop-"));
    const transcript = join(dir, "t.jsonl");
    await writeFile(
      transcript,
      JSON.stringify({ type: "user", message: { content: "hi" } }) + "\n",
    );
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({ scripts: { test: "node -e 'process.exit(1)'" } }),
    );
    const r = await runHook(
      "test-on-stop",
      JSON.stringify({ transcript_path: transcript, cwd: dir }),
      dir,
    );
    assert.equal(r.code, 0);
    assert.equal(r.stderr, "");
  });

  it("blocks the stop with a failure tail when tests fail after edits", async () => {
    const dir = await mkdtemp(join(tmpdir(), "helix-stop-"));
    const transcript = join(dir, "t.jsonl");
    const touch = JSON.stringify({
      type: "assistant",
      message: { content: [{ type: "tool_use", name: "Edit", input: { file_path: "a.ts" } }] },
    });
    await writeFile(transcript, touch + "\n");
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({
        scripts: { test: "node -e \"console.error('boom-line'); process.exit(1)\"" },
      }),
    );
    const r = await runHook(
      "test-on-stop",
      JSON.stringify({ transcript_path: transcript, cwd: dir }),
      dir,
    );
    assert.equal(r.code, 2);
    assert.match(r.stderr, /boom-line/);
  });

  it("runs the shipped gate instead of the bare test command when present", async () => {
    const dir = await mkdtemp(join(tmpdir(), "helix-stop-gate-"));
    const transcript = join(dir, "t.jsonl");
    await writeFile(
      transcript,
      JSON.stringify({
        type: "assistant",
        message: { content: [{ type: "tool_use", name: "Edit", input: { file_path: "a.ts" } }] },
      }) + "\n",
    );
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({
        scripts: {
          lint: "node -e \"console.error('lint-boom'); process.exit(1)\"",
          test: 'node -e "process.exit(0)"',
        },
      }),
    );
    await mkdir(join(dir, ".helix"), { recursive: true });
    await writeFile(join(dir, ".helix", "gate.mjs"), GATE_SOURCE);
    const r = await runHook(
      "test-on-stop",
      JSON.stringify({ transcript_path: transcript, cwd: dir }),
      dir,
    );
    assert.equal(r.code, 2);
    assert.match(r.stderr, /FAIL lint/);
    assert.match(r.stderr, /lint-boom/);
  });

  it("fails open on malformed stdin", async () => {
    const r = await runHook("test-on-stop", "not json{{{", tmpdir());
    assert.equal(r.code, 0);
  });

  it("stands down when stop_hook_active is already true (no retry loop)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "helix-stop-"));
    const transcript = join(dir, "t.jsonl");
    const touch = JSON.stringify({
      type: "assistant",
      message: { content: [{ type: "tool_use", name: "Edit", input: { file_path: "a.ts" } }] },
    });
    await writeFile(transcript, touch + "\n");
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({
        scripts: { test: "node -e \"console.error('boom-line'); process.exit(1)\"" },
      }),
    );
    const r = await runHook(
      "test-on-stop",
      JSON.stringify({ transcript_path: transcript, cwd: dir, stop_hook_active: true }),
      dir,
    );
    assert.equal(r.code, 0);
    assert.equal(r.stderr, "");
  });

  it("ignores edits from before the last user prompt", async () => {
    const dir = await mkdtemp(join(tmpdir(), "helix-stop-"));
    const transcript = join(dir, "t.jsonl");
    const touch = JSON.stringify({
      type: "assistant",
      message: { content: [{ type: "tool_use", name: "Edit", input: { file_path: "a.ts" } }] },
    });
    const userTurn = JSON.stringify({ type: "user", message: { content: "thanks" } });
    await writeFile(transcript, touch + "\n" + userTurn + "\n");
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({
        scripts: { test: "node -e \"console.error('boom-line'); process.exit(1)\"" },
      }),
    );
    const r = await runHook(
      "test-on-stop",
      JSON.stringify({ transcript_path: transcript, cwd: dir }),
      dir,
    );
    assert.equal(r.code, 0);
    assert.equal(r.stderr, "");
  });
});
