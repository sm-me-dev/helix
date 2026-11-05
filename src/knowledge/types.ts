// Helix Adaptive Project Knowledge System (APKS) - Types & Data Models
// Independent of specific agent formats; supports progressive disclosure and verifiable metadata.

export type KnowledgeType =
  | "project"
  | "domain"
  | "architecture"
  | "decision"
  | "workflow"
  | "reference"
  | "constraint"
  | "dependency"
  | "known_issue";

export type VerificationStatus = "verified" | "inferred" | "proposed" | "stale" | "deprecated";

/** Compact Tier 0 route compiled from a domain's SKILL.md/domain.md metadata. */
export interface Tier0DomainRoute {
  readonly domainId: string;
  readonly description: string;
  readonly pathGlobs: readonly string[];
  readonly skillTokenCost: number;
  readonly canonicalHash: string;
}

export type EpisodicStatus = "QUARANTINED" | "VALIDATED" | "PROMOTED" | "PRUNED";

export interface AstGrepMatcherRule {
  readonly lang: "TypeScript" | "Tsx" | "JavaScript";
  readonly pattern?: string;
  readonly kind?: string;
  readonly insideKind?: string;
}

export interface Tier2EpisodicRecord {
  readonly id: string;
  readonly domainId: string;
  readonly triggerSummary: string;
  readonly resolutionRule: string;
  readonly fileGlob?: string;
  readonly astGrepRule?: AstGrepMatcherRule;
  readonly status: EpisodicStatus;
  readonly sourceTaskId: string;
  readonly timesRetrieved: number;
  readonly timesHelpedPassGate: number;
  readonly timesPresentInFailedRun: number;
  readonly createdAtIso: string;
}

export type DomainRelationshipType =
  "depends_on" | "uses" | "implements" | "owns" | "tests" | "documents" | "extends";

export interface KnowledgeSource {
  path: string;
  lines?: string;
  note?: string;
  contentHash?: string;
}

export interface DomainRecord {
  id: string;
  name: string;
  description: string;
  sourcePaths: string[];
  relatedDocs?: string[];
  dependencies?: string[];
  keywords?: string[];
  discoveryEvidence?: string[];
  createdAt: string;
  updatedAt: string;
  metadata?: Record<string, unknown>;
}

export interface KnowledgeItem {
  id: string;
  domainId: string;
  type: KnowledgeType;
  title: string;
  content: string;
  sourcePath: string; // File path inside .helix/knowledge/
  status: VerificationStatus;
  sources: KnowledgeSource[];
  dependencies: string[];
  createdAt: string;
  updatedAt: string;
  verifiedAt: string;
  contentHash: string;
  confidence?: number;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export interface DomainRelationship {
  sourceId: string;
  targetId: string;
  type: DomainRelationshipType;
  metadata?: Record<string, unknown>;
}

export interface TaskRetrievalContext {
  taskId: string;
  prompt: string;
  targetFiles?: string[];
  changedPaths?: string[];
  knownDomains?: string[];
  agentRole?: string;
  tokenBudget?: number;
  maxItems?: number;
  maxDepth?: number;
}

export interface RetrievedItem {
  item: KnowledgeItem;
  score: number;
  relevanceReason: string;
  snippet?: string;
  depth: number;
  estimatedTokens: number;
}

export interface KnowledgeContextPackage {
  taskId: string;
  domains: string[];
  items: RetrievedItem[];
  totalEstimatedTokens: number;
  budget: number;
  omittedCount: number;
  markdownSection: string;
  diagnostics: string[];
  cacheHit?: boolean;
}

export type KnowledgeUpdateOperation = "CREATE" | "UPDATE" | "DEPRECATE" | "DELETE";

export type UpdateRiskLevel = "low" | "medium" | "high";

export interface KnowledgeUpdateProposal {
  id: string;
  risk: UpdateRiskLevel;
  operation: KnowledgeUpdateOperation;
  targetType: "item" | "domain" | "relationship";
  targetId: string;
  reason: string;
  evidence: string[];
  proposedItem?: Partial<KnowledgeItem>;
  proposedDomain?: Partial<DomainRecord>;
  proposedRelationship?: Partial<DomainRelationship>;
  status: "proposed" | "approved" | "rejected" | "applied";
  createdAt: string;
}

export interface DomainRestructuringProposal {
  id: string;
  action: "create" | "split" | "merge" | "rename" | "move" | "deprecate";
  domainId: string;
  targetDomainId?: string;
  newDomain?: Partial<DomainRecord>;
  splitDomains?: Array<{
    id: string;
    name: string;
    description: string;
    sourcePaths: string[];
    itemIds: string[];
  }>;
  reason: string;
  signals: string[];
  affectedItems: string[];
  brokenReferences: string[];
  status: "proposed" | "approved" | "rejected" | "applied";
  createdAt: string;
}

export interface KnowledgeValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  staleCount: number;
  missingSources: string[];
  brokenReferences: string[];
  orphanedDomains: string[];
  circularDependencies: string[];
}

export interface KnowledgeAuditReport {
  timestamp: string;
  domainsCount: number;
  itemsCount: number;
  relationshipsCount: number;
  statusBreakdown: Record<VerificationStatus, number>;
  typeBreakdown: Record<KnowledgeType, number>;
  indexFreshness: {
    canonicalFiles: number;
    indexedFiles: number;
    isFresh: boolean;
  };
  staleItems: Array<{ id: string; domain: string; reason: string }>;
  brokenReferences: string[];
  orphanedDomains: string[];
  recommendations: string[];
}

export interface RetrievalEventRecord {
  id: string;
  taskId: string;
  knowledgeItemId: string;
  retrievalReason: string;
  rankingScore: number;
  tokenEstimate: number;
  createdAt: string;
}

export interface RetrievalMetricsSummary {
  totalEvents: number;
  uniqueTasks: number;
  averageItemsPerTask: number;
  averageTokensPerTask: number;
  cacheHitRate: number;
}

export interface BenchmarkTaskScenario {
  id: string;
  name: string;
  description: string;
  prompt: string;
  targetFiles: string[];
  changedPaths: string[];
  expectedDomains: string[];
  criticalConstraints: string[];
}

export interface RetrievalBenchmarkResult {
  scenarioId: string;
  scenarioName: string;
  configA_NoKnowledge: {
    tokensInjected: number;
    durationMs: number;
    constraintsRetrieved: number;
    totalConstraints: number;
    success: boolean;
    rediscoveryActions: number;
  };
  configB_AllKnowledge: {
    tokensInjected: number;
    durationMs: number;
    constraintsRetrieved: number;
    totalConstraints: number;
    success: boolean;
    overheadRatio: number;
  };
  configC_DynamicRetrieval: {
    tokensInjected: number;
    durationMs: number;
    precision: number;
    recall: number;
    constraintsRetrieved: number;
    totalConstraints: number;
    success: boolean;
    tokenSavingsRatioVsAll: number;
  };
}
