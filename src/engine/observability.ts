// Helix Observability & Telemetry Collector (Phase 03 - Component 12)
import fs from "node:fs";
import path from "node:path";
import type {
  ObservabilityCollector,
  RunMetrics,
  SecurityAuditEvent,
  SecurityAuditSummary,
  TokenUsage,
} from "./types.ts";

export type ObservabilityCollectorOptions = {
  reportOutputDir?: string;
};

export class DefaultObservabilityCollector implements ObservabilityCollector {
  private readonly reportOutputDir: string;
  private readonly startTime: number;
  private agentDurationMs = 0;
  private gateDurationMs = 0;
  private gateRuns = 0;
  private retriesAttempted = 0;
  private totalInputTokens = 0;
  private totalOutputTokens = 0;
  private totalCacheReadTokens = 0;
  private inspectedFiles = new Set<string>();
  private modifiedFiles = new Set<string>();
  private fileReadCounts = new Map<string, number>();
  private linesAdded = 0;
  private linesDeleted = 0;
  private roleTokens = new Map<string, TokenUsage>();
  private contextReuseTokens = 0;
  private compactionCount = 0;
  private securityEvents: SecurityAuditEvent[] = [];
  private securitySummary?: SecurityAuditSummary;

  constructor(options: ObservabilityCollectorOptions = {}) {
    this.reportOutputDir = options.reportOutputDir
      ? path.resolve(options.reportOutputDir)
      : path.resolve(".helix-work/reports");
    this.startTime = Date.now();
  }

  recordAgentDuration(durationMs: number): void {
    this.agentDurationMs += durationMs;
  }

  recordRetry(): void {
    this.retriesAttempted++;
  }

  recordTokenUsage(usage: TokenUsage): void {
    this.totalInputTokens += usage.inputTokens || 0;
    this.totalOutputTokens += usage.outputTokens || 0;
    this.totalCacheReadTokens += usage.cacheReadTokens || 0;
  }

  recordRoleTokenUsage(role: string, usage: TokenUsage): void {
    const existing = this.roleTokens.get(role) || {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      totalTokens: 0,
    };
    existing.inputTokens += usage.inputTokens || 0;
    existing.outputTokens += usage.outputTokens || 0;
    existing.cacheReadTokens += usage.cacheReadTokens || 0;
    existing.totalTokens += usage.totalTokens || usage.inputTokens + usage.outputTokens;
    this.roleTokens.set(role, existing);
  }

  recordContextReuse(tokensSaved: number): void {
    this.contextReuseTokens += Math.max(0, tokensSaved);
  }

  recordCompaction(): void {
    this.compactionCount++;
  }

  recordSecurityEvent(event: SecurityAuditEvent): void {
    this.securityEvents.push(event);
  }

  recordSecuritySummary(summary: SecurityAuditSummary): void {
    this.securitySummary = summary;
  }

  recordGateRun(durationMs: number, _passed: boolean): void {
    this.gateDurationMs += durationMs;
    this.gateRuns++;
  }

  recordFileAccess(filePath: string, mode: "read" | "write"): void {
    if (mode === "read") {
      this.inspectedFiles.add(filePath);
      const count = (this.fileReadCounts.get(filePath) || 0) + 1;
      this.fileReadCounts.set(filePath, count);
    } else if (mode === "write") {
      this.modifiedFiles.add(filePath);
    }
  }

  recordDiffStats(diffText: string): void {
    let added = 0;
    let deleted = 0;
    const lines = diffText.split("\n");
    for (const l of lines) {
      if (l.startsWith("+") && !l.startsWith("+++")) added++;
      else if (l.startsWith("-") && !l.startsWith("---")) deleted++;
    }
    this.linesAdded = added;
    this.linesDeleted = deleted;
  }

  calculateEstimatedCostUsd(): number {
    // Blended estimate ($3/M input, $15/M output, $0.30/M cache read)
    const inputCost = (this.totalInputTokens / 1_000_000) * 3.0;
    const outputCost = (this.totalOutputTokens / 1_000_000) * 15.0;
    const cacheCost = (this.totalCacheReadTokens / 1_000_000) * 0.3;
    return Number((inputCost + outputCost + cacheCost).toFixed(5));
  }

  async generateReport(taskId: string): Promise<RunMetrics> {
    const wallClockDurationMs = Date.now() - this.startTime;

    let repeatedFileReads = 0;
    for (const count of this.fileReadCounts.values()) {
      if (count > 1) {
        repeatedFileReads += count - 1;
      }
    }

    const totalTokens = this.totalInputTokens + this.totalOutputTokens + this.totalCacheReadTokens;

    const tokensByRole: Record<string, TokenUsage> = {};
    for (const [role, usage] of this.roleTokens.entries()) {
      tokensByRole[role] = { ...usage };
    }

    let securitySummary = this.securitySummary;
    if (!securitySummary && this.securityEvents.length > 0) {
      let violationsCount = 0;
      let warningsCount = 0;
      let secretsDetectedCount = 0;
      let secretsRedactedCount = 0;
      let dangerousCommandsBlocked = 0;
      let promptInjectionsDetected = 0;
      let networkViolationsCount = 0;

      for (const e of this.securityEvents) {
        if (e.severity === "violation") violationsCount++;
        if (e.severity === "warning") warningsCount++;
        if (e.type === "secret_detected") secretsDetectedCount++;
        if (e.type === "secret_redacted") secretsRedactedCount++;
        if (e.type === "dangerous_command_blocked") dangerousCommandsBlocked++;
        if (e.type === "prompt_injection_detected") promptInjectionsDetected++;
        if (e.type === "network_violation") networkViolationsCount++;
      }

      securitySummary = {
        totalEvents: this.securityEvents.length,
        violationsCount,
        warningsCount,
        secretsDetectedCount,
        secretsRedactedCount,
        dangerousCommandsBlocked,
        promptInjectionsDetected,
        networkViolationsCount,
        hasViolations: violationsCount > 0,
      };
    }

    const metrics: RunMetrics = {
      wallClockDurationMs,
      agentDurationMs: this.agentDurationMs,
      gateDurationMs: this.gateDurationMs,
      retriesAttempted: this.retriesAttempted,
      gateRuns: this.gateRuns,
      tokens: {
        inputTokens: this.totalInputTokens,
        outputTokens: this.totalOutputTokens,
        cacheReadTokens: this.totalCacheReadTokens,
        totalTokens,
        estimatedCostUsd: this.calculateEstimatedCostUsd(),
      },
      fileStats: {
        filesInspected: this.inspectedFiles.size,
        filesModified: this.modifiedFiles.size,
        linesAdded: this.linesAdded,
        linesDeleted: this.linesDeleted,
        repeatedFileReads,
      },
      optimization: {
        contextReuseTokens: this.contextReuseTokens,
        repeatedFileRetrievals: repeatedFileReads,
        compactionCount: this.compactionCount,
        tokensByRole,
        tokensPerSuccessfulTask: totalTokens,
      },
      security: securitySummary,
    };

    // Save report to disk if directory exists or can be created
    try {
      if (!fs.existsSync(this.reportOutputDir)) {
        fs.mkdirSync(this.reportOutputDir, { recursive: true });
      }
      const reportFile = path.join(this.reportOutputDir, `run-${taskId}.json`);
      fs.writeFileSync(reportFile, JSON.stringify(metrics, null, 2), "utf8");
    } catch {
      // Ignore report disk write errors
    }

    return metrics;
  }
}
