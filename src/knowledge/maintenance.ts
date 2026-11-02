// Helix Knowledge Maintenance, Freshness, Restructuring & Auditing (Phases 11.6, 11.7, 11.8)
import fs from "node:fs";
import path from "node:path";
import { computeContentHash, KnowledgeRepository } from "./repository.ts";
import type {
  DomainRecord,
  DomainRestructuringProposal,
  KnowledgeAuditReport,
  KnowledgeItem,
  KnowledgeUpdateProposal,
  KnowledgeValidationResult,
  UpdateRiskLevel,
  VerificationStatus,
} from "./types.ts";

export class ChangeImpactAnalyzer {
  private readonly repository: KnowledgeRepository;

  constructor(repository: KnowledgeRepository) {
    this.repository = repository;
  }

  /**
   * Analyzes which domains and knowledge items are impacted by a list of changed source paths.
   */
  analyzeImpact(changedPaths: string[]): {
    impactedDomains: string[];
    impactedItems: KnowledgeItem[];
    staleItemCandidates: KnowledgeItem[];
  } {
    const allDomains = this.repository.loadAllDomains();
    const allItems = this.repository.loadAllItems();

    const impactedDomains = new Set<string>();
    const impactedItems = new Set<KnowledgeItem>();
    const staleCandidates = new Set<KnowledgeItem>();

    for (const changed of changedPaths) {
      // Check domains
      for (const d of allDomains) {
        if (d.sourcePaths.some((sp) => changed.startsWith(sp) || sp.startsWith(changed))) {
          impactedDomains.add(d.id);
        }
      }

      // Check items
      for (const item of allItems) {
        let isDirect = false;
        for (const s of item.sources) {
          if (changed.includes(s.path) || s.path.includes(changed)) {
            impactedItems.add(item);
            isDirect = true;
            break;
          }
        }

        if (isDirect && item.status === "verified") {
          staleCandidates.add(item);
        }
      }
    }

    return {
      impactedDomains: Array.from(impactedDomains),
      impactedItems: Array.from(impactedItems),
      staleItemCandidates: Array.from(staleCandidates),
    };
  }
}

export class KnowledgeUpdater {
  private readonly repository: KnowledgeRepository;

  constructor(repository: KnowledgeRepository) {
    this.repository = repository;
  }

  classifyRisk(proposal: Partial<KnowledgeUpdateProposal>): UpdateRiskLevel {
    if (
      proposal.targetType === "domain" &&
      (proposal.operation === "DELETE" || proposal.operation === "DEPRECATE")
    ) {
      return "high";
    }
    if (proposal.operation === "DELETE") {
      return "high";
    }
    if (proposal.targetType === "domain") {
      return "medium";
    }
    if (
      proposal.proposedItem?.type === "constraint" ||
      proposal.proposedItem?.type === "architecture"
    ) {
      return "medium";
    }
    return "low";
  }

  /**
   * Proposes or applies an update based on its risk tier and autonomy policy.
   */
  handleUpdate(
    proposal: KnowledgeUpdateProposal,
    autoApply = false,
  ): {
    applied: boolean;
    proposalPath?: string;
    message: string;
  } {
    const risk = proposal.risk || this.classifyRisk(proposal);
    proposal.risk = risk;

    if (risk === "low" || autoApply) {
      // Safe to apply directly
      this.applyProposal(proposal);
      return {
        applied: true,
        message: `Low-risk update ${proposal.id} automatically applied to ${proposal.targetId}`,
      };
    }

    // Medium or High risk: persist proposal for review
    const propPath = this.saveProposal(proposal);
    return {
      applied: false,
      proposalPath: propPath,
      message: `${risk.toUpperCase()}-risk update proposal created at ${propPath}. Requires approval.`,
    };
  }

  applyProposal(proposal: KnowledgeUpdateProposal): void {
    const now = new Date().toISOString().split("T")[0];

    if (proposal.targetType === "item" && proposal.proposedItem) {
      if (proposal.operation === "CREATE" || proposal.operation === "UPDATE") {
        const item = proposal.proposedItem as KnowledgeItem;
        item.updatedAt = now;
        if (!item.createdAt) item.createdAt = now;
        this.repository.saveItem(item);
      } else if (proposal.operation === "DEPRECATE") {
        const existing = this.repository.loadAllItems().find((i) => i.id === proposal.targetId);
        if (existing) {
          existing.status = "deprecated";
          existing.updatedAt = now;
          this.repository.saveItem(existing);
        }
      }
    } else if (proposal.targetType === "domain" && proposal.proposedDomain) {
      const domain = proposal.proposedDomain as DomainRecord;
      domain.updatedAt = now;
      if (!domain.createdAt) domain.createdAt = now;
      this.repository.saveDomain(domain);
    }

    // Append to changelog
    this.repository.appendChangelog({
      operation: `${proposal.operation}_${proposal.targetType.toUpperCase()}`,
      targetId: proposal.targetId,
      reason: proposal.reason,
      author: "APKS-Updater",
      evidence: proposal.evidence,
    });

    proposal.status = "applied";
  }

  private saveProposal(proposal: KnowledgeUpdateProposal): string {
    const propDir = path.join(this.repository.knowledgeDir, "history", "proposals");
    if (!fs.existsSync(propDir)) {
      fs.mkdirSync(propDir, { recursive: true });
    }
    const propFile = path.join(propDir, `${proposal.id}.json`);
    fs.writeFileSync(propFile, JSON.stringify(proposal, null, 2), "utf8");
    return propFile;
  }
}

export class DomainRestructurer {
  private readonly repository: KnowledgeRepository;

  constructor(repository: KnowledgeRepository) {
    this.repository = repository;
  }

  /**
   * Evaluates restructuring signals: domain size, cross-domain coupling, number of responsibilities.
   */
  evaluateRestructuringSignals(): DomainRestructuringProposal[] {
    const domains = this.repository.loadAllDomains();
    const items = this.repository.loadAllItems();
    const proposals: DomainRestructuringProposal[] = [];

    for (const d of domains) {
      const domainItems = items.filter((i) => i.domainId === d.id);
      const signals: string[] = [];

      // Signal 1: Domain size overload
      if (domainItems.length > 8) {
        signals.push(`Domain has high complexity (${domainItems.length} distinct knowledge items)`);
      }

      // Signal 2: High number of distinct source directories
      const dirs = new Set(d.sourcePaths.map((p) => path.dirname(p)));
      if (dirs.size > 5) {
        signals.push(`Domain spans ${dirs.size} disparate source directories`);
      }

      if (signals.length > 0) {
        proposals.push({
          id: `restruct-${d.id}-${Date.now().toString(36)}`,
          action: "split",
          domainId: d.id,
          reason: `Domain ${d.name} shows high complexity and cross-boundary coupling`,
          signals,
          affectedItems: domainItems.map((i) => i.id),
          brokenReferences: [],
          status: "proposed",
          createdAt: new Date().toISOString(),
        });
      }
    }

    return proposals;
  }

  /**
   * Applies an approved restructuring proposal safely without losing history.
   */
  applyRestructure(proposal: DomainRestructuringProposal): { success: boolean; error?: string } {
    if (proposal.action === "rename" && proposal.targetDomainId) {
      const domain = this.repository.loadAllDomains().find((d) => d.id === proposal.domainId);
      if (!domain) return { success: false, error: `Domain ${proposal.domainId} not found` };

      // Update domain ID
      const oldId = domain.id;
      domain.id = proposal.targetDomainId;
      domain.updatedAt = new Date().toISOString().split("T")[0];
      this.repository.saveDomain(domain);

      // Move items
      const items = this.repository.loadAllItems().filter((i) => i.domainId === oldId);
      for (const item of items) {
        item.domainId = proposal.targetDomainId;
        this.repository.saveItem(item);
      }

      this.repository.appendChangelog({
        operation: "RENAME_DOMAIN",
        targetId: oldId,
        reason: proposal.reason,
        author: "APKS-Restructurer",
        evidence: proposal.signals,
      });

      proposal.status = "applied";
      return { success: true };
    }

    return { success: false, error: `Unsupported restructuring action: ${proposal.action}` };
  }
}

export class KnowledgeValidator {
  private readonly repository: KnowledgeRepository;

  constructor(repository: KnowledgeRepository) {
    this.repository = repository;
  }

  validate(): KnowledgeValidationResult {
    const domains = this.repository.loadAllDomains();
    const items = this.repository.loadAllItems();
    const domainIds = new Set(domains.map((d) => d.id));
    const itemIds = new Set(items.map((i) => i.id));

    const errors: string[] = [];
    const warnings: string[] = [];
    const missingSources: string[] = [];
    const brokenReferences: string[] = [];
    const circularDependencies: string[] = [];
    let staleCount = 0;

    // 1. Validate Domains
    const domainDepGraph = new Map<string, string[]>();
    for (const d of domains) {
      domainDepGraph.set(d.id, d.dependencies || []);
      for (const dep of d.dependencies || []) {
        if (!domainIds.has(dep)) {
          warnings.push(`Domain "${d.id}" has unknown dependency "${dep}"`);
          brokenReferences.push(`${d.id} -> ${dep}`);
        }
      }
    }

    // Check circular dependencies in domains
    for (const [id, deps] of domainDepGraph) {
      for (const dep of deps) {
        const targetDeps = domainDepGraph.get(dep) || [];
        if (targetDeps.includes(id)) {
          circularDependencies.push(`${id} <-> ${dep}`);
        }
      }
    }

    // 2. Validate Items
    for (const item of items) {
      if (!domainIds.has(item.domainId)) {
        errors.push(`Knowledge item "${item.id}" belongs to unknown domain "${item.domainId}"`);
      }

      if (item.status === "stale") {
        staleCount++;
      }

      // Check item dependencies
      for (const dep of item.dependencies) {
        if (!itemIds.has(dep) && !domainIds.has(dep)) {
          warnings.push(`Knowledge item "${item.id}" references unknown dependency "${dep}"`);
          brokenReferences.push(`${item.id} -> ${dep}`);
        }
      }

      // Check sources exist
      for (const s of item.sources) {
        const fullSourcePath = path.join(this.repository.workspaceRoot, s.path);
        if (!fs.existsSync(fullSourcePath)) {
          missingSources.push(`${item.id}: source file missing (${s.path})`);
          warnings.push(`Knowledge item "${item.id}" points to missing source file "${s.path}"`);
        }
      }
    }

    // Check orphaned domains
    const referencedDomainIds = new Set(items.map((i) => i.domainId));
    const orphanedDomains = domains.filter((d) => !referencedDomainIds.has(d.id)).map((d) => d.id);

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      staleCount,
      missingSources,
      brokenReferences,
      orphanedDomains,
      circularDependencies,
    };
  }

  detectStaleKnowledge(): KnowledgeItem[] {
    const items = this.repository.loadAllItems();
    const staleItems: KnowledgeItem[] = [];

    for (const item of items) {
      let isStale = false;
      for (const s of item.sources) {
        const fullPath = path.join(this.repository.workspaceRoot, s.path);
        if (fs.existsSync(fullPath)) {
          const currentContent = fs.readFileSync(fullPath, "utf8");
          const currentHash = computeContentHash(currentContent);
          if (s.contentHash && s.contentHash !== currentHash) {
            isStale = true;
            break;
          }
        }
      }

      if (isStale) {
        item.status = "stale";
        this.repository.saveItem(item);
        staleItems.push(item);
      }
    }

    return staleItems;
  }
}

export class KnowledgeAuditor {
  private readonly repository: KnowledgeRepository;
  private readonly validator: KnowledgeValidator;

  constructor(repository: KnowledgeRepository) {
    this.repository = repository;
    this.validator = new KnowledgeValidator(repository);
  }

  audit(): KnowledgeAuditReport {
    const domains = this.repository.loadAllDomains();
    const items = this.repository.loadAllItems();
    const relationships = this.repository.loadAllRelationships();
    const validation = this.validator.validate();

    const statusBreakdown: Record<VerificationStatus, number> = {
      verified: 0,
      inferred: 0,
      proposed: 0,
      stale: 0,
      deprecated: 0,
    };

    const typeBreakdown: Record<KnowledgeItem["type"], number> = {
      project: 0,
      domain: 0,
      architecture: 0,
      decision: 0,
      workflow: 0,
      reference: 0,
      constraint: 0,
      dependency: 0,
      known_issue: 0,
    };

    const staleItems: Array<{ id: string; domain: string; reason: string }> = [];

    for (const item of items) {
      if (statusBreakdown[item.status] !== undefined) {
        statusBreakdown[item.status]++;
      }
      if (typeBreakdown[item.type] !== undefined) {
        typeBreakdown[item.type]++;
      }

      if (item.status === "stale") {
        staleItems.push({
          id: item.id,
          domain: item.domainId,
          reason: "Source code modified since verification",
        });
      }
    }

    const recommendations: string[] = [];
    if (validation.staleCount > 0) {
      recommendations.push(
        `Revalidate ${validation.staleCount} stale knowledge items against current code.`,
      );
    }
    if (validation.missingSources.length > 0) {
      recommendations.push(
        `Update or remove ${validation.missingSources.length} references to missing source files.`,
      );
    }
    if (validation.brokenReferences.length > 0) {
      recommendations.push(
        `Resolve ${validation.brokenReferences.length} broken cross-domain references.`,
      );
    }
    if (validation.orphanedDomains.length > 0) {
      recommendations.push(
        `Document key components for orphaned domains: ${validation.orphanedDomains.join(", ")}.`,
      );
    }
    if (recommendations.length === 0) {
      recommendations.push("Knowledge base is healthy, fully indexed, and consistent.");
    }

    return {
      timestamp: new Date().toISOString(),
      domainsCount: domains.length,
      itemsCount: items.length,
      relationshipsCount: relationships.length,
      statusBreakdown,
      typeBreakdown,
      indexFreshness: {
        canonicalFiles: items.length + domains.length,
        indexedFiles: items.length + domains.length,
        isFresh: validation.errors.length === 0,
      },
      staleItems,
      brokenReferences: validation.brokenReferences,
      orphanedDomains: validation.orphanedDomains,
      recommendations,
    };
  }
}
