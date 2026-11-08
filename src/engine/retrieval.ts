// Helix Repository Retrieval Mechanism (Phase 05 - Component 8)
import fs from "node:fs";
import path from "node:path";
import { countTokens } from "../measure.ts";
import { Lang, parse } from "@ast-grep/napi";
import {
  compileTier0DomainRoutes,
  matchDomainsForFilePath,
  syncCanonicalSkillStore,
} from "../knowledge/discovery.ts";
import { retrieveEpisodicRecords } from "../knowledge/retriever.ts";
import { TieredKnowledgeRepository } from "../knowledge/repository.ts";
import type { Tier0DomainRoute, Tier2EpisodicRecord } from "../knowledge/types.ts";
import { resolveSafePath } from "./tools.ts";
import type { CitedExcerpt, RepositoryRetriever, SymbolReference } from "./types.ts";

export type RetrievalOptions = {
  workspaceRoot: string;
  graphifyDir?: string;
  forbiddenPaths?: string[];
  maxExcerptLines?: number;
};

export type GraphNode = {
  id: string;
  label: string;
  norm_label?: string;
  source_file?: string;
  source_location?: string;
  file_type?: string;
  _callable?: boolean;
  _callable_class?: boolean;
  _origin?: string;
};

export type GraphData = {
  nodes?: GraphNode[];
};

export class DefaultRepositoryRetriever implements RepositoryRetriever {
  private readonly workspaceRoot: string;
  private readonly graphifyDir: string;
  private readonly forbiddenPaths: string[];
  private readonly maxExcerptLines: number;
  private cachedGraph: GraphData | null = null;
  private graphLoadAttempted = false;

  /** Delegate all Helix v2 knowledge tiers to the canonical knowledge modules. */
  async retrieveKnowledge(
    query: string,
    targetFiles: readonly string[] = [],
    sourceByPath: Readonly<Record<string, string>> = {},
  ): Promise<{
    tier0: readonly Tier0DomainRoute[];
    tier1: readonly { domainId: string; bodyMarkdown: string }[];
    tier2: readonly Tier2EpisodicRecord[];
  }> {
    const routes = compileTier0DomainRoutes(this.workspaceRoot);
    const selected = new Map<string, Tier0DomainRoute>();
    for (const filePath of targetFiles) {
      for (const route of matchDomainsForFilePath(filePath, this.workspaceRoot))
        selected.set(route.domainId, route);
    }
    const queryLower = query.toLowerCase();
    for (const route of routes) {
      if (
        `${route.domainId} ${route.description}`
          .toLowerCase()
          .split(/[^a-z0-9-]+/)
          .some((word) => word.length > 2 && queryLower.includes(word))
      ) {
        selected.set(route.domainId, route);
      }
    }

    const repository = new TieredKnowledgeRepository(this.workspaceRoot);
    try {
      syncCanonicalSkillStore(routes, repository, this.workspaceRoot);
      const tier1 = [...selected.keys()].flatMap((domainId) => {
        const skill = repository.getCanonicalSkill(domainId);
        return skill ? [{ domainId, bodyMarkdown: skill.bodyMarkdown }] : [];
      });
      const tier2ById = new Map<string, Tier2EpisodicRecord>();
      const searches = targetFiles.length > 0 ? targetFiles : [undefined];
      for (const filePath of searches) {
        const records = retrieveEpisodicRecords(repository, query, {
          filePath,
          sourceCode: filePath ? sourceByPath[filePath] : undefined,
        });
        for (const record of records) tier2ById.set(record.id, record);
      }
      const tier2: Tier2EpisodicRecord[] = [];
      let usedTokens = 0;
      for (const record of tier2ById.values()) {
        const tokens = countTokens(
          `- ${record.id} (${record.domainId}): ${record.triggerSummary}\n  ${record.resolutionRule}`,
        );
        if (usedTokens + tokens > 250) continue;
        tier2.push(record);
        usedTokens += tokens;
        if (tier2.length === 3) break;
      }
      return { tier0: routes, tier1, tier2 };
    } finally {
      repository.close();
    }
  }

  constructor(options: RetrievalOptions) {
    this.workspaceRoot = path.resolve(options.workspaceRoot);
    this.graphifyDir = options.graphifyDir
      ? path.resolve(options.graphifyDir)
      : path.join(this.workspaceRoot, "graphify-out");
    this.forbiddenPaths = options.forbiddenPaths || [];
    this.maxExcerptLines = options.maxExcerptLines || 60;
  }

  /**
   * Loads graphify-out/graph.json if available.
   */
  private loadGraph(): GraphData | null {
    if (this.graphLoadAttempted) {
      return this.cachedGraph;
    }
    this.graphLoadAttempted = true;

    const graphFile = path.join(this.graphifyDir, "graph.json");
    if (!fs.existsSync(graphFile)) {
      return null;
    }

    try {
      const raw = fs.readFileSync(graphFile, "utf8");
      this.cachedGraph = JSON.parse(raw) as GraphData;
      return this.cachedGraph;
    } catch {
      return null;
    }
  }

  private parseLineNumber(location?: string): number {
    if (!location) return 1;
    const match = location.match(/L(\d+)/i);
    return match ? parseInt(match[1], 10) : 1;
  }

  private inferKind(node: GraphNode): SymbolReference["kind"] {
    if (node._callable_class) return "class";
    if (node._callable) return "function";
    const label = node.label || "";
    if (label.endsWith("Props") || label.endsWith("State") || label.endsWith("Config")) {
      return "interface";
    }
    if (/^[A-Z]/.test(label)) return "type";
    return "function";
  }

  /**
   * Query semantic graph (Graphify) or fallback structural outline.
   */
  async queryStructure(query: string): Promise<SymbolReference[]> {
    const qLower = query.toLowerCase().trim();
    if (!qLower) return [];

    const graph = this.loadGraph();
    const results: SymbolReference[] = [];
    const seen = new Set<string>();

    // 1. Tier 1: Semantic Graph Retrieval (Graphify)
    if (graph && Array.isArray(graph.nodes)) {
      for (const node of graph.nodes) {
        if (!node.label || !node.source_file) continue;

        const labelLower = node.label.toLowerCase();
        const normLower = (node.norm_label || "").toLowerCase();
        const fileLower = node.source_file.toLowerCase();

        const isMatch =
          labelLower === qLower ||
          normLower === qLower ||
          labelLower.includes(qLower) ||
          qLower.includes(labelLower) ||
          fileLower.includes(qLower);

        if (isMatch) {
          const key = `${node.source_file}:${node.label}`;
          if (!seen.has(key)) {
            seen.add(key);
            results.push({
              name: node.label,
              kind: this.inferKind(node),
              filePath: node.source_file,
              line: this.parseLineNumber(node.source_location),
            });
          }
        }
      }
    }

    // 2. Tier 2: Structural Outline Fallback if Graphify yielded few results or is absent
    if (results.length < 5) {
      const scanDirs = ["src", "cli"].filter((d) =>
        fs.existsSync(path.join(this.workspaceRoot, d)),
      );

      for (const dir of scanDirs) {
        this.scanDirectoryForSymbols(path.join(this.workspaceRoot, dir), qLower, results, seen);
      }
    }

    // Sort: Exact match first, then prefix, then shortest name
    results.sort((a, b) => {
      const aLower = a.name.toLowerCase();
      const bLower = b.name.toLowerCase();
      if (aLower === qLower && bLower !== qLower) return -1;
      if (bLower === qLower && aLower !== qLower) return 1;
      if (aLower.startsWith(qLower) && !bLower.startsWith(qLower)) return -1;
      if (bLower.startsWith(qLower) && !aLower.startsWith(qLower)) return 1;
      return a.name.length - b.name.length;
    });

    return results.slice(0, 50);
  }

  private scanDirectoryForSymbols(
    dir: string,
    queryLower: string,
    results: SymbolReference[],
    seen: Set<string>,
  ): void {
    if (!fs.existsSync(dir)) return;

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry.name.startsWith(".") || entry.name === "node_modules" || entry.name === "dist") {
        continue;
      }

      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        this.scanDirectoryForSymbols(fullPath, queryLower, results, seen);
      } else if (entry.isFile() && /\.(?:[cm]?ts|tsx|[cm]?js|jsx)$/i.test(entry.name)) {
        const relPath = path.relative(this.workspaceRoot, fullPath);
        this.extractSymbolsFromFile(fullPath, relPath, queryLower, results, seen);
      }
    }
  }

  private extractSymbolsFromFile(
    fullPath: string,
    relPath: string,
    queryLower: string,
    results: SymbolReference[],
    seen: Set<string>,
  ): void {
    let content: string;
    try {
      content = fs.readFileSync(fullPath, "utf8");
    } catch {
      return;
    }

    const extension = path.extname(fullPath).toLowerCase();
    const lang =
      extension === ".tsx" || extension === ".jsx"
        ? Lang.Tsx
        : [".js", ".mjs", ".cjs"].includes(extension)
          ? Lang.JavaScript
          : Lang.TypeScript;
    let root;
    try {
      root = parse(lang, content).root();
    } catch {
      return;
    }
    const add = (name: string | undefined, kind: SymbolReference["kind"], line: number) => {
      if (!name) return;
      const nameLower = name.toLowerCase();
      if (!nameLower.includes(queryLower) && !queryLower.includes(nameLower)) return;
      const key = `${relPath}:${name}`;
      if (!seen.has(key)) {
        seen.add(key);
        results.push({ name, kind, filePath: relPath, line });
      }
    };
    const kindMap = new Map<string, SymbolReference["kind"]>([
      ["function_declaration", "function"],
      ["class_declaration", "class"],
      ["interface_declaration", "interface"],
      ["type_alias_declaration", "type"],
      ["enum_declaration", "type"],
    ]);
    const stack = [root];
    while (stack.length) {
      const node = stack.pop();
      if (!node) continue;
      const nodeKind = String(node.kind());
      const kind = kindMap.get(nodeKind);
      if (kind) add(node.field("name")?.text(), kind, node.range().start.line + 1);
      if (nodeKind === "variable_declarator")
        add(node.field("name")?.text(), "variable", node.range().start.line + 1);
      stack.push(...node.children());
    }
  }

  /**
   * Retrieve narrow cited line excerpts (strictly avoiding whole-file dumps >200 lines).
   */
  async fetchExcerpts(
    citations: Array<{ path: string; start: number; end: number; reason?: string }>,
  ): Promise<CitedExcerpt[]> {
    const excerpts: CitedExcerpt[] = [];

    for (const cite of citations) {
      try {
        const safePath = resolveSafePath(this.workspaceRoot, cite.path, this.forbiddenPaths);
        if (!fs.existsSync(safePath)) continue;

        const stat = fs.statSync(safePath);
        if (!stat.isFile()) continue;

        const content = fs.readFileSync(safePath, "utf8");
        const lines = content.split("\n");

        const startLine = Math.max(1, cite.start);
        let endLine = Math.min(lines.length, Math.max(startLine, cite.end));

        // Enforce max excerpt length to avoid token blowout
        if (endLine - startLine + 1 > this.maxExcerptLines) {
          endLine = startLine + this.maxExcerptLines - 1;
        }

        const excerptLines = lines.slice(startLine - 1, endLine);
        const excerptContent = excerptLines.join("\n");

        const relPath = path.relative(this.workspaceRoot, safePath);
        excerpts.push({
          filePath: relPath,
          startLine,
          endLine,
          content: excerptContent,
          relevanceReason: cite.reason || `Cited line range L${startLine}-L${endLine}`,
        });
      } catch {
        // Skip inaccessible or forbidden paths
      }
    }

    return excerpts;
  }

  /**
   * Find files matching a search query or pattern in the workspace.
   */
  async findFiles(pattern: string): Promise<string[]> {
    const patternLower = pattern.toLowerCase().trim();
    const matches: string[] = [];

    const walk = (dir: string) => {
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }

      for (const entry of entries) {
        if (
          entry.name.startsWith(".") ||
          entry.name === "node_modules" ||
          entry.name === "dist" ||
          entry.name === ".helix-work"
        ) {
          continue;
        }

        const fullPath = path.join(dir, entry.name);
        const relPath = path.relative(this.workspaceRoot, fullPath);

        if (entry.isDirectory()) {
          walk(fullPath);
        } else if (entry.isFile()) {
          if (
            relPath.toLowerCase().includes(patternLower) ||
            entry.name.toLowerCase().includes(patternLower)
          ) {
            matches.push(relPath);
          }
        }
      }
    };

    walk(this.workspaceRoot);
    return matches.slice(0, 50);
  }

  /**
   * Find relevant test files for given source files.
   */
  async findRelatedTests(sourceFiles: string[]): Promise<string[]> {
    const testFiles = new Set<string>();

    for (const src of sourceFiles) {
      const ext = path.extname(src);
      const baseNoExt = src.slice(0, -ext.length);
      const dir = path.dirname(src);
      const name = path.basename(src, ext);

      const candidates = [
        `${baseNoExt}.test${ext}`,
        `${baseNoExt}.spec${ext}`,
        `${dir}/__tests__/${name}.test${ext}`,
        `test/${name}.test${ext}`,
        `tests/${name}.test${ext}`,
        `evals/${name}.test.mjs`,
      ];

      for (const cand of candidates) {
        const fullCand = path.resolve(this.workspaceRoot, cand);
        if (fs.existsSync(fullCand)) {
          testFiles.add(cand);
        }
      }
    }

    return Array.from(testFiles);
  }

  /**
   * Extract exported interfaces and types for given source files without function bodies.
   */
  async extractInterfaces(sourceFiles: string[], maxTokens = 500): Promise<string> {
    const blocks: string[] = [];
    let currentTokens = 0;

    for (const src of sourceFiles) {
      try {
        const safePath = resolveSafePath(this.workspaceRoot, src, this.forbiddenPaths);
        if (!fs.existsSync(safePath)) continue;

        const content = fs.readFileSync(safePath, "utf8");
        const lines = content.split("\n");
        const extractedLines: string[] = [];

        let inInterfaceOrType = false;
        let braceDepth = 0;

        for (const line of lines) {
          const trimmed = line.trim();

          if (trimmed.startsWith("export type ") || trimmed.startsWith("export interface ")) {
            inInterfaceOrType = true;
            extractedLines.push(line);
            braceDepth += (line.match(/{/g) || []).length - (line.match(/}/g) || []).length;
            if (trimmed.endsWith(";") && !line.includes("{")) {
              inInterfaceOrType = false;
            }
          } else if (inInterfaceOrType) {
            extractedLines.push(line);
            braceDepth += (line.match(/{/g) || []).length - (line.match(/}/g) || []).length;
            if (braceDepth <= 0 && (trimmed.endsWith("}") || trimmed.endsWith("};"))) {
              inInterfaceOrType = false;
              braceDepth = 0;
            }
          } else if (
            trimmed.startsWith("export function ") ||
            trimmed.startsWith("export async function ")
          ) {
            // Function declaration signature only
            const sig = line.split("{")[0].trim() + ";";
            extractedLines.push(sig);
          }
        }

        if (extractedLines.length > 0) {
          const block = `### ${src} Interfaces\n\`\`\`ts\n${extractedLines.join("\n")}\n\`\`\``;
          const blockTokens = countTokens(block);
          if (currentTokens + blockTokens <= maxTokens) {
            blocks.push(block);
            currentTokens += blockTokens;
          } else {
            break;
          }
        }
      } catch {
        // Skip inaccessible files
      }
    }

    return blocks.join("\n\n");
  }
}
