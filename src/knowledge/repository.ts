// Helix Canonical Knowledge Repository (Phase 11.2)
// Manages version-controlled Markdown documents with validated YAML frontmatter.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import { countTokens } from "../measure.ts";
import { KnowledgeSecurityGuard, validateCandidateEpisodicRecord } from "./security.ts";
import type {
  AstGrepMatcherRule,
  DomainRecord,
  DomainRelationship,
  EpisodicStatus,
  KnowledgeItem,
  KnowledgeSource,
  KnowledgeType,
  Tier0DomainRoute,
  Tier2EpisodicRecord,
  VerificationStatus,
} from "./types.ts";

export interface ParsedMarkdownDoc {
  frontmatter: Record<string, unknown>;
  content: string;
}

/**
 * Pure, safe parser for YAML-style frontmatter blocks without heavy external dependencies.
 */
export function parseFrontmatter(raw: string): ParsedMarkdownDoc {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) {
    return { frontmatter: {}, content: raw.trim() };
  }

  const yamlBlock = match[1];
  const content = match[2].trim();
  const frontmatter: Record<string, unknown> = {};

  const lines = yamlBlock.split(/\r?\n/);
  let currentKey: string | null = null;
  let currentList: unknown[] | null = null;
  let currentObj: Record<string, unknown> | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    // Check list item: "  - ..." or "- ..."
    const listMatch = line.match(/^(\s*)-\s+(.*)$/);
    if (listMatch) {
      const val = listMatch[2].trim();

      if (currentKey && currentList) {
        if (val.includes(":") && !val.startsWith("http:") && !val.startsWith("https:")) {
          // Object item in list
          const [subK, ...subV] = val.split(":");
          currentObj = { [subK.trim()]: parseYamlValue(subV.join(":").trim()) };
          currentList.push(currentObj);
        } else {
          currentList.push(parseYamlValue(val));
          currentObj = null;
        }
      }
      continue;
    }

    // Check sub-key in object within list: "    key: val"
    const subKeyMatch = line.match(/^\s{3,}([a-zA-Z0-9_-]+):\s*(.*)$/);
    if (subKeyMatch && currentObj) {
      currentObj[subKeyMatch[1]] = parseYamlValue(subKeyMatch[2].trim());
      continue;
    }

    // Top-level key: "key: val"
    const kvMatch = line.match(/^([a-zA-Z0-9_-]+):\s*(.*)$/);
    if (kvMatch) {
      currentKey = kvMatch[1];
      const val = kvMatch[2].trim();

      if (val === "" || val === "[]") {
        currentList = [];
        frontmatter[currentKey] = currentList;
        currentObj = null;
      } else {
        frontmatter[currentKey] = parseYamlValue(val);
        currentList = null;
        currentObj = null;
      }
    }
  }

  return { frontmatter, content };
}

function parseYamlValue(val: string): unknown {
  if (val === "true") return true;
  if (val === "false") return false;
  if (val === "null" || val === "~" || val === "") return null;
  if (/^-?\d+$/.test(val)) return parseInt(val, 10);
  if (/^-?\d+\.\d+$/.test(val)) return parseFloat(val);
  // Strip surrounding quotes
  if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
    return val.slice(1, -1);
  }
  return val;
}

export function serializeFrontmatter(
  frontmatter: Record<string, unknown>,
  content: string,
): string {
  const lines: string[] = ["---"];

  for (const [key, value] of Object.entries(frontmatter)) {
    if (value === undefined || value === null) continue;

    if (Array.isArray(value)) {
      if (value.length === 0) {
        lines.push(`${key}: []`);
      } else {
        lines.push(`${key}:`);
        for (const item of value) {
          if (typeof item === "object" && item !== null) {
            const entries = Object.entries(item as Record<string, unknown>);
            if (entries.length > 0) {
              lines.push(`  - ${entries[0][0]}: ${formatYamlValue(entries[0][1])}`);
              for (let i = 1; i < entries.length; i++) {
                lines.push(`    ${entries[i][0]}: ${formatYamlValue(entries[i][1])}`);
              }
            }
          } else {
            lines.push(`  - ${formatYamlValue(item)}`);
          }
        }
      }
    } else if (typeof value === "object") {
      lines.push(`${key}:`);
      for (const [subK, subV] of Object.entries(value as Record<string, unknown>)) {
        lines.push(`  ${subK}: ${formatYamlValue(subV)}`);
      }
    } else {
      lines.push(`${key}: ${formatYamlValue(value)}`);
    }
  }

  lines.push("---", "", content.trim(), "");
  return lines.join("\n");
}

function formatYamlValue(val: unknown): string {
  if (typeof val === "string") {
    if (val.includes("\n") || val.includes(":") || val.includes("#") || val.includes('"')) {
      return JSON.stringify(val);
    }
    return val;
  }
  return String(val);
}

export function computeContentHash(content: string): string {
  return crypto.createHash("sha256").update(content, "utf8").digest("hex");
}

export class KnowledgeRepository {
  readonly workspaceRoot: string;
  readonly knowledgeDir: string;
  readonly security: KnowledgeSecurityGuard;

  constructor(workspaceRoot: string, knowledgeDir?: string) {
    this.workspaceRoot = path.resolve(workspaceRoot);
    this.knowledgeDir = knowledgeDir
      ? path.resolve(knowledgeDir)
      : path.join(this.workspaceRoot, ".helix", "knowledge");
    this.security = new KnowledgeSecurityGuard(this.workspaceRoot, this.knowledgeDir);
  }

  ensureDirectories(): void {
    const dirs = [
      this.knowledgeDir,
      path.join(this.knowledgeDir, "domains"),
      path.join(this.knowledgeDir, "decisions"),
      path.join(this.knowledgeDir, "workflows"),
      path.join(this.knowledgeDir, "history"),
      path.join(this.knowledgeDir, "history", "proposals"),
    ];

    for (const d of dirs) {
      if (!fs.existsSync(d)) {
        if (
          d === path.join(this.knowledgeDir, "domains") ||
          d.startsWith(path.join(this.knowledgeDir, "domains") + path.sep)
        ) {
          this.security.assertSafeKnowledgeWrite(path.join(d, ".write-guard"));
        }
        fs.mkdirSync(d, { recursive: true });
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Canonical Knowledge Items
  // ---------------------------------------------------------------------------

  loadAllItems(): KnowledgeItem[] {
    const items: KnowledgeItem[] = [];
    if (!fs.existsSync(this.knowledgeDir)) return items;

    // 1. Scan domains/<domain-id>/*.md
    const domainsDir = path.join(this.knowledgeDir, "domains");
    if (fs.existsSync(domainsDir)) {
      const domainEntries = fs.readdirSync(domainsDir, { withFileTypes: true });
      for (const entry of domainEntries) {
        if (entry.isDirectory()) {
          const domainSubdir = path.join(domainsDir, entry.name);
          const files = fs.readdirSync(domainSubdir);
          for (const file of files) {
            if (file.endsWith(".md") && file !== "domain.md") {
              const fullPath = path.join(domainSubdir, file);
              const item = this.loadItemFromFile(fullPath, entry.name);
              if (item) items.push(item);
            }
          }
        }
      }
    }

    // 2. Scan decisions/*.md and workflows/*.md
    for (const sub of ["decisions", "workflows"]) {
      const subDir = path.join(this.knowledgeDir, sub);
      if (fs.existsSync(subDir)) {
        const files = fs.readdirSync(subDir);
        for (const file of files) {
          if (file.endsWith(".md")) {
            const fullPath = path.join(subDir, file);
            const item = this.loadItemFromFile(fullPath, sub);
            if (item) items.push(item);
          }
        }
      }
    }

    return items;
  }

  loadItemFromFile(filePath: string, defaultDomain = "general"): KnowledgeItem | null {
    try {
      const raw = fs.readFileSync(filePath, "utf8");
      const hash = computeContentHash(raw);
      const { frontmatter, content } = parseFrontmatter(raw);

      const id = String(frontmatter.id || path.basename(filePath, ".md"));
      const domainId = String(frontmatter.domain || defaultDomain);
      const type = (frontmatter.type as KnowledgeType) || "architecture";
      const title = String(frontmatter.title || id);
      const status = (frontmatter.status as VerificationStatus) || "inferred";
      const createdAt = String(frontmatter.created_at || new Date().toISOString().split("T")[0]);
      const updatedAt = String(frontmatter.updated_at || createdAt);
      const verifiedAt = String(frontmatter.verified_at || updatedAt);

      const rawSources = Array.isArray(frontmatter.sources) ? frontmatter.sources : [];
      const sources: KnowledgeSource[] = rawSources.map((s: unknown) => {
        if (typeof s === "string") return { path: s };
        if (typeof s === "object" && s !== null) {
          const obj = s as Record<string, unknown>;
          return {
            path: String(obj.path || ""),
            lines: obj.lines ? String(obj.lines) : undefined,
            note: obj.note ? String(obj.note) : undefined,
            contentHash: obj.content_hash ? String(obj.content_hash) : undefined,
          };
        }
        return { path: String(s) };
      });

      const dependencies = Array.isArray(frontmatter.dependencies)
        ? frontmatter.dependencies.map(String)
        : [];

      const tags = Array.isArray(frontmatter.tags) ? frontmatter.tags.map(String) : [];
      const confidence =
        typeof frontmatter.confidence === "number" ? frontmatter.confidence : undefined;

      const relPath = path.relative(this.workspaceRoot, filePath).replace(/\\/g, "/");

      return {
        id,
        domainId,
        type,
        title,
        content,
        sourcePath: relPath,
        status,
        sources,
        dependencies,
        createdAt,
        updatedAt,
        verifiedAt,
        contentHash: hash,
        confidence,
        tags,
        metadata: frontmatter,
      };
    } catch {
      return null;
    }
  }

  saveItem(item: KnowledgeItem): string {
    let targetDir: string;
    if (item.type === "decision") {
      targetDir = path.join(this.knowledgeDir, "decisions");
    } else if (item.type === "workflow") {
      targetDir = path.join(this.knowledgeDir, "workflows");
    } else {
      targetDir = path.join(this.knowledgeDir, "domains", item.domainId);
    }

    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    const fileName = `${item.id.includes(".") ? item.id.split(".").pop() : item.id}.md`;
    const targetFile = path.join(targetDir, fileName);

    this.security.assertSafeKnowledgeWrite(targetFile);
    this.ensureDirectories();

    const frontmatter: Record<string, unknown> = {
      id: item.id,
      type: item.type,
      domain: item.domainId,
      title: item.title,
      status: item.status,
      sources: item.sources.map((s) => ({
        path: s.path,
        lines: s.lines,
        note: s.note,
      })),
      dependencies: item.dependencies,
      created_at: item.createdAt,
      updated_at: item.updatedAt,
      verified_at: item.verifiedAt,
    };

    if (item.confidence !== undefined) frontmatter.confidence = item.confidence;
    if (item.tags && item.tags.length > 0) frontmatter.tags = item.tags;

    const body = serializeFrontmatter(frontmatter, item.content);
    fs.writeFileSync(targetFile, body, "utf8");

    item.sourcePath = path.relative(this.workspaceRoot, targetFile).replace(/\\/g, "/");
    item.contentHash = computeContentHash(body);

    return targetFile;
  }

  // ---------------------------------------------------------------------------
  // Canonical Domains
  // ---------------------------------------------------------------------------

  loadAllDomains(): DomainRecord[] {
    const domains: DomainRecord[] = [];
    const domainsDir = path.join(this.knowledgeDir, "domains");
    if (!fs.existsSync(domainsDir)) return domains;

    const entries = fs.readdirSync(domainsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const domainFile = path.join(domainsDir, entry.name, "domain.md");
        if (fs.existsSync(domainFile)) {
          const dom = this.loadDomainFromFile(domainFile, entry.name);
          if (dom) domains.push(dom);
        }
      }
    }

    return domains;
  }

  loadDomainFromFile(filePath: string, fallbackId: string): DomainRecord | null {
    try {
      const raw = fs.readFileSync(filePath, "utf8");
      const { frontmatter, content } = parseFrontmatter(raw);

      const id = String(frontmatter.id || fallbackId);
      const name = String(frontmatter.name || id);
      const description = content || String(frontmatter.description || "");
      const sourcePaths = Array.isArray(frontmatter.source_paths)
        ? frontmatter.source_paths.map(String)
        : [];
      const relatedDocs = Array.isArray(frontmatter.related_docs)
        ? frontmatter.related_docs.map(String)
        : [];
      const dependencies = Array.isArray(frontmatter.dependencies)
        ? frontmatter.dependencies.map(String)
        : [];
      const keywords = Array.isArray(frontmatter.keywords) ? frontmatter.keywords.map(String) : [];
      const discoveryEvidence = Array.isArray(frontmatter.discovery_evidence)
        ? frontmatter.discovery_evidence.map(String)
        : [];
      const createdAt = String(frontmatter.created_at || new Date().toISOString().split("T")[0]);
      const updatedAt = String(frontmatter.updated_at || createdAt);

      return {
        id,
        name,
        description,
        sourcePaths,
        relatedDocs,
        dependencies,
        keywords,
        discoveryEvidence,
        createdAt,
        updatedAt,
        metadata: frontmatter,
      };
    } catch {
      return null;
    }
  }

  saveDomain(domain: DomainRecord): string {
    this.security.assertSafeKnowledgeWrite(
      path.join(this.knowledgeDir, "domains", domain.id, "domain.md"),
    );
    this.ensureDirectories();
    const domainDir = path.join(this.knowledgeDir, "domains", domain.id);
    if (!fs.existsSync(domainDir)) {
      fs.mkdirSync(domainDir, { recursive: true });
    }

    const domainFile = path.join(domainDir, "domain.md");
    this.security.assertSafeKnowledgeWrite(domainFile);

    const frontmatter: Record<string, unknown> = {
      id: domain.id,
      name: domain.name,
      source_paths: domain.sourcePaths,
      dependencies: domain.dependencies || [],
      keywords: domain.keywords || [],
      related_docs: domain.relatedDocs || [],
      discovery_evidence: domain.discoveryEvidence || [],
      created_at: domain.createdAt,
      updated_at: domain.updatedAt,
    };

    const body = serializeFrontmatter(frontmatter, domain.description);
    fs.writeFileSync(domainFile, body, "utf8");
    return domainFile;
  }

  // ---------------------------------------------------------------------------
  // Canonical Relationships
  // ---------------------------------------------------------------------------

  loadAllRelationships(): DomainRelationship[] {
    const relationships: DomainRelationship[] = [];
    const domains = this.loadAllDomains();

    for (const d of domains) {
      if (d.dependencies) {
        for (const dep of d.dependencies) {
          relationships.push({
            sourceId: d.id,
            targetId: dep,
            type: "depends_on",
          });
        }
      }
    }

    const items = this.loadAllItems();
    for (const item of items) {
      if (item.dependencies) {
        for (const dep of item.dependencies) {
          relationships.push({
            sourceId: item.id,
            targetId: dep,
            type: "depends_on",
          });
        }
      }
    }

    return relationships;
  }

  // ---------------------------------------------------------------------------
  // Project Overview
  // ---------------------------------------------------------------------------

  loadProjectOverview(): { content: string; metadata: Record<string, unknown> } | null {
    const projectFile = path.join(this.knowledgeDir, "project.md");
    if (!fs.existsSync(projectFile)) return null;

    try {
      const raw = fs.readFileSync(projectFile, "utf8");
      const { frontmatter, content } = parseFrontmatter(raw);
      return { content, metadata: frontmatter };
    } catch {
      return null;
    }
  }

  saveProjectOverview(content: string, metadata: Record<string, unknown> = {}): void {
    this.security.assertSafeKnowledgeWrite(path.join(this.knowledgeDir, "project.md"));
    this.ensureDirectories();
    const projectFile = path.join(this.knowledgeDir, "project.md");
    this.security.assertSafeKnowledgeWrite(projectFile);
    const body = serializeFrontmatter(metadata, content);
    fs.writeFileSync(projectFile, body, "utf8");
  }

  // ---------------------------------------------------------------------------
  // Changelog & Provenance History
  // ---------------------------------------------------------------------------

  appendChangelog(entry: {
    operation: string;
    targetId: string;
    reason: string;
    author: string;
    evidence?: string[];
  }): void {
    this.ensureDirectories();
    const changelogFile = path.join(this.knowledgeDir, "history", "changelog.jsonl");
    const record = {
      timestamp: new Date().toISOString(),
      ...entry,
    };
    fs.appendFileSync(changelogFile, JSON.stringify(record) + "\n", "utf8");
  }
}

interface EpisodicRow {
  id: string;
  domain_id: string;
  trigger_summary: string;
  resolution_rule: string;
  file_glob: string | null;
  ast_grep_rule_json: string | null;
  status: EpisodicStatus;
  source_task_id: string;
  times_retrieved: number;
  times_helped_pass_gate: number;
  times_present_in_failed_run: number;
  created_at: string;
}

/** SQLite-backed Tier 0/Tier 2 store. Markdown remains the canonical Tier 1 source. */
export class TieredKnowledgeRepository {
  readonly databasePath: string;
  readonly db: Database.Database;

  constructor(workspaceRoot: string = process.cwd(), databasePath?: string) {
    const knowledgeRoot = path.join(path.resolve(workspaceRoot), ".helix", "knowledge");
    fs.mkdirSync(knowledgeRoot, { recursive: true });
    this.databasePath = databasePath ?? path.join(knowledgeRoot, "helix-memory.db");
    fs.mkdirSync(path.dirname(this.databasePath), { recursive: true });
    this.db = new Database(this.databasePath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    sqliteVec.load(this.db);
    this.initializeSchema();
  }

  private initializeSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS canonical_skills (
        domain_id TEXT PRIMARY KEY,
        description TEXT NOT NULL,
        path_globs_json TEXT NOT NULL,
        body_markdown TEXT NOT NULL,
        token_cost INTEGER NOT NULL CHECK (token_cost <= 600),
        content_sha256 TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS episodic_quarantine (
        id TEXT PRIMARY KEY,
        domain_id TEXT NOT NULL,
        trigger_summary TEXT NOT NULL,
        resolution_rule TEXT NOT NULL,
        file_glob TEXT,
        ast_grep_rule_json TEXT,
        status TEXT NOT NULL CHECK (status IN ('QUARANTINED','VALIDATED','PROMOTED','PRUNED')),
        source_task_id TEXT NOT NULL,
        times_retrieved INTEGER NOT NULL DEFAULT 0,
        times_helped_pass_gate INTEGER NOT NULL DEFAULT 0,
        times_present_in_failed_run INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );

      CREATE VIRTUAL TABLE IF NOT EXISTS episodic_fts USING fts5(
        id UNINDEXED, domain_id, trigger_summary, resolution_rule,
        content='episodic_quarantine', content_rowid='rowid',
        tokenize='porter unicode61'
      );

      CREATE TRIGGER IF NOT EXISTS episodic_quarantine_ai
      AFTER INSERT ON episodic_quarantine BEGIN
        INSERT INTO episodic_fts(rowid, id, domain_id, trigger_summary, resolution_rule)
        VALUES (new.rowid, new.id, new.domain_id, new.trigger_summary, new.resolution_rule);
      END;
      CREATE TRIGGER IF NOT EXISTS episodic_quarantine_au
      AFTER UPDATE ON episodic_quarantine BEGIN
        INSERT INTO episodic_fts(episodic_fts, rowid, id, domain_id, trigger_summary, resolution_rule)
        VALUES ('delete', old.rowid, old.id, old.domain_id, old.trigger_summary, old.resolution_rule);
        INSERT INTO episodic_fts(rowid, id, domain_id, trigger_summary, resolution_rule)
        VALUES (new.rowid, new.id, new.domain_id, new.trigger_summary, new.resolution_rule);
      END;
      CREATE TRIGGER IF NOT EXISTS episodic_quarantine_ad
      AFTER DELETE ON episodic_quarantine BEGIN
        INSERT INTO episodic_fts(episodic_fts, rowid, id, domain_id, trigger_summary, resolution_rule)
        VALUES ('delete', old.rowid, old.id, old.domain_id, old.trigger_summary, old.resolution_rule);
      END;

      CREATE VIRTUAL TABLE IF NOT EXISTS episodic_vec USING vec0(
        episodic_id TEXT PRIMARY KEY,
        domain_partition TEXT PARTITION KEY,
        embedding float[384] distance_metric=cosine
      );
    `);
  }

  upsertCanonicalSkill(route: Tier0DomainRoute, bodyMarkdown: string): void {
    const measuredTokens = countTokens(bodyMarkdown);
    if (route.description.length > 120) {
      throw new Error(`Canonical skill ${route.domainId} description exceeds 120 characters`);
    }
    if (measuredTokens > 600 || route.skillTokenCost > 600) {
      throw new Error(`Canonical skill ${route.domainId} exceeds the 600-token limit`);
    }
    const contentSha256 = computeContentHash(bodyMarkdown);
    if (route.skillTokenCost !== measuredTokens || route.canonicalHash !== contentSha256) {
      throw new Error(
        `Canonical skill ${route.domainId} route metadata does not match its content`,
      );
    }
    this.db
      .prepare(
        `INSERT INTO canonical_skills
        (domain_id, description, path_globs_json, body_markdown, token_cost, content_sha256, updated_at)
        VALUES (@domainId, @description, @pathGlobs, @bodyMarkdown, @tokenCost, @hash, @updatedAt)
        ON CONFLICT(domain_id) DO UPDATE SET
          description=excluded.description, path_globs_json=excluded.path_globs_json,
          body_markdown=excluded.body_markdown, token_cost=excluded.token_cost,
          content_sha256=excluded.content_sha256, updated_at=excluded.updated_at`,
      )
      .run({
        domainId: route.domainId,
        description: route.description,
        pathGlobs: JSON.stringify(route.pathGlobs),
        bodyMarkdown,
        tokenCost: measuredTokens,
        hash: contentSha256,
        updatedAt: new Date().toISOString(),
      });
  }

  getCanonicalSkill(domainId: string): { route: Tier0DomainRoute; bodyMarkdown: string } | null {
    const row = this.db
      .prepare(
        `SELECT domain_id, description, path_globs_json, body_markdown, token_cost, content_sha256
        FROM canonical_skills WHERE domain_id = ?`,
      )
      .get(domainId) as
      | {
          domain_id: string;
          description: string;
          path_globs_json: string;
          body_markdown: string;
          token_cost: number;
          content_sha256: string;
        }
      | undefined;
    if (!row) return null;
    return {
      route: {
        domainId: row.domain_id,
        description: row.description,
        pathGlobs: JSON.parse(row.path_globs_json) as string[],
        skillTokenCost: row.token_cost,
        canonicalHash: row.content_sha256,
      },
      bodyMarkdown: row.body_markdown,
    };
  }

  insertEpisodicRecord(record: Tier2EpisodicRecord): Tier2EpisodicRecord {
    const clean = validateCandidateEpisodicRecord(record);
    const row = this.db.prepare(`INSERT INTO episodic_quarantine
      (id, domain_id, trigger_summary, resolution_rule, file_glob, ast_grep_rule_json, status,
       source_task_id, times_retrieved, times_helped_pass_gate, times_present_in_failed_run, created_at)
      VALUES (@id, @domainId, @trigger, @resolution, @fileGlob, @astRule, @status,
       @sourceTaskId, @retrieved, @helped, @failed, @createdAt)
      ON CONFLICT(id) DO UPDATE SET
       domain_id=excluded.domain_id, trigger_summary=excluded.trigger_summary,
       resolution_rule=excluded.resolution_rule, file_glob=excluded.file_glob,
       ast_grep_rule_json=excluded.ast_grep_rule_json, status=excluded.status,
       source_task_id=excluded.source_task_id, times_retrieved=excluded.times_retrieved,
       times_helped_pass_gate=excluded.times_helped_pass_gate,
       times_present_in_failed_run=excluded.times_present_in_failed_run, created_at=excluded.created_at`);
    const persist = this.db.transaction(() => {
      row.run({
        id: clean.id,
        domainId: clean.domainId,
        trigger: clean.triggerSummary,
        resolution: clean.resolutionRule,
        fileGlob: clean.fileGlob ?? null,
        astRule: clean.astGrepRule ? JSON.stringify(clean.astGrepRule) : null,
        status: clean.status,
        sourceTaskId: clean.sourceTaskId,
        retrieved: clean.timesRetrieved,
        helped: clean.timesHelpedPassGate,
        failed: clean.timesPresentInFailedRun,
        createdAt: clean.createdAtIso,
      });
      this.db.prepare("DELETE FROM episodic_vec WHERE episodic_id = ?").run(clean.id);
      this.db
        .prepare(
          "INSERT INTO episodic_vec(episodic_id, domain_partition, embedding) VALUES (?, ?, ?)",
        )
        .run(
          clean.id,
          clean.domainId,
          new Float32Array(
            createLocalEmbedding(`${clean.triggerSummary}\n${clean.resolutionRule}`),
          ),
        );
    });
    persist();
    return clean;
  }

  getEpisodicRecord(id: string): Tier2EpisodicRecord | null {
    const row = this.db.prepare("SELECT * FROM episodic_quarantine WHERE id = ?").get(id) as
      EpisodicRow | undefined;
    return row ? mapEpisodicRow(row) : null;
  }

  listEpisodicRecords(status?: EpisodicStatus): Tier2EpisodicRecord[] {
    const rows = status
      ? (this.db
          .prepare("SELECT * FROM episodic_quarantine WHERE status = ? ORDER BY created_at, id")
          .all(status) as EpisodicRow[])
      : (this.db
          .prepare("SELECT * FROM episodic_quarantine ORDER BY created_at, id")
          .all() as EpisodicRow[]);
    return rows.map(mapEpisodicRow);
  }

  updateEpisodicStatus(id: string, status: EpisodicStatus): void {
    this.db.prepare("UPDATE episodic_quarantine SET status = ? WHERE id = ?").run(status, id);
  }

  incrementEpisodicTelemetry(id: string, outcome: "retrieved" | "helped" | "failed"): void {
    const column =
      outcome === "retrieved"
        ? "times_retrieved"
        : outcome === "helped"
          ? "times_helped_pass_gate"
          : "times_present_in_failed_run";
    this.db
      .prepare(`UPDATE episodic_quarantine SET ${column} = ${column} + 1 WHERE id = ?`)
      .run(id);
  }

  searchEpisodicFts(query: string, limit = 20): Array<{ id: string; rank: number }> {
    if (!query.trim()) return [];
    const terms = query.match(/[\p{L}\p{N}_]+/gu) ?? [];
    if (terms.length === 0) return [];
    const expression = terms.map((term) => `"${term.replace(/"/g, '""')}"`).join(" OR ");
    return this.db
      .prepare(
        `SELECT q.id AS id, bm25(episodic_fts) AS rank
        FROM episodic_fts JOIN episodic_quarantine q ON q.rowid = episodic_fts.rowid
        WHERE episodic_fts MATCH ? AND q.status IN ('VALIDATED','PROMOTED')
        ORDER BY rank LIMIT ?`,
      )
      .all(expression, limit) as Array<{ id: string; rank: number }>;
  }

  searchEpisodicVector(query: string, limit = 20): Array<{ id: string; distance: number }> {
    const vector = new Float32Array(createLocalEmbedding(query));
    return this.db
      .prepare(
        `SELECT v.episodic_id AS id, v.distance AS distance
        FROM episodic_vec v JOIN episodic_quarantine q ON q.id = v.episodic_id
        WHERE v.embedding MATCH ? AND k = ? AND q.status IN ('VALIDATED','PROMOTED')
        ORDER BY v.distance`,
      )
      .all(vector, limit) as Array<{ id: string; distance: number }>;
  }

  close(): void {
    this.db.close();
  }
}

function mapEpisodicRow(row: EpisodicRow): Tier2EpisodicRecord {
  return {
    id: row.id,
    domainId: row.domain_id,
    triggerSummary: row.trigger_summary,
    resolutionRule: row.resolution_rule,
    ...(row.file_glob ? { fileGlob: row.file_glob } : {}),
    ...(row.ast_grep_rule_json
      ? { astGrepRule: JSON.parse(row.ast_grep_rule_json) as AstGrepMatcherRule }
      : {}),
    status: row.status,
    sourceTaskId: row.source_task_id,
    timesRetrieved: row.times_retrieved,
    timesHelpedPassGate: row.times_helped_pass_gate,
    timesPresentInFailedRun: row.times_present_in_failed_run,
    createdAtIso: row.created_at,
  };
}

/** Deterministic, offline trigram feature hashing into a normalized 384-vector. */
export function createLocalEmbedding(text: string): number[] {
  const vector = new Float32Array(384);
  const normalized = `  ${text.toLocaleLowerCase("en-US").replace(/\s+/g, " ")}  `;
  for (let i = 0; i + 3 <= normalized.length; i++) {
    const gram = normalized.slice(i, i + 3);
    const digest = crypto.createHash("sha256").update(gram, "utf8").digest();
    const slot = digest.readUInt32LE(0) % vector.length;
    vector[slot] += (digest[4] & 1) === 0 ? 1 : -1;
  }
  let magnitude = 0;
  for (const value of vector) magnitude += value * value;
  magnitude = Math.sqrt(magnitude);
  if (magnitude > 0) {
    for (let i = 0; i < vector.length; i++) vector[i] /= magnitude;
  }
  return Array.from(vector);
}
