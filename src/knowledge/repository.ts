// Helix Canonical Knowledge Repository (Phase 11.2)
// Manages version-controlled Markdown documents with validated YAML frontmatter.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { KnowledgeSecurityGuard } from "./security.ts";
import type {
  DomainRecord,
  DomainRelationship,
  KnowledgeItem,
  KnowledgeSource,
  KnowledgeType,
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
    this.ensureDirectories();

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
