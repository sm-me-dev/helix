// Helix Adaptive Knowledge Retriever (Phase 11.4)
// Deterministic ranking, bounded dependency expansion, token budget enforcement & caching.
import { SQLiteKnowledgeIndex } from "./index.ts";
import type {
  KnowledgeContextPackage,
  KnowledgeItem,
  KnowledgeType,
  RetrievedItem,
  TaskRetrievalContext,
} from "./types.ts";
import { Lang, parse } from "@ast-grep/napi";
import { countTokens } from "../measure.ts";
import { TieredKnowledgeRepository } from "./repository.ts";
import { matchPathGlob } from "./glob.ts";
import type { AstGrepMatcherRule, Tier2EpisodicRecord } from "./types.ts";
import { recordEpisodicRetrieval } from "../telemetry/utilization.ts";

export interface RetrieverOptions {
  index: SQLiteKnowledgeIndex;
  defaultTokenBudget?: number;
  maxItems?: number;
  maxDependencyDepth?: number;
  maxExpandedDomains?: number;
}

export class AdaptiveKnowledgeRetriever {
  private readonly index: SQLiteKnowledgeIndex;
  private readonly defaultTokenBudget: number;
  private readonly maxItems: number;
  private readonly maxDependencyDepth: number;
  private readonly maxExpandedDomains: number;
  private readonly cache = new Map<string, KnowledgeContextPackage>();

  constructor(options: RetrieverOptions) {
    this.index = options.index;
    this.defaultTokenBudget = options.defaultTokenBudget || 2500;
    this.maxItems = options.maxItems || 10;
    this.maxDependencyDepth = options.maxDependencyDepth || 2;
    this.maxExpandedDomains = options.maxExpandedDomains || 3;
  }

  /**
   * Retrieves a prioritized, token-bounded context package for the given task.
   */
  async retrieve(context: TaskRetrievalContext): Promise<KnowledgeContextPackage> {
    const cacheKey = this.computeCacheKey(context);
    if (this.cache.has(cacheKey)) {
      const cached = this.cache.get(cacheKey)!;
      return { ...cached, cacheHit: true };
    }

    const budget = context.tokenBudget ?? this.defaultTokenBudget;
    const maxItems = context.maxItems ?? this.maxItems;
    const maxDepth = context.maxDepth ?? this.maxDependencyDepth;
    const diagnostics: string[] = [];

    // Step 1: Task Analysis & Domain Routing
    const allDomains = this.index.getAllDomains();
    const candidateDomains = new Set<string>(context.knownDomains || []);

    const targetFiles = (context.targetFiles || []).concat(context.changedPaths || []);

    for (const domain of allDomains) {
      // Path matching
      for (const srcPath of domain.sourcePaths) {
        for (const tf of targetFiles) {
          if (tf.startsWith(srcPath) || srcPath.startsWith(tf)) {
            candidateDomains.add(domain.id);
          }
        }
      }

      // Keyword matching in prompt
      const promptLower = context.prompt.toLowerCase();
      if (domain.keywords && domain.keywords.some((k) => promptLower.includes(k.toLowerCase()))) {
        candidateDomains.add(domain.id);
      }
    }

    // Step 2: Full-Text Search via FTS5
    const ftsResults = this.index.searchFts(context.prompt, maxItems * 2);

    // Step 3: Item Candidate Collection & Scoring
    const scoredCandidates = new Map<
      string,
      {
        item: KnowledgeItem;
        score: number;
        reasons: string[];
        depth: number;
      }
    >();

    const allItems = this.index.getAllItems();
    const itemsById = new Map<string, KnowledgeItem>();
    for (const item of allItems) {
      itemsById.set(item.id, item);
    }

    // 3a. Add FTS5 matches
    for (const fts of ftsResults) {
      const item = itemsById.get(fts.id);
      if (!item) continue;

      // BM25 score is negative; lower is better match in SQLite
      const ftsScore = Math.max(0, 20 + fts.bm25Score * -2);
      this.addOrUpdateScore(scoredCandidates, item, ftsScore, "FTS5 BM25 match", 0);
    }

    // 3b. Add Domain matches & Source Path matches
    for (const item of allItems) {
      const isDomainMatch = candidateDomains.has(item.domainId);
      if (isDomainMatch) {
        this.addOrUpdateScore(
          scoredCandidates,
          item,
          30,
          `Direct domain match (${item.domainId})`,
          0,
        );
      }

      // Source path match
      for (const s of item.sources) {
        for (const tf of targetFiles) {
          if (tf.includes(s.path) || s.path.includes(tf)) {
            this.addOrUpdateScore(
              scoredCandidates,
              item,
              25,
              `Source path matches task target (${s.path})`,
              0,
            );
          }
        }
      }

      // Title match
      const pLower = context.prompt.toLowerCase();
      if (pLower.includes(item.title.toLowerCase())) {
        this.addOrUpdateScore(scoredCandidates, item, 20, "Title match in prompt", 0);
      }

      // Role-aware boost
      if (context.agentRole) {
        const roleBoost = this.getRoleRelevanceBoost(context.agentRole, item.type);
        if (roleBoost > 0) {
          this.addOrUpdateScore(
            scoredCandidates,
            item,
            roleBoost,
            `Role-preferred knowledge type (${context.agentRole} -> ${item.type})`,
            0,
          );
        }
      }

      // Status adjustment
      if (item.status === "verified") {
        this.addOrUpdateScore(scoredCandidates, item, 5, "Status: verified", 0);
      } else if (item.status === "stale") {
        this.addOrUpdateScore(scoredCandidates, item, -5, "Status: stale penalty", 0);
      } else if (item.status === "deprecated") {
        this.addOrUpdateScore(scoredCandidates, item, -20, "Status: deprecated penalty", 0);
      }
    }

    // Step 4: Bounded Dependency Expansion
    let expandedDomainsCount = 0;
    const itemsToExpand = Array.from(scoredCandidates.values())
      .filter((c) => c.score >= 20)
      .slice(0, 5);

    for (const candidate of itemsToExpand) {
      if (candidate.depth >= maxDepth) continue;

      const outgoing = this.index.getOutgoingRelationships(candidate.item.id);
      for (const rel of outgoing) {
        const targetItem = itemsById.get(rel.targetId);
        if (targetItem) {
          const depthScore = Math.max(2, 8 - (candidate.depth + 1) * 2);
          this.addOrUpdateScore(
            scoredCandidates,
            targetItem,
            depthScore,
            `Expanded via ${rel.type} from ${candidate.item.id}`,
            candidate.depth + 1,
          );
        }
      }

      // Also expand domain-level dependencies
      const domainOutgoing = this.index.getOutgoingRelationships(candidate.item.domainId);
      for (const rel of domainOutgoing) {
        if (expandedDomainsCount >= this.maxExpandedDomains) break;
        const depDomain = allDomains.find((d) => d.id === rel.targetId);
        if (depDomain && !candidateDomains.has(depDomain.id)) {
          candidateDomains.add(depDomain.id);
          expandedDomainsCount++;

          // Grab top items from that domain
          const depItems = allItems.filter((i) => i.domainId === depDomain.id).slice(0, 2);
          for (const di of depItems) {
            this.addOrUpdateScore(
              scoredCandidates,
              di,
              6,
              `Expanded from domain dependency (${candidate.item.domainId} -> ${depDomain.id})`,
              1,
            );
          }
        }
      }
    }

    // Step 5: Deterministic Ranking & Budget Selection
    const rankedList = Array.from(scoredCandidates.values()).sort(
      (a, b) => b.score - a.score || a.item.id.localeCompare(b.item.id),
    );

    const baseHeader =
      "## Project Knowledge & Architecture\nActive Domains: " +
      Array.from(candidateDomains).join(", ");
    let currentTokens = countTokens(baseHeader);
    const selectedItems: RetrievedItem[] = [];
    let omittedCount = 0;

    for (const candidate of rankedList) {
      if (selectedItems.length >= maxItems) {
        omittedCount++;
        continue;
      }

      const reasonsStr = candidate.reasons.join("; ");
      const itemCard = `### [${candidate.item.type.toUpperCase()}] ${candidate.item.title} (\`${candidate.item.id}\`)\nStatus: ${candidate.item.status} · Relevance: ${reasonsStr}\n\n${candidate.item.content}\n\n`;
      const itemTokens = countTokens(itemCard);
      if (currentTokens + itemTokens > budget) {
        omittedCount++;
        continue;
      }

      selectedItems.push({
        item: candidate.item,
        score: Math.round(candidate.score * 10) / 10,
        relevanceReason: reasonsStr,
        snippet: candidate.item.content.slice(0, 160) + "...",
        depth: candidate.depth,
        estimatedTokens: itemTokens,
      });

      currentTokens += itemTokens;

      // Log retrieval event in index
      this.index.logRetrievalEvent(
        context.taskId,
        candidate.item.id,
        candidate.reasons[0],
        candidate.score,
        itemTokens,
      );
    }

    // Step 6: Render Markdown Section
    const markdownLines: string[] = [
      "## Project Knowledge & Architecture",
      `Active Domains: ${Array.from(candidateDomains).join(", ") || "General"}`,
      "",
    ];

    if (selectedItems.length === 0) {
      markdownLines.push("_No specific project knowledge records matched the task query._");
    } else {
      for (const ret of selectedItems) {
        markdownLines.push(
          `### [${ret.item.type.toUpperCase()}] ${ret.item.title} (\`${ret.item.id}\`)`,
          `Status: ${ret.item.status} · Relevance: ${ret.relevanceReason}`,
          "",
          ret.item.content,
          "",
        );
      }
    }

    const markdownSection = markdownLines.join("\n");
    const totalEstimatedTokens = countTokens(markdownSection);

    const pkg: KnowledgeContextPackage = {
      taskId: context.taskId,
      domains: Array.from(candidateDomains),
      items: selectedItems,
      totalEstimatedTokens,
      budget,
      omittedCount,
      markdownSection,
      diagnostics,
      cacheHit: false,
    };

    this.cache.set(cacheKey, pkg);
    return pkg;
  }

  private addOrUpdateScore(
    map: Map<
      string,
      {
        item: KnowledgeItem;
        score: number;
        reasons: string[];
        depth: number;
      }
    >,
    item: KnowledgeItem,
    addScore: number,
    reason: string,
    depth: number,
  ): void {
    const existing = map.get(item.id);
    if (existing) {
      existing.score += addScore;
      if (!existing.reasons.includes(reason)) {
        existing.reasons.push(reason);
      }
      existing.depth = Math.min(existing.depth, depth);
    } else {
      map.set(item.id, {
        item,
        score: Math.max(0, addScore),
        reasons: [reason],
        depth,
      });
    }
  }

  private getRoleRelevanceBoost(role: string, type: KnowledgeType): number {
    const r = role.toLowerCase();
    switch (r) {
      case "planner":
      case "architect":
        return type === "project" ||
          type === "domain" ||
          type === "architecture" ||
          type === "constraint"
          ? 15
          : 0;
      case "implementer":
      case "builder":
        return type === "domain" ||
          type === "architecture" ||
          type === "decision" ||
          type === "reference"
          ? 12
          : 0;
      case "reviewer":
        return type === "architecture" || type === "constraint" || type === "decision" ? 15 : 0;
      case "tester":
      case "scout":
        return type === "workflow" || type === "known_issue" || type === "domain" ? 12 : 0;
      case "debugger":
      case "retry":
        return type === "known_issue" || type === "architecture" || type === "decision" ? 15 : 0;
      default:
        return 0;
    }
  }

  private computeCacheKey(context: TaskRetrievalContext): string {
    return `${context.taskId}:${context.prompt}:${(context.targetFiles || []).sort().join(",")}:${context.agentRole || ""}`;
  }

  clearCache(): void {
    this.cache.clear();
  }
}

export interface EpisodicRetrievalOptions {
  readonly domainId?: string;
  readonly filePath?: string;
  readonly sourceCode?: string;
  readonly limit?: number;
  readonly maxTokens?: number;
}

/** Hybrid BM25/vector retrieval using reciprocal rank fusion (k=60). */
export function retrieveEpisodicRecords(
  repository: TieredKnowledgeRepository,
  query: string,
  options: EpisodicRetrievalOptions = {},
): Tier2EpisodicRecord[] {
  const limit = Math.min(3, Math.max(0, options.limit ?? 3));
  const maxTokens = Math.min(250, Math.max(0, options.maxTokens ?? 250));
  if (limit === 0 || maxTokens === 0 || !query.trim()) return [];

  const fts = repository.searchEpisodicFts(query, 100);
  const vectors = repository.searchEpisodicVector(query, 100);
  const scores = new Map<string, number>();
  for (const [index, result] of fts.entries()) {
    scores.set(result.id, (scores.get(result.id) ?? 0) + 1 / (60 + index + 1));
  }
  for (const [index, result] of vectors.entries()) {
    scores.set(result.id, (scores.get(result.id) ?? 0) + 1 / (60 + index + 1));
  }

  const records = [...scores.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .flatMap(([id]) => {
      const record = repository.getEpisodicRecord(id);
      if (
        !record ||
        (options.domainId !== undefined && record.domainId !== options.domainId) ||
        (options.filePath && record.fileGlob && !matchPathGlob(options.filePath, record.fileGlob))
      ) {
        return [];
      }
      if (
        options.sourceCode !== undefined &&
        record.astGrepRule &&
        !astGrepRuleMatches(record.astGrepRule, options.sourceCode)
      ) {
        return [];
      }
      return [record];
    });

  const selected: Tier2EpisodicRecord[] = [];
  let usedTokens = 0;
  for (const record of records) {
    const recordTokens = countTokens(
      `- ${record.id} (${record.domainId}): ${record.triggerSummary}\n  ${record.resolutionRule}`,
    );
    if (usedTokens + recordTokens > maxTokens) continue;
    selected.push(record);
    usedTokens += recordTokens;
    recordEpisodicRetrieval(repository, record.id);
    if (selected.length === limit) break;
  }
  return selected;
}

/** Return validated rules structurally matched against a parsed source file. */
export function matchEpisodicRulesForSource(
  repository: TieredKnowledgeRepository,
  filePath: string,
  sourceCode: string,
): Tier2EpisodicRecord[] {
  return repository.listEpisodicRecords("VALIDATED").filter((record) => {
    if (record.fileGlob && !matchPathGlob(filePath, record.fileGlob)) return false;
    return record.astGrepRule ? astGrepRuleMatches(record.astGrepRule, sourceCode) : false;
  });
}

function astGrepRuleMatches(rule: AstGrepMatcherRule, sourceCode: string): boolean {
  const lang =
    rule.lang === "TypeScript" ? Lang.TypeScript : rule.lang === "Tsx" ? Lang.Tsx : Lang.JavaScript;
  const root = parse(lang, sourceCode).root();
  const hasConstraint = Boolean(rule.pattern || rule.kind || rule.insideKind);
  if (!hasConstraint) return false;

  const visit = (node: ReturnType<typeof root.children>[number]): boolean => {
    const nodeMatches =
      (!rule.kind || node.kind() === rule.kind) &&
      (!rule.pattern || node.matches(rule.pattern)) &&
      (!rule.insideKind ||
        node.ancestors().some((ancestor) => ancestor.kind() === rule.insideKind));
    if (nodeMatches) return true;
    return node.children().some(visit);
  };
  return visit(root);
}
