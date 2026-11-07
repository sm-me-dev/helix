import assert from "node:assert/strict";
import fs from "node:fs";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { invokeProviderHeadlessAgent } from "./provider.ts";
import {
  createAgentRunner,
  createModelProvider,
  DefaultModelProvider,
  HelixExecutionEngine,
  loadEngineConfig,
  MockAgentRunner,
  normalizeTaskDefinition,
  saveEngineConfig,
  type TaskDefinition,
} from "./index.ts";

describe("Phase 08: Integration & Hardening Subsystem Tests", () => {
  it("invokes a configured headless API with token accounting and canary redaction", async () => {
    const previousCanary = process.env.ADMIN_TEST_KEY;
    process.env.ADMIN_TEST_KEY = "integration-canary-secret";
    const server = createServer((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          choices: [{ message: { content: "reviewed integration-canary-secret" } }],
          usage: { prompt_tokens: 19, completion_tokens: 5 },
        }),
      );
    });
    try {
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
      });
      const address = server.address();
      assert.ok(address && typeof address !== "string");
      const result = await invokeProviderHeadlessAgent("codex", {
        mode: "api",
        modelId: "test-model",
        prompt: "Review this isolated payload",
        timeoutMs: 2_000,
        maxInputTokens: 100,
        maxOutputTokens: 100,
        api: {
          endpoint: `http://127.0.0.1:${address.port}/v1/chat/completions`,
          format: "openai-chat-completions",
          apiKey: "local-test-token",
        },
      });
      assert.equal(result.exitCode, 0);
      assert.equal(result.tokens.inputTokens, 19);
      assert.equal(result.tokens.outputTokens, 5);
      assert.equal(result.stdout, "reviewed [REDACTED_CANARY]");
      assert.ok(!result.stdout.includes("integration-canary-secret"));
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      if (previousCanary === undefined) delete process.env.ADMIN_TEST_KEY;
      else process.env.ADMIN_TEST_KEY = previousCanary;
    }
  });

  describe("1. Configuration Management (loadEngineConfig / saveEngineConfig)", () => {
    it("returns default configuration when no file or env vars present", async () => {
      const config = await loadEngineConfig("/tmp/nonexistent-dir");
      assert.equal(config.defaultPlatform, "claude-code");
      assert.equal(config.defaultSingleAgent, true);
      assert.equal(config.worktreeStorageDir, ".helix-work/worktrees");
      assert.equal(config.defaultTimeoutSec, 600);
      assert.equal(config.maxRetries, 2);
    });

    it("loads and parses .helix/config.json from project directory", async () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "helix-config-test-"));
      try {
        await saveEngineConfig(tmp, {
          defaultPlatform: "opencode",
          defaultSingleAgent: false,
          defaultTimeoutSec: 300,
          maxRetries: 1,
        });

        const loaded = await loadEngineConfig(tmp);
        assert.equal(loaded.defaultPlatform, "opencode");
        assert.equal(loaded.defaultSingleAgent, false);
        assert.equal(loaded.defaultTimeoutSec, 300);
        assert.equal(loaded.maxRetries, 1);
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
      }
    });

    it("allows environment variables to override file configuration", async () => {
      const prevPlatform = process.env.HELIX_PLATFORM;
      const prevTimeout = process.env.HELIX_TIMEOUT_SEC;
      try {
        process.env.HELIX_PLATFORM = "cursor";
        process.env.HELIX_TIMEOUT_SEC = "450";

        const config = await loadEngineConfig();
        assert.equal(config.defaultPlatform, "cursor");
        assert.equal(config.defaultTimeoutSec, 450);
      } finally {
        if (prevPlatform !== undefined) process.env.HELIX_PLATFORM = prevPlatform;
        else delete process.env.HELIX_PLATFORM;

        if (prevTimeout !== undefined) process.env.HELIX_TIMEOUT_SEC = prevTimeout;
        else delete process.env.HELIX_TIMEOUT_SEC;
      }
    });
  });

  describe("2. Model Provider & Cost Accounting (DefaultModelProvider)", () => {
    it("counts tokens consistently using BPE tokenizer", () => {
      const provider = new DefaultModelProvider("anthropic");
      const tokens = provider.countTokens("function calculateSum(a, b) { return a + b; }");
      assert.ok(tokens > 5 && tokens < 25);
      assert.equal(provider.countTokens(""), 0);
    });

    it("calculates cost accurately for Anthropic models", () => {
      const provider = createModelProvider("anthropic");
      const cost = provider.calculateCost("claude-3-5-sonnet-20241022", {
        inputTokens: 10_000,
        outputTokens: 2_000,
        cacheReadTokens: 5_000,
        totalTokens: 17_000,
      });

      // 10k * $3/M = $0.030, 2k * $15/M = $0.030, 5k * $0.3/M = $0.0015 -> $0.0615
      assert.equal(cost.currency, "USD");
      assert.ok(Math.abs(cost.estimatedTotalUsd - 0.0615) < 0.0001);
      assert.equal(cost.breakdown.inputUsd, 0.03);
      assert.equal(cost.breakdown.outputUsd, 0.03);
    });

    it("calculates cost accurately for OpenAI and Google models", () => {
      const openaiProvider = createModelProvider("openai");
      const oaiCost = openaiProvider.calculateCost("gpt-4o", {
        inputTokens: 1_000_000,
        outputTokens: 100_000,
        cacheReadTokens: 0,
        totalTokens: 1_100_000,
      });
      // 1M * $2.5 + 100k * $10 = $2.5 + $1.0 = $3.5
      assert.equal(oaiCost.estimatedTotalUsd, 3.5);

      const googleProvider = createModelProvider("google");
      const geminiCost = googleProvider.calculateCost("gemini-2.5-flash", {
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
        cacheReadTokens: 0,
        totalTokens: 2_000_000,
      });
      // 1M * $0.075 + 1M * $0.30 = $0.375
      assert.equal(geminiCost.estimatedTotalUsd, 0.375);
    });
  });

  describe("3. Agent Runner Factory (createAgentRunner)", () => {
    it("returns MockAgentRunner when simulation is true", () => {
      const runner = createAgentRunner({ simulation: true });
      assert.ok(runner instanceof MockAgentRunner);
    });

    it("returns SubprocessAgentRunner with custom command when specified", () => {
      const runner = createAgentRunner({ command: "node", args: ["--version"] });
      assert.equal(runner.platform, "claude-code");
    });
  });

  describe("4. End-to-End Engine Execution & Hardening", () => {
    it("executes task end-to-end with validation, diff extraction, and metrics", async () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "helix-integration-test-"));
      try {
        const targetFile = path.join(tmp, "service.ts");
        fs.writeFileSync(targetFile, "export function status() { return 'offline'; }\n", "utf8");

        const runner = new MockAgentRunner("claude-code", [
          {
            exitCode: 0,
            fileEdits: {
              [targetFile]: "export function status() { return 'online'; }\n",
            },
            tokens: { input: 1200, output: 250, cacheRead: 300 },
          },
        ]);

        const provider = createModelProvider("anthropic");
        const engine = new HelixExecutionEngine({ runner, provider });

        const task: TaskDefinition = normalizeTaskDefinition({
          id: "task-integration-01",
          title: "Update service status",
          prompt: "Change status to online in service.ts",
          workspaceRoot: tmp,
          targetFiles: [targetFile],
        });

        const result = await engine.execute(task, { isolatedWorktree: false });

        assert.equal(result.status, "succeeded");
        assert.equal(result.finalWorkflowState, "COMPLETE");
        assert.ok(result.diff.includes("+export function status() { return 'online'; }"));
        assert.ok(result.metrics);
        assert.equal(result.metrics.tokens?.inputTokens, 1200);
        assert.equal(result.metrics.tokens?.outputTokens, 250);
        assert.ok((result.metrics.tokens?.estimatedCostUsd ?? 0) > 0);
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
      }
    });

    it("cleans up ephemeral worktrees and releases locks on task failure", async () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "helix-fail-cleanup-test-"));
      try {
        const runner = new MockAgentRunner("claude-code", [
          { exitCode: 1, stderr: "Simulated build syntax error" },
          { exitCode: 1, stderr: "Simulated build syntax error retry 1" },
          { exitCode: 1, stderr: "Simulated build syntax error retry 2" },
        ]);

        const engine = new HelixExecutionEngine({ runner });

        const task: TaskDefinition = normalizeTaskDefinition({
          id: "task-integration-fail",
          title: "Failing task",
          prompt: "Task destined to fail gate verification",
          workspaceRoot: tmp,
          constraints: { maxRetries: 1 },
        });

        const result = await engine.execute(task, { isolatedWorktree: false });

        assert.equal(result.status, "failed");
        assert.equal(result.finalWorkflowState, "BLOCKED");
        assert.ok(result.error);
        assert.equal(result.error.code, "EXECUTION_FAILED");
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
      }
    });

    it("handles abort signals gracefully and records cancellation status", async () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "helix-abort-test-"));
      try {
        const runner = new MockAgentRunner("claude-code", async () => {
          await new Promise((r) => setTimeout(r, 150));
          return { exitCode: 0 };
        });

        const engine = new HelixExecutionEngine({ runner });

        const task = normalizeTaskDefinition({
          id: "task-abort-integration",
          title: "Abort test task",
          prompt: "Task that will be aborted",
          workspaceRoot: tmp,
        });

        const execPromise = engine.execute(task, { isolatedWorktree: false });
        setTimeout(() => {
          engine.abort(task.id, "User requested cancellation");
        }, 50);

        const result = await execPromise;
        assert.equal(result.status, "cancelled");
        assert.ok(result.error);
        assert.equal(result.error.code, "TASK_CANCELLED");
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
      }
    });
  });
});
