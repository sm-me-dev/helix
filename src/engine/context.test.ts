// Phase 05: Context Management & Token Optimization Tests
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  assembleBootstrapSystemPrompt,
  compactContextIfNeeded,
  runMasterLoop,
  ContextCompactor,
  DEFAULT_CONTEXT_BUDGET,
  DefaultContextManager,
  TokenBudgetManager,
} from "./context.ts";
import { ProgressiveToolRuntime } from "./tools.ts";
import { runContextOptimizationExperiment } from "./experiment.ts";
import { DefaultObservabilityCollector } from "./observability.ts";
import { DefaultRepositoryRetriever } from "./retrieval.ts";
import { DefaultTaskPlanner, normalizeTaskDefinition } from "./task.ts";
import { DefaultToolExecutor } from "./tools.ts";
import { TokenBudgetExceededError } from "./types.ts";

function createTempDir(): string {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "helix-p05-test-"));
  return tmp;
}

function cleanupDir(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
}

describe("Phase 05: Context Management & Token Optimization", () => {
  describe("Progressive disclosure runtime", () => {
    it("keeps bootstrap tools visible and compacts old tool output to NOTES.md", () => {
      const tmp = createTempDir();
      try {
        const { systemPrompt, state } = assembleBootstrapSystemPrompt({
          workspaceRoot: tmp,
          sessionId: "bootstrap-test",
          maxContextTokens: 5,
        });
        assert.ok(systemPrompt.length > 0);
        assert.deepEqual(
          [...state.visibleToolNames],
          ["load_skill", "tool_search", "spawn_scout", "consult_peer", "Read", "Grep", "Glob"],
        );
        const messages = [
          "src/a.ts:4",
          "function ready()",
          "Error: expected true",
          "verified invariant",
          "symbol export ready",
          "completed tool call",
        ].map((content) => ({
          role: "tool" as const,
          content,
          timestamp: new Date().toISOString(),
        }));
        const compacted = compactContextIfNeeded(messages, state, tmp);
        assert.notEqual(compacted[0].content, messages[0].content);
        assert.ok(compacted[0].content.includes("NOTES.md"));
        const notes = fs.readFileSync(
          path.join(tmp, ".helix/runtime/bootstrap-test/NOTES.md"),
          "utf8",
        );
        assert.ok(notes.includes("src/a.ts:4"));
        assert.ok(notes.includes("function ready()"));
        assert.ok(notes.includes("Error: expected true"));
        assert.ok(notes.includes("verified invariant"));
      } finally {
        cleanupDir(tmp);
      }
    });

    it("rejects invisible tools, unlocks searched schemas, and enforces approved write scopes", async () => {
      const tmp = createTempDir();
      try {
        const { state } = assembleBootstrapSystemPrompt({
          workspaceRoot: tmp,
          sessionId: "tool-test",
          maxContextTokens: 1000,
        });
        const runtime = new ProgressiveToolRuntime({ workspaceRoot: tmp, state });
        const hidden = await runtime.invoke("Write", {
          filePath: "src/sample.ts",
          content: "export const x = 1;",
        });
        assert.equal(hidden.isError, true);
        assert.match(hidden.content, /tool_search/);
        const found = runtime.toolSearch("write file");
        assert.ok(found.some((schema) => schema.name === "Write"));
        const mcpRuntime = new ProgressiveToolRuntime({
          workspaceRoot: tmp,
          state,
          schemas: [
            {
              name: "query_graph",
              description: "Search the dependency graph",
              source: "mcp",
              inputSchema: { type: "object", properties: { query: { type: "string" } } },
            },
          ],
        });
        assert.ok(
          mcpRuntime.toolSearch("dependency graph").some((schema) => schema.name === "query_graph"),
        );
        runtime.approveWriteScope("src/**");
        const write = await runtime.invoke("Write", {
          filePath: "src/sample.ts",
          content: "export const x = 1;",
        });
        assert.equal(write.isError, false, write.content);
        assert.equal(
          fs.readFileSync(path.join(tmp, "src/sample.ts"), "utf8"),
          "export const x = 1;",
        );
      } finally {
        cleanupDir(tmp);
      }
    });

    it("loads a canonical skill on demand and hints when Read matches its Tier 0 route", async () => {
      const tmp = createTempDir();
      try {
        const domainDir = path.join(tmp, ".helix/knowledge/domains/demo");
        fs.mkdirSync(domainDir, { recursive: true });
        fs.writeFileSync(
          path.join(domainDir, "domain.md"),
          "---\nid: demo\nname: Demo\ndescription: Demo rules\nsource_paths:\n  - src/module.ts\n---\n# Demo\nKeep the module deterministic.\n",
          "utf8",
        );
        fs.mkdirSync(path.join(tmp, "src"), { recursive: true });
        fs.writeFileSync(path.join(tmp, "src/module.ts"), "export const ready = true;\n", "utf8");
        const { state } = assembleBootstrapSystemPrompt({
          workspaceRoot: tmp,
          sessionId: "skill-test",
          maxContextTokens: 2000,
        });
        const runtime = new ProgressiveToolRuntime({ workspaceRoot: tmp, state });
        const read = await runtime.invoke("Read", { filePath: "src/module.ts" });
        assert.match(read.content, /Call load_skill\("demo"\)/);
        runtime.toolSearch("edit file");
        runtime.approveWriteScope("src/**");
        const edited = await runtime.invoke("Edit", {
          filePath: "src/module.ts",
          oldString: "ready = true",
          newString: "ready = false",
        });
        assert.match(edited.content, /Call load_skill\("demo"\)/);
        const loaded = await runtime.invoke("load_skill", { domain_id: "demo" });
        assert.match(loaded.content, /Keep the module deterministic/);
        assert.equal(state.loadedDomainIds.has("demo"), true);
      } finally {
        cleanupDir(tmp);
      }
    });

    it("continues tool-use turns in one master loop and obeys the turn ceiling", async () => {
      const { state } = assembleBootstrapSystemPrompt({
        sessionId: "loop-test",
        maxContextTokens: 1000,
        maxTurns: 3,
      });
      let calls = 0;
      const result = await runMasterLoop(state, [], async (messages) => {
        calls++;
        const nextMessages = [
          ...messages,
          { role: "tool" as const, content: `turn ${calls}`, timestamp: new Date().toISOString() },
        ];
        return {
          stop_reason: calls === 2 ? ("end_turn" as const) : ("tool_use" as const),
          value: calls,
          messages: nextMessages,
        };
      });
      assert.equal(result.value, 2);
      assert.equal(state.turnCount, 2);
      assert.equal(result.messages.length, 2);
    });
  });

  describe("1. Task-Specific Context Construction (Task A)", () => {
    it("assembles layered context adhering to strict layer token budgets", async () => {
      const tmp = createTempDir();
      try {
        const contextMgr = new DefaultContextManager(DEFAULT_CONTEXT_BUDGET);
        const task = normalizeTaskDefinition({
          prompt: "Implement safe token budgeting and history compaction",
          workspaceRoot: tmp,
          targetFiles: ["src/engine/context.ts"],
        });
        const planner = new DefaultTaskPlanner();
        const plan = await planner.plan(task);

        const ctx = await contextMgr.assembleContext(task, plan);

        assert.ok(ctx.tokenCount <= DEFAULT_CONTEXT_BUDGET.totalPromptMaxTokens);
        assert.ok(ctx.systemPrompt.includes("Helix Single-Agent Execution"));
        assert.ok(ctx.taskPrompt.includes("safe token budgeting"));
        assert.ok(ctx.layerBreakdown);
        assert.ok(ctx.layerBreakdown.systemTokens <= 300);
        assert.ok(ctx.layerBreakdown.contractTokens <= 350);
        assert.ok(ctx.budgetRemaining > 0);
      } finally {
        cleanupDir(tmp);
      }
    });

    it("includes extracted interfaces and related tests progressively", async () => {
      const tmp = createTempDir();
      try {
        const srcDir = path.join(tmp, "src");
        fs.mkdirSync(srcDir, { recursive: true });
        const codeFile = path.join(srcDir, "math.ts");
        const testFile = path.join(srcDir, "math.test.ts");

        fs.writeFileSync(
          codeFile,
          `export interface CalculatorConfig { precision: number; }\nexport type MathOp = "add" | "sub";\nexport function calculate(a: number, b: number): number { return a + b; }\n`,
          "utf8",
        );
        fs.writeFileSync(testFile, `// math tests\n`, "utf8");

        const retriever = new DefaultRepositoryRetriever({ workspaceRoot: tmp });
        const contextMgr = new DefaultContextManager(DEFAULT_CONTEXT_BUDGET);
        const task = normalizeTaskDefinition({
          prompt: "Add multiplication to math.ts",
          workspaceRoot: tmp,
          targetFiles: ["src/math.ts"],
        });
        const planner = new DefaultTaskPlanner();
        const plan = await planner.plan(task);

        const ctx = await contextMgr.assembleContext(task, plan, undefined, {
          retriever,
          includeInterfaces: true,
          includeTests: true,
        });

        assert.ok(ctx.taskPrompt.includes("CalculatorConfig"));
        assert.ok(ctx.taskPrompt.includes("math.test.ts"));
        assert.ok(ctx.includedReferences.includes("src/math.ts"));
        assert.ok(ctx.includedReferences.includes("src/math.test.ts"));
        assert.ok(ctx.tokenCount <= DEFAULT_CONTEXT_BUDGET.totalPromptMaxTokens);
      } finally {
        cleanupDir(tmp);
      }
    });
  });

  describe("2. Repository Retrieval Mechanism (Task B)", () => {
    it("queries semantic graph when graphify-out/graph.json exists", async () => {
      const tmp = createTempDir();
      try {
        const graphDir = path.join(tmp, "graphify-out");
        fs.mkdirSync(graphDir, { recursive: true });
        const graphData = {
          nodes: [
            {
              id: "src_context_manager",
              label: "DefaultContextManager",
              norm_label: "defaultcontextmanager",
              source_file: "src/engine/context.ts",
              source_location: "L340",
              _callable_class: true,
            },
            {
              id: "src_token_budget",
              label: "TokenBudgetManager",
              norm_label: "tokenbudgetmanager",
              source_file: "src/engine/context.ts",
              source_location: "L50",
              _callable_class: true,
            },
          ],
        };
        fs.writeFileSync(path.join(graphDir, "graph.json"), JSON.stringify(graphData), "utf8");

        const retriever = new DefaultRepositoryRetriever({ workspaceRoot: tmp });
        const symbols = await retriever.queryStructure("budget");

        assert.equal(symbols.length, 1);
        assert.equal(symbols[0].name, "TokenBudgetManager");
        assert.equal(symbols[0].kind, "class");
        assert.equal(symbols[0].filePath, "src/engine/context.ts");
        assert.equal(symbols[0].line, 50);
      } finally {
        cleanupDir(tmp);
      }
    });

    it("falls back to structural outline search when graph is missing", async () => {
      const tmp = createTempDir();
      try {
        const srcDir = path.join(tmp, "src");
        fs.mkdirSync(srcDir, { recursive: true });
        fs.writeFileSync(
          path.join(srcDir, "service.ts"),
          `export class AuthService {}\nexport function authenticate() {}\nexport interface UserSession {}\n`,
          "utf8",
        );

        const retriever = new DefaultRepositoryRetriever({ workspaceRoot: tmp });
        const symbols = await retriever.queryStructure("auth");

        assert.ok(symbols.length >= 2);
        assert.ok(symbols.some((s) => s.name === "AuthService" && s.kind === "class"));
        assert.ok(symbols.some((s) => s.name === "authenticate" && s.kind === "function"));
      } finally {
        cleanupDir(tmp);
      }
    });

    it("fetches narrow cited excerpts and enforces max excerpt line limits", async () => {
      const tmp = createTempDir();
      try {
        const srcDir = path.join(tmp, "src");
        fs.mkdirSync(srcDir, { recursive: true });
        const testFile = path.join(srcDir, "large.ts");
        // Create 150 line file
        const lines = Array.from({ length: 150 }, (_, i) => `const line_${i + 1} = ${i + 1};`);
        fs.writeFileSync(testFile, lines.join("\n"), "utf8");

        const retriever = new DefaultRepositoryRetriever({
          workspaceRoot: tmp,
          maxExcerptLines: 50,
        });

        // Request 100 lines (exceeds maxExcerptLines of 50)
        const excerpts = await retriever.fetchExcerpts([
          { path: "src/large.ts", start: 10, end: 110, reason: "Testing excerpt bounding" },
        ]);

        assert.equal(excerpts.length, 1);
        assert.equal(excerpts[0].startLine, 10);
        // End line must be clamped to startLine + 50 - 1 = 59
        assert.equal(excerpts[0].endLine, 59);
        const fetchedLines = excerpts[0].content.split("\n");
        assert.equal(fetchedLines.length, 50);
        assert.ok(fetchedLines[0].includes("line_10"));
      } finally {
        cleanupDir(tmp);
      }
    });
  });

  describe("3. Context Compaction for Long-Running Tasks (Task C)", () => {
    it("compacts multi-turn history into a structured summary preserving critical facts", () => {
      const messages = [
        {
          role: "system" as const,
          content: "You are Helix implementer.",
          timestamp: "2026-11-02T10:00:00Z",
        },
        {
          role: "user" as const,
          content: "Task ID: task-01\nPrompt: Refactor auth token validation",
          timestamp: "2026-11-02T10:00:01Z",
        },
        {
          role: "assistant" as const,
          content:
            "decided to split token validation into jwt and session handlers. Wrote src/auth/jwt.ts.",
          timestamp: "2026-11-02T10:00:05Z",
        },
        {
          role: "user" as const,
          content:
            "Verification error: AssertionError: token expired signature mismatch at line 42",
          timestamp: "2026-11-02T10:00:10Z",
        },
        {
          role: "assistant" as const,
          content: "found missing secret in options. Created src/auth/config.ts.",
          timestamp: "2026-11-02T10:00:15Z",
        },
        {
          role: "user" as const,
          content: "Next step: update verify() call in test",
          timestamp: "2026-11-02T10:00:20Z",
        },
        {
          role: "assistant" as const,
          content: "Ready to update test file.",
          timestamp: "2026-11-02T10:00:25Z",
        },
      ];

      const { compactedMessages, summary } = ContextCompactor.compact(messages, {
        keepRecentMessages: 2,
        maxSummaryTokens: 500,
      });

      // System message + 1 summary message + 2 recent messages = 4 messages
      assert.equal(compactedMessages.length, 4);
      assert.equal(compactedMessages[0].role, "system");
      assert.equal(compactedMessages[1].role, "user");
      assert.ok(compactedMessages[1].content.includes("HELIX CONTEXT COMPACTION SUMMARY"));
      assert.equal(compactedMessages[2].content, messages[5].content);
      assert.equal(compactedMessages[3].content, messages[6].content);

      // Verify essential facts preserved
      assert.ok(
        summary.modifiedFiles.some(
          (f) => f.includes("src/auth/jwt.ts") || f.includes("src/auth/config.ts"),
        ),
      );
      assert.ok(
        summary.failedApproaches.some((e) => e.includes("token expired signature mismatch")),
      );
      assert.ok(summary.decisions.length > 0);
      assert.ok(summary.tokenCount > 0);
    });
  });

  describe("4. Agent Handoff Context Boundaries (Task D)", () => {
    it("assembles handoff context without leaking prior conversation transcript", async () => {
      const tmp = createTempDir();
      try {
        const contextMgr = new DefaultContextManager(DEFAULT_CONTEXT_BUDGET);
        const task = normalizeTaskDefinition({
          prompt: "Build user profile endpoint",
          workspaceRoot: tmp,
          targetFiles: ["src/user.ts"],
        });
        const planner = new DefaultTaskPlanner();
        const plan = await planner.plan(task);

        const handoffCard = {
          goal: "Implement profile endpoint",
          constraints: "no external deps",
          file: "src/user.ts",
          done: "node .helix/gate.mjs",
          outOfScope: "billing",
          serializedText:
            "goal: Implement profile endpoint\nconstraints: no external deps\nfile: src/user.ts\ndone: node .helix/gate.mjs\nout of scope: billing",
          lineCount: 5,
        };

        const ctx = await contextMgr.assembleContext(task, plan, undefined, {
          handoffCard,
          role: "builder",
        });

        assert.ok(ctx.systemPrompt.includes("Helix BUILDER Execution"));
        assert.ok(ctx.taskPrompt.includes("Handoff Contract (Max 12 Lines)"));
        assert.ok(ctx.taskPrompt.includes("goal: Implement profile endpoint"));
        assert.ok(!ctx.taskPrompt.includes("Conversation transcript"));
        assert.equal(ctx.handoffCard, handoffCard);
      } finally {
        cleanupDir(tmp);
      }
    });
  });

  describe("5. Role & Task Token Budgets (Task E)", () => {
    it("enforces role token ceilings and throws TokenBudgetExceededError", () => {
      const budgetMgr = new TokenBudgetManager({
        reviewMaxTokens: 1000,
      });

      // Under ceiling
      budgetMgr.checkBudget("reviewer", 500);
      budgetMgr.recordUsage("reviewer", {
        inputTokens: 400,
        outputTokens: 200,
        cacheReadTokens: 0,
        totalTokens: 600,
      });
      assert.equal(budgetMgr.getRoleUsage("reviewer").totalTokens, 600);

      // Attempting to exceed ceiling
      assert.throws(
        () => {
          budgetMgr.checkBudget("reviewer", 500);
        },
        (err: unknown) => {
          return err instanceof TokenBudgetExceededError && err.role === "reviewer";
        },
      );
    });

    it("enforces global total task token ceiling", () => {
      const budgetMgr = new TokenBudgetManager({
        totalTaskMaxTokens: 5000,
      });

      budgetMgr.recordUsage("implementer", {
        inputTokens: 2000,
        outputTokens: 1000,
        cacheReadTokens: 0,
        totalTokens: 3000,
      });

      assert.throws(
        () => {
          budgetMgr.checkBudget("implementer", 2500);
        },
        (err: unknown) => {
          return err instanceof TokenBudgetExceededError && err.role === "total_task";
        },
      );
    });
  });

  describe("6. Output Control & Deduplication (Task F)", () => {
    it("deduplicates repeated file reads via cache", async () => {
      const tmp = createTempDir();
      try {
        const testFile = path.join(tmp, "sample.ts");
        fs.writeFileSync(testFile, "export const x = 1;\nexport const y = 2;\n", "utf8");

        const tools = new DefaultToolExecutor();
        assert.equal(tools.getRepeatedReadCount(), 0);

        // Read file 1st time
        const content1 = await tools.readFile("sample.ts", 1, 2, {
          workspaceRoot: tmp,
          environmentVariables: {},
          forbiddenPaths: [],
          maxOutputBytes: 1024,
          timeoutMs: 5000,
        });
        assert.equal(content1, "export const x = 1;\nexport const y = 2;");
        assert.equal(tools.getRepeatedReadCount(), 0);

        // Read file 2nd time (identical slice & mtime) -> should hit cache
        const content2 = await tools.readFile("sample.ts", 1, 2, {
          workspaceRoot: tmp,
          environmentVariables: {},
          forbiddenPaths: [],
          maxOutputBytes: 1024,
          timeoutMs: 5000,
        });
        assert.equal(content2, content1);
        assert.equal(tools.getRepeatedReadCount(), 1);

        // Modify file -> cache must be invalidated
        await tools.writeFile("sample.ts", "export const x = 100;\n", {
          workspaceRoot: tmp,
          environmentVariables: {},
          forbiddenPaths: [],
          maxOutputBytes: 1024,
          timeoutMs: 5000,
        });

        const content3 = await tools.readFile("sample.ts", 1, 1, {
          workspaceRoot: tmp,
          environmentVariables: {},
          forbiddenPaths: [],
          maxOutputBytes: 1024,
          timeoutMs: 5000,
        });
        assert.equal(content3, "export const x = 100;");
      } finally {
        cleanupDir(tmp);
      }
    });

    it("clamps whole file reads exceeding 200 lines to avoid token blowout", async () => {
      const tmp = createTempDir();
      try {
        const testFile = path.join(tmp, "huge.ts");
        const lines = Array.from({ length: 300 }, (_, i) => `// line ${i + 1}`);
        fs.writeFileSync(testFile, lines.join("\n"), "utf8");

        const tools = new DefaultToolExecutor();
        // Read without startLine or endLine
        const content = await tools.readFile("huge.ts", undefined, undefined, {
          workspaceRoot: tmp,
          environmentVariables: {},
          forbiddenPaths: [],
          maxOutputBytes: 100000,
          timeoutMs: 5000,
        });

        const readLines = content.split("\n");
        // Clamped to 200 lines + 1 warning comment line
        assert.ok(readLines.length <= 203);
        assert.ok(
          content.includes("[Output control: File has 300 lines; clamped to first 200 lines"),
        );
      } finally {
        cleanupDir(tmp);
      }
    });

    it("applies intelligent head+tail truncation on command output", async () => {
      const tmp = createTempDir();
      try {
        const tools = new DefaultToolExecutor();
        // Generate 500 lines of output with distinct start and finish
        const cmd =
          "node -e \"console.log('HEADER_START'); for(let i=0; i<300; i++) console.log('Noise line ' + i); console.log('FINAL_ASSERTION_FAILURE');\"";
        const res = await tools.executeCommand(cmd, {
          workspaceRoot: tmp,
          environmentVariables: {},
          forbiddenPaths: [],
          maxOutputBytes: 600,
          timeoutMs: 5000,
        });

        assert.equal(res.truncated, true);
        assert.ok(res.output.includes("HEADER_START"));
        assert.ok(res.output.includes("FINAL_ASSERTION_FAILURE"));
        assert.ok(res.output.includes("output truncated:"));
      } finally {
        cleanupDir(tmp);
      }
    });
  });

  describe("7. Observability & Token Metrics Tracking", () => {
    it("records role token usage, context reuse, and compaction counts", async () => {
      const obs = new DefaultObservabilityCollector();

      obs.recordRoleTokenUsage("planner", {
        inputTokens: 500,
        outputTokens: 200,
        cacheReadTokens: 50,
        totalTokens: 700,
      });
      obs.recordRoleTokenUsage("implementer", {
        inputTokens: 1200,
        outputTokens: 400,
        cacheReadTokens: 100,
        totalTokens: 1600,
      });
      obs.recordContextReuse(850);
      obs.recordCompaction();
      obs.recordFileAccess("src/engine/context.ts", "read");
      obs.recordFileAccess("src/engine/context.ts", "read"); // repeated read

      const report = await obs.generateReport("task-obs-test");

      assert.ok(report.optimization);
      assert.equal(report.optimization.contextReuseTokens, 850);
      assert.equal(report.optimization.compactionCount, 1);
      assert.equal(report.optimization.repeatedFileRetrievals, 1);
      assert.equal(report.optimization.tokensByRole.planner.totalTokens, 700);
      assert.equal(report.optimization.tokensByRole.implementer.totalTokens, 1600);
    });
  });

  describe("8. Empirical Benchmark: Context & Token Optimization", () => {
    it("demonstrates measurable (>50%) token reduction against baseline with 100% pass rate", async () => {
      const tmp = createTempDir();
      try {
        const benchmarkTasks = [
          normalizeTaskDefinition({
            id: "bench-opt-1",
            title: "Task 1: Math module",
            prompt: "Update math calculation",
            workspaceRoot: tmp,
            targetFiles: ["math.ts"],
          }),
          normalizeTaskDefinition({
            id: "bench-opt-2",
            title: "Task 2: Logger utility",
            prompt: "Implement safe logger",
            workspaceRoot: tmp,
            targetFiles: ["logger.ts"],
          }),
        ];

        const report = await runContextOptimizationExperiment(benchmarkTasks);

        assert.ok(
          report.tokenReductionPercent >= 50,
          `Expected token reduction >= 50%, got ${report.tokenReductionPercent}%`,
        );
        assert.equal(report.arms["unoptimized-baseline"].passRate, 100);
        assert.equal(report.arms["helix-token-optimized"].passRate, 100);
        assert.ok(report.comparisonTable.includes("Helix Token-Optimized"));
        assert.ok(report.conclusion.includes("Net Token Consumption Reduction"));
      } finally {
        cleanupDir(tmp);
      }
    });
  });
});
