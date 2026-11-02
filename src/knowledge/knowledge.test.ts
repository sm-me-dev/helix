// Helix Adaptive Project Knowledge System (APKS) - Comprehensive Tests
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { ProjectScanner, DomainDiscovery } from "./discovery.ts";
import { SQLiteKnowledgeIndex } from "./index.ts";
import {
  ChangeImpactAnalyzer,
  DomainRestructurer,
  KnowledgeAuditor,
  KnowledgeUpdater,
  KnowledgeValidator,
} from "./maintenance.ts";
import {
  computeContentHash,
  KnowledgeRepository,
  parseFrontmatter,
  serializeFrontmatter,
} from "./repository.ts";
import { AdaptiveKnowledgeRetriever } from "./retriever.ts";
import { KnowledgeSecurityGuard } from "./security.ts";
import type { KnowledgeItem, KnowledgeUpdateProposal } from "./types.ts";

describe("APKS: Project Scanner & Domain Discovery", () => {
  it("scans workspace and decomposes files into domains", () => {
    const scanner = new ProjectScanner(".");
    const scan = scanner.scanWorkspace();
    assert.ok(scan.files.length > 0);
    assert.ok(scan.languages.length > 0);

    const discovery = new DomainDiscovery(".");
    const summary = discovery.discover();
    assert.ok(summary.discoveredDomains.length > 0);
    assert.ok(summary.overviewMarkdown.includes("Project Overview"));
  });
});

describe("APKS: Frontmatter Parsing & Serialization", () => {
  it("parses valid YAML frontmatter blocks", () => {
    const raw = `---
id: test.item
title: Test Title
domain: test-domain
status: verified
sources:
  - path: src/test.ts
    lines: 1-10
dependencies:
  - dep-one
  - dep-two
tags:
  - tag1
---

# Content Body
This is the document body.`;

    const parsed = parseFrontmatter(raw);
    assert.equal(parsed.frontmatter.id, "test.item");
    assert.equal(parsed.frontmatter.title, "Test Title");
    assert.equal(parsed.frontmatter.domain, "test-domain");
    assert.equal(parsed.frontmatter.status, "verified");
    assert.deepEqual(parsed.frontmatter.dependencies, ["dep-one", "dep-two"]);
    assert.deepEqual(parsed.frontmatter.tags, ["tag1"]);
    assert.equal(parsed.content, "# Content Body\nThis is the document body.");
  });

  it("handles empty or missing frontmatter gracefully", () => {
    const raw = "Plain markdown content without frontmatter.";
    const parsed = parseFrontmatter(raw);
    assert.deepEqual(parsed.frontmatter, {});
    assert.equal(parsed.content, raw);
  });

  it("roundtrips serialized frontmatter and content accurately", () => {
    const fm = {
      id: "roundtrip.item",
      title: "Roundtrip Test",
      status: "verified",
      tags: ["roundtrip", "test"],
    };
    const body = "Roundtrip body content";
    const serialized = serializeFrontmatter(fm, body);
    const reparsed = parseFrontmatter(serialized);

    assert.equal(reparsed.frontmatter.id, "roundtrip.item");
    assert.equal(reparsed.frontmatter.title, "Roundtrip Test");
    assert.deepEqual(reparsed.frontmatter.tags, ["roundtrip", "test"]);
    assert.equal(reparsed.content, body);
  });

  it("computes deterministic SHA-256 hashes", () => {
    const text = "Hello Helix APKS";
    const h1 = computeContentHash(text);
    const h2 = computeContentHash(text);
    assert.equal(h1, h2);
    assert.equal(h1.length, 64);
  });
});

describe("APKS: Security, Secret Exclusion & Path Traversal", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "helix-sec-test-"));
  const sec = new KnowledgeSecurityGuard(tmpDir);

  it("blocks path traversal outside workspace root", () => {
    assert.throws(() => {
      sec.assertSafePath("../../etc/passwd");
    }, /escapes allowed boundary/);
  });

  it("identifies secret patterns and credential files", () => {
    assert.ok(sec.isExcludedPath(".env"));
    assert.ok(sec.isExcludedPath(".env.production"));
    assert.ok(sec.isExcludedPath("id_rsa"));
    assert.ok(sec.isExcludedPath("server.pem"));
    assert.ok(sec.isExcludedPath("credentials.json"));
    assert.ok(sec.isExcludedPath("api_token.txt"));
    assert.ok(sec.isExcludedPath(".git/HEAD"));
    assert.ok(sec.isExcludedPath("node_modules/pkg/index.js"));
    assert.ok(!sec.isExcludedPath("src/index.ts"));
  });

  it("sanitizes hardcoded secrets and prompt injections", () => {
    const textWithSecret = "API Key: ghp_123456789012345678901234567890123456";
    const sanitized = sec.sanitizeSourceContent(textWithSecret, "test.ts");
    assert.ok(sanitized.warnings.length > 0);
    assert.ok(!sanitized.sanitized.includes("ghp_123456789012345678901234567890123456"));
    assert.ok(sanitized.sanitized.includes("[REDACTED_SECRET]"));
  });
});

describe("APKS: Canonical Knowledge Repository", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "helix-repo-test-"));
  const repo = new KnowledgeRepository(tmpDir);

  it("creates and saves domain records and items", () => {
    repo.ensureDirectories();

    repo.saveDomain({
      id: "test-domain",
      name: "Test Domain",
      description: "A test domain description",
      sourcePaths: ["src/test.ts"],
      createdAt: "2026-11-02",
      updatedAt: "2026-11-02",
    });

    const domains = repo.loadAllDomains();
    assert.equal(domains.length, 1);
    assert.equal(domains[0].id, "test-domain");
    assert.equal(domains[0].name, "Test Domain");

    const item: KnowledgeItem = {
      id: "test.item1",
      domainId: "test-domain",
      type: "architecture",
      title: "Test Architecture",
      content: "This is test architecture content.",
      sourcePath: "",
      status: "verified",
      sources: [{ path: "src/test.ts" }],
      dependencies: ["dep-one"],
      createdAt: "2026-11-02",
      updatedAt: "2026-11-02",
      verifiedAt: "2026-11-02",
      contentHash: "",
    };

    repo.saveItem(item);
    const items = repo.loadAllItems();
    assert.equal(items.length, 1);
    assert.equal(items[0].id, "test.item1");
    assert.equal(items[0].domainId, "test-domain");
    assert.equal(items[0].status, "verified");
  });

  it("appends provenance logs to changelog.jsonl", () => {
    repo.appendChangelog({
      operation: "CREATE_ITEM",
      targetId: "test.item1",
      reason: "Initial architecture creation",
      author: "TestAgent",
    });

    const changelogPath = path.join(repo.knowledgeDir, "history", "changelog.jsonl");
    assert.ok(fs.existsSync(changelogPath));
    const content = fs.readFileSync(changelogPath, "utf8");
    assert.ok(content.includes("CREATE_ITEM"));
    assert.ok(content.includes("test.item1"));
  });
});

describe("APKS: SQLite FTS5 Indexing & Search", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "helix-idx-test-"));
  const repo = new KnowledgeRepository(tmpDir);
  const dbPath = path.join(tmpDir, "test-knowledge.sqlite");
  const index = new SQLiteKnowledgeIndex(dbPath);

  it("indexes domains and items with FTS5 BM25 search", () => {
    repo.ensureDirectories();

    repo.saveDomain({
      id: "execution",
      name: "Execution Engine",
      description: "Deterministic task execution and lifecycle",
      sourcePaths: ["src/engine/engine.ts"],
      createdAt: "2026-11-02",
      updatedAt: "2026-11-02",
    });

    repo.saveItem({
      id: "execution.lifecycle",
      domainId: "execution",
      type: "architecture",
      title: "Engine Lifecycle States",
      content: "Engine manages task transitions from init to verifying and pass.",
      sourcePath: "",
      status: "verified",
      sources: [{ path: "src/engine/engine.ts" }],
      dependencies: [],
      createdAt: "2026-11-02",
      updatedAt: "2026-11-02",
      verifiedAt: "2026-11-02",
      contentHash: "",
      tags: ["lifecycle", "engine"],
    });

    const stats = index.incrementalIndex(repo);
    assert.equal(stats.domainsIndexed, 1);
    assert.equal(stats.itemsIndexed, 1);

    // Search FTS5
    const results = index.searchFts("lifecycle");
    assert.ok(results.length > 0);
    assert.equal(results[0].id, "execution.lifecycle");
    assert.equal(results[0].domainId, "execution");
    assert.ok(results[0].snippet.toLowerCase().includes("lifecycle"));
  });

  it("is disposable and rebuilds identically from scratch", () => {
    // Delete database file
    index.close();
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);

    // Recreate index from repository
    const freshIndex = new SQLiteKnowledgeIndex(dbPath);
    const stats = freshIndex.rebuildIndex(repo);

    assert.equal(stats.domainsIndexed, 1);
    assert.equal(stats.itemsIndexed, 1);

    const results = freshIndex.searchFts("lifecycle");
    assert.equal(results.length, 1);
    assert.equal(results[0].id, "execution.lifecycle");
    freshIndex.close();
  });
});

describe("APKS: Dynamic Context Retrieval Pipeline", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "helix-ret-test-"));
  const repo = new KnowledgeRepository(tmpDir);
  const dbPath = path.join(tmpDir, "test-ret.sqlite");
  const index = new SQLiteKnowledgeIndex(dbPath);

  repo.ensureDirectories();

  repo.saveDomain({
    id: "orchestration",
    name: "Agent Orchestration",
    description: "Multi-agent coordination and handoff",
    sourcePaths: ["src/engine/orchestrator.ts"],
    dependencies: ["execution-engine"],
    keywords: ["orchestrator", "handoff", "multi-agent"],
    createdAt: "2026-11-02",
    updatedAt: "2026-11-02",
  });

  repo.saveDomain({
    id: "execution-engine",
    name: "Core Engine",
    description: "Gate verification and execution baseline",
    sourcePaths: ["src/engine/engine.ts"],
    keywords: ["execution", "gate"],
    createdAt: "2026-11-02",
    updatedAt: "2026-11-02",
  });

  repo.saveItem({
    id: "orchestration.handoff",
    domainId: "orchestration",
    type: "architecture",
    title: "Multi-Agent Handoff Card Protocol",
    content: "Enforces max 12 lines on handoff cards across subagent transitions.",
    sourcePath: "",
    status: "verified",
    sources: [{ path: "src/engine/orchestrator.ts" }],
    dependencies: ["execution.gate"],
    createdAt: "2026-11-02",
    updatedAt: "2026-11-02",
    verifiedAt: "2026-11-02",
    contentHash: "",
  });

  repo.saveItem({
    id: "execution.gate",
    domainId: "execution-engine",
    type: "constraint",
    title: "Mechanical Gate Verification Invariant",
    content: "Zero tokens spent on self-review. Verification gate must exit 0.",
    sourcePath: "",
    status: "verified",
    sources: [{ path: "src/engine/engine.ts" }],
    dependencies: [],
    createdAt: "2026-11-02",
    updatedAt: "2026-11-02",
    verifiedAt: "2026-11-02",
    contentHash: "",
  });

  index.incrementalIndex(repo);
  const retriever = new AdaptiveKnowledgeRetriever({ index, defaultTokenBudget: 1500 });

  it("retrieves top-ranked items matching prompt and target files", async () => {
    const pkg = await retriever.retrieve({
      taskId: "test-task-1",
      prompt: "Update multi-agent handoff card limit",
      targetFiles: ["src/engine/orchestrator.ts"],
      agentRole: "implementer",
    });

    assert.ok(pkg.items.length > 0);
    assert.equal(pkg.items[0].item.id, "orchestration.handoff");
    assert.ok(pkg.items[0].score > 30);
    assert.ok(pkg.markdownSection.includes("Multi-Agent Handoff Card Protocol"));
  });

  it("expands dependencies within bounded depth", async () => {
    const pkg = await retriever.retrieve({
      taskId: "test-task-2",
      prompt: "Handoff card implementation",
      targetFiles: ["src/engine/orchestrator.ts"],
      agentRole: "implementer",
    });

    const itemIds = pkg.items.map((i) => i.item.id);
    assert.ok(itemIds.includes("orchestration.handoff"));
    assert.ok(itemIds.includes("execution.gate")); // Expanded dependency
  });

  it("strictly enforces token budget ceiling and reports omitted items", async () => {
    const tinyRetriever = new AdaptiveKnowledgeRetriever({ index, defaultTokenBudget: 120 });
    const pkg = await tinyRetriever.retrieve({
      taskId: "test-task-budget",
      prompt: "Handoff and gate verification",
      tokenBudget: 120,
    });

    assert.ok(pkg.totalEstimatedTokens <= 120);
    assert.ok(pkg.omittedCount > 0);
  });

  it("uses in-memory cache for repeated identical queries", async () => {
    const p1 = await retriever.retrieve({
      taskId: "cache-task",
      prompt: "Same query text",
      tokenBudget: 1000,
    });
    assert.equal(p1.cacheHit, false);

    const p2 = await retriever.retrieve({
      taskId: "cache-task",
      prompt: "Same query text",
      tokenBudget: 1000,
    });
    assert.equal(p2.cacheHit, true);
  });
});

describe("APKS: Maintenance, Validation & Restructuring", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "helix-maint-test-"));
  const repo = new KnowledgeRepository(tmpDir);
  repo.ensureDirectories();

  repo.saveDomain({
    id: "domain-a",
    name: "Domain A",
    description: "Domain A description",
    sourcePaths: ["src/a.ts"],
    dependencies: ["non-existent-domain"],
    createdAt: "2026-11-02",
    updatedAt: "2026-11-02",
  });

  repo.saveItem({
    id: "item-a",
    domainId: "domain-a",
    type: "architecture",
    title: "Item A",
    content: "Content A",
    sourcePath: "",
    status: "verified",
    sources: [{ path: "src/non-existent.ts" }],
    dependencies: [],
    createdAt: "2026-11-02",
    updatedAt: "2026-11-02",
    verifiedAt: "2026-11-02",
    contentHash: "",
  });

  it("detects broken references and missing sources in validation", () => {
    const validator = new KnowledgeValidator(repo);
    const result = validator.validate();

    assert.equal(result.valid, true); // No hard schema errors
    assert.ok(result.warnings.length > 0); // Missing source warning + unknown dependency
    assert.ok(result.missingSources.length > 0);
    assert.ok(result.brokenReferences.length > 0);
  });

  it("evaluates impact of changed files", () => {
    const analyzer = new ChangeImpactAnalyzer(repo);
    const impact = analyzer.analyzeImpact(["src/a.ts"]);

    assert.ok(impact.impactedDomains.includes("domain-a"));
  });

  it("handles low-risk vs high-risk update proposals", () => {
    const updater = new KnowledgeUpdater(repo);

    const lowRisk: KnowledgeUpdateProposal = {
      id: "prop-low-1",
      risk: "low",
      operation: "UPDATE",
      targetType: "item",
      targetId: "item-a",
      reason: "Update line citations",
      evidence: ["git diff"],
      proposedItem: {
        id: "item-a",
        domainId: "domain-a",
        type: "architecture",
        title: "Updated Item A",
        content: "Updated Content A",
        sources: [],
        dependencies: [],
        status: "verified",
        createdAt: "2026-11-02",
        updatedAt: "2026-11-02",
        verifiedAt: "2026-11-02",
        contentHash: "",
        sourcePath: "",
      },
      status: "proposed",
      createdAt: "2026-11-02",
    };

    const resLow = updater.handleUpdate(lowRisk);
    assert.equal(resLow.applied, true);

    const highRisk: KnowledgeUpdateProposal = {
      id: "prop-high-1",
      risk: "high",
      operation: "DELETE",
      targetType: "domain",
      targetId: "domain-a",
      reason: "Delete entire domain",
      evidence: [],
      status: "proposed",
      createdAt: "2026-11-02",
    };

    const resHigh = updater.handleUpdate(highRisk);
    assert.equal(resHigh.applied, false);
    assert.ok(resHigh.proposalPath);
    assert.ok(fs.existsSync(resHigh.proposalPath!));
  });

  it("evaluates domain restructuring proposals", () => {
    const restructurer = new DomainRestructurer(repo);
    const proposals = restructurer.evaluateRestructuringSignals();
    assert.ok(Array.isArray(proposals));
  });

  it("generates comprehensive health audit reports", () => {
    const auditor = new KnowledgeAuditor(repo);
    const report = auditor.audit();

    assert.equal(report.domainsCount, 1);
    assert.equal(report.itemsCount, 1);
    assert.ok(report.recommendations.length > 0);
  });
});
