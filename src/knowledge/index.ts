// Helix SQLite Knowledge Index & FTS5 Full-Text Retrieval (Phase 11.3)
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { KnowledgeRepository } from "./repository.ts";
import type {
  DomainRecord,
  DomainRelationship,
  KnowledgeItem,
  KnowledgeType,
  VerificationStatus,
} from "./types.ts";

export interface FtsSearchResult {
  id: string;
  domainId: string;
  type: KnowledgeType;
  title: string;
  snippet: string;
  bm25Score: number;
  sourcePath: string;
  status: VerificationStatus;
}

export class SQLiteKnowledgeIndex {
  private readonly dbPath: string;
  private db: DatabaseSync | null = null;

  constructor(dbPath: string) {
    this.dbPath = path.resolve(dbPath);
  }

  static defaultPath(workspaceRoot: string): string {
    return path.join(path.resolve(workspaceRoot), ".helix", "cache", "knowledge.sqlite");
  }

  getDb(): DatabaseSync {
    if (!this.db) {
      const parentDir = path.dirname(this.dbPath);
      if (!fs.existsSync(parentDir)) {
        fs.mkdirSync(parentDir, { recursive: true });
      }

      this.db = new DatabaseSync(this.dbPath);
      this.initPragmas();
      this.ensureSchema();
    }
    return this.db;
  }

  close(): void {
    if (this.db) {
      try {
        this.db.close();
      } catch {
        // Ignored
      }
      this.db = null;
    }
  }

  private initPragmas(): void {
    if (!this.db) return;
    this.db.exec("PRAGMA busy_timeout = 5000;");
    this.db.exec("PRAGMA foreign_keys = ON;");
    try {
      this.db.exec("PRAGMA journal_mode = WAL;");
    } catch {
      // In-memory or restricted filesystem fallback
    }
  }

  private ensureSchema(): void {
    if (!this.db) return;

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS domains (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL,
        metadata TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS knowledge_items (
        id TEXT PRIMARY KEY,
        domain_id TEXT NOT NULL,
        type TEXT NOT NULL,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        source_path TEXT NOT NULL,
        status TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        metadata TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        verified_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_ki_domain ON knowledge_items(domain_id);
      CREATE INDEX IF NOT EXISTS idx_ki_status ON knowledge_items(status);
      CREATE INDEX IF NOT EXISTS idx_ki_type ON knowledge_items(type);

      CREATE TABLE IF NOT EXISTS relationships (
        source_id TEXT NOT NULL,
        target_id TEXT NOT NULL,
        relationship_type TEXT NOT NULL,
        metadata TEXT NOT NULL,
        PRIMARY KEY (source_id, target_id, relationship_type)
      );

      CREATE INDEX IF NOT EXISTS idx_rel_source ON relationships(source_id);
      CREATE INDEX IF NOT EXISTS idx_rel_target ON relationships(target_id);

      CREATE TABLE IF NOT EXISTS sources (
        id TEXT PRIMARY KEY,
        path TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        source_type TEXT NOT NULL,
        last_indexed_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS retrieval_events (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        knowledge_item_id TEXT NOT NULL,
        retrieval_reason TEXT NOT NULL,
        ranking_score REAL NOT NULL,
        token_estimate INTEGER NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_retrieval_task ON retrieval_events(task_id);

      CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_fts USING fts5(
        id UNINDEXED,
        domain_id,
        title,
        content,
        keywords,
        tokenize = 'porter unicode61'
      );
    `);

    // Record schema version
    const insertMeta = this.db.prepare(
      "INSERT OR REPLACE INTO schema_metadata (key, value) VALUES ('version', '1')",
    );
    insertMeta.run();
  }

  // ---------------------------------------------------------------------------
  // Indexing Operations
  // ---------------------------------------------------------------------------

  /**
   * Rebuilds the entire index from scratch using canonical files in the repository.
   */
  rebuildIndex(repository: KnowledgeRepository): {
    domainsIndexed: number;
    itemsIndexed: number;
    relationshipsIndexed: number;
  } {
    const db = this.getDb();

    db.exec(`
      DELETE FROM retrieval_events;
      DELETE FROM relationships;
      DELETE FROM knowledge_fts;
      DELETE FROM knowledge_items;
      DELETE FROM domains;
      DELETE FROM sources;
    `);

    return this.incrementalIndex(repository, true);
  }

  /**
   * Incrementally updates the index by comparing file content hashes against stored hashes.
   */
  incrementalIndex(
    repository: KnowledgeRepository,
    forceRebuild = false,
  ): {
    domainsIndexed: number;
    itemsIndexed: number;
    relationshipsIndexed: number;
  } {
    const db = this.getDb();
    const domains = repository.loadAllDomains();
    const items = repository.loadAllItems();
    const relationships = repository.loadAllRelationships();

    // 1. Sync Domains
    const upsertDomain = db.prepare(`
      INSERT OR REPLACE INTO domains (id, name, description, metadata, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    for (const d of domains) {
      upsertDomain.run(
        d.id,
        d.name,
        d.description,
        JSON.stringify(d.metadata || {}),
        d.createdAt,
        d.updatedAt,
      );
    }

    // 2. Identify existing items and hashes
    const existingRows = db.prepare("SELECT id, content_hash FROM knowledge_items").all() as Array<{
      id: string;
      content_hash: string;
    }>;
    const existingMap = new Map<string, string>();
    for (const r of existingRows) {
      existingMap.set(r.id, r.content_hash);
    }

    const currentItemIds = new Set(items.map((i) => i.id));

    // Remove deleted items
    const deleteItem = db.prepare("DELETE FROM knowledge_items WHERE id = ?");
    const deleteFts = db.prepare("DELETE FROM knowledge_fts WHERE id = ?");

    for (const [id] of existingMap) {
      if (!currentItemIds.has(id)) {
        deleteItem.run(id);
        deleteFts.run(id);
      }
    }

    // Upsert new or changed items
    const insertItem = db.prepare(`
      INSERT OR REPLACE INTO knowledge_items (
        id, domain_id, type, title, content, source_path, status, content_hash, metadata, created_at, updated_at, verified_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertFts = db.prepare(`
      INSERT INTO knowledge_fts (id, domain_id, title, content, keywords)
      VALUES (?, ?, ?, ?, ?)
    `);

    let itemsIndexed = 0;

    for (const item of items) {
      const prevHash = existingMap.get(item.id);
      if (!forceRebuild && prevHash === item.contentHash) {
        // Unchanged
        continue;
      }

      // If updating, clean FTS entry first
      if (prevHash) {
        deleteFts.run(item.id);
      }

      insertItem.run(
        item.id,
        item.domainId,
        item.type,
        item.title,
        item.content,
        item.sourcePath,
        item.status,
        item.contentHash,
        JSON.stringify({
          sources: item.sources,
          dependencies: item.dependencies,
          tags: item.tags,
          confidence: item.confidence,
          metadata: item.metadata,
        }),
        item.createdAt,
        item.updatedAt,
        item.verifiedAt,
      );

      const keywords = (item.tags || []).concat(item.dependencies).join(" ");
      insertFts.run(item.id, item.domainId, item.title, item.content, keywords);
      itemsIndexed++;
    }

    // 3. Sync Relationships
    db.exec("DELETE FROM relationships");
    const insertRel = db.prepare(`
      INSERT OR REPLACE INTO relationships (source_id, target_id, relationship_type, metadata)
      VALUES (?, ?, ?, ?)
    `);

    for (const rel of relationships) {
      insertRel.run(rel.sourceId, rel.targetId, rel.type, JSON.stringify(rel.metadata || {}));
    }

    return {
      domainsIndexed: domains.length,
      itemsIndexed: itemsIndexed,
      relationshipsIndexed: relationships.length,
    };
  }

  // ---------------------------------------------------------------------------
  // FTS5 Full-Text Retrieval
  // ---------------------------------------------------------------------------

  /**
   * Search knowledge base using SQLite FTS5 BM25 ranking.
   */
  searchFts(query: string, limit = 10): FtsSearchResult[] {
    const db = this.getDb();
    const sanitized = this.sanitizeQuery(query);
    if (!sanitized) return [];

    try {
      const stmt = db.prepare(`
        SELECT
          f.id,
          k.domain_id AS domainId,
          k.type,
          k.title,
          snippet(knowledge_fts, -1, '<b>', '</b>', '...', 20) AS snippet,
          bm25(knowledge_fts, 5.0, 5.0, 1.0, 3.0) AS bm25Score,
          k.source_path AS sourcePath,
          k.status
        FROM knowledge_fts f
        JOIN knowledge_items k ON k.id = f.id
        WHERE knowledge_fts MATCH ?
        ORDER BY bm25Score ASC
        LIMIT ?
      `);

      const rows = stmt.all(sanitized, limit) as unknown as FtsSearchResult[];
      return rows;
    } catch {
      // In case of syntax error in match query, fall back to simple tokenized query
      try {
        const words = sanitized
          .split(/\s+/)
          .filter((w) => w.length > 2)
          .map((w) => `"${w}"*`)
          .join(" OR ");
        if (!words) return [];

        const stmt = db.prepare(`
          SELECT
            f.id,
            k.domain_id AS domainId,
            k.type,
            k.title,
            snippet(knowledge_fts, -1, '<b>', '</b>', '...', 20) AS snippet,
            bm25(knowledge_fts, 5.0, 5.0, 1.0, 3.0) AS bm25Score,
            k.source_path AS sourcePath,
            k.status
          FROM knowledge_fts f
          JOIN knowledge_items k ON k.id = f.id
          WHERE knowledge_fts MATCH ?
          ORDER BY bm25Score ASC
          LIMIT ?
        `);

        return stmt.all(words, limit) as unknown as FtsSearchResult[];
      } catch {
        return [];
      }
    }
  }

  private sanitizeQuery(raw: string): string {
    const cleaned = raw
      .replace(/['"*/()^~:]/g, " ")
      .trim()
      .split(/\s+/)
      .filter((w) => w.length > 1)
      .join(" OR ");
    return cleaned;
  }

  // ---------------------------------------------------------------------------
  // Item & Relationship Lookups
  // ---------------------------------------------------------------------------

  getItem(id: string): KnowledgeItem | null {
    const db = this.getDb();
    const row = db.prepare("SELECT * FROM knowledge_items WHERE id = ?").get(id) as
      Record<string, unknown> | undefined;

    if (!row) return null;

    const meta = JSON.parse(String(row.metadata || "{}"));
    return {
      id: String(row.id),
      domainId: String(row.domain_id),
      type: row.type as KnowledgeType,
      title: String(row.title),
      content: String(row.content),
      sourcePath: String(row.source_path),
      status: row.status as VerificationStatus,
      sources: (meta.sources as KnowledgeItem["sources"]) || [],
      dependencies: (meta.dependencies as string[]) || [],
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
      verifiedAt: String(row.verified_at),
      contentHash: String(row.content_hash),
      confidence: meta.confidence as number | undefined,
      tags: meta.tags as string[] | undefined,
      metadata: meta,
    };
  }

  getAllItems(): KnowledgeItem[] {
    const db = this.getDb();
    const rows = db.prepare("SELECT * FROM knowledge_items").all() as Array<
      Record<string, unknown>
    >;

    return rows.map((row) => {
      const meta = JSON.parse(String(row.metadata || "{}"));
      return {
        id: String(row.id),
        domainId: String(row.domain_id),
        type: row.type as KnowledgeType,
        title: String(row.title),
        content: String(row.content),
        sourcePath: String(row.source_path),
        status: row.status as VerificationStatus,
        sources: (meta.sources as KnowledgeItem["sources"]) || [],
        dependencies: (meta.dependencies as string[]) || [],
        createdAt: String(row.created_at),
        updatedAt: String(row.updated_at),
        verifiedAt: String(row.verified_at),
        contentHash: String(row.content_hash),
        confidence: meta.confidence as number | undefined,
        tags: meta.tags as string[] | undefined,
        metadata: meta,
      };
    });
  }

  getDomain(id: string): DomainRecord | null {
    const db = this.getDb();
    const row = db.prepare("SELECT * FROM domains WHERE id = ?").get(id) as
      Record<string, unknown> | undefined;

    if (!row) return null;
    const meta = JSON.parse(String(row.metadata || "{}"));
    return {
      id: String(row.id),
      name: String(row.name),
      description: String(row.description),
      sourcePaths: (meta.source_paths as string[]) || [],
      relatedDocs: (meta.related_docs as string[]) || [],
      dependencies: (meta.dependencies as string[]) || [],
      keywords: (meta.keywords as string[]) || [],
      discoveryEvidence: (meta.discovery_evidence as string[]) || [],
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
      metadata: meta,
    };
  }

  getAllDomains(): DomainRecord[] {
    const db = this.getDb();
    const rows = db.prepare("SELECT * FROM domains").all() as Array<Record<string, unknown>>;

    return rows.map((row) => {
      const meta = JSON.parse(String(row.metadata || "{}"));
      return {
        id: String(row.id),
        name: String(row.name),
        description: String(row.description),
        sourcePaths: (meta.source_paths as string[]) || [],
        relatedDocs: (meta.related_docs as string[]) || [],
        dependencies: (meta.dependencies as string[]) || [],
        keywords: (meta.keywords as string[]) || [],
        discoveryEvidence: (meta.discovery_evidence as string[]) || [],
        createdAt: String(row.created_at),
        updatedAt: String(row.updated_at),
        metadata: meta,
      };
    });
  }

  getOutgoingRelationships(sourceId: string): DomainRelationship[] {
    const db = this.getDb();
    const rows = db
      .prepare(
        "SELECT source_id, target_id, relationship_type, metadata FROM relationships WHERE source_id = ?",
      )
      .all(sourceId) as Array<{
      source_id: string;
      target_id: string;
      relationship_type: string;
      metadata: string;
    }>;

    return rows.map((r) => ({
      sourceId: r.source_id,
      targetId: r.target_id,
      type: r.relationship_type as DomainRelationship["type"],
      metadata: JSON.parse(r.metadata || "{}"),
    }));
  }

  logRetrievalEvent(
    taskId: string,
    knowledgeItemId: string,
    reason: string,
    score: number,
    tokenEstimate: number,
  ): void {
    const db = this.getDb();
    const id = `rev-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const stmt = db.prepare(`
      INSERT INTO retrieval_events (id, task_id, knowledge_item_id, retrieval_reason, ranking_score, token_estimate, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(id, taskId, knowledgeItemId, reason, score, tokenEstimate, new Date().toISOString());
  }
}
