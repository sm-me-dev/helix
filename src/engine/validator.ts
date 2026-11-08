// Helix Validation Engine & Diagnostic Extractor (Phase 03 - ADR-002, ADR-006)
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type {
  AdversarialAuditVerdict,
  AdversarialFinding,
  ValidationCheckResult,
  ValidationEngine,
  ValidationReport,
  ValidationStage,
} from "./types.ts";
import { countTokens } from "../measure.ts";
import { recordAdversarialAuditInvocation } from "../telemetry/utilization.ts";
import { resolveOrthogonalAuditor } from "./provider.ts";
import { invokeProviderHeadlessAgent } from "./provider.ts";
import type {
  HeadlessApiConfiguration,
  HeadlessInvocationResult,
  HeadlessProvider,
  ModelRoute,
  ProviderSelection,
} from "./provider.ts";

export interface FirewalledAuditPayload {
  readonly taskSpec: string;
  readonly gitDiff: string;
  readonly domainInvariants: readonly string[];
  readonly deterministicGateSummary: string;
}

export interface TwoStageAuditResult {
  readonly status: "DETERMINISTIC_FAILED" | "AUDITED" | "AUDIT_BLOCKED";
  readonly stageA: ValidationReport;
  readonly deterministicFailureDigest?: string;
  readonly verdict?: AdversarialAuditVerdict;
  readonly reviewerRoute?: ModelRoute;
  readonly tokenCost?: { readonly inputTokens: number; readonly outputTokens: number };
  readonly error?: string;
}

export interface AuditorInvocationOutput {
  readonly output: string;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly falsePositivesDisprovenByTest?: number;
}

export function buildAdversarialAuditPrompt(payload: FirewalledAuditPayload): string {
  return [
    "Review only this immutable task specification, raw diff, domain invariants, and deterministic gate summary.",
    "Return one strict JSON object: {status, reviewerHarness, reviewerModelId, findings}.",
    "Each finding requires severity (BLOCKING_FAULT|EDGE_CASE_RISK|NIT), file, lineOrAstNode, proof, and requiredFix.",
    "Use BLOCKING_FAULT only when the supplied diff and evidence prove a correctness or security defect.",
    "Do not request or infer conversation history, agent reasoning, or author justification.",
    JSON.stringify(payload),
  ].join("\n\n");
}

export function createHeadlessAuditorInvoker(
  resolveApi: (route: ModelRoute) => HeadlessApiConfiguration | undefined,
  timeoutMs = 120_000,
  allowCliFallback = false,
): (payload: FirewalledAuditPayload, route: ModelRoute) => Promise<AuditorInvocationOutput> {
  return async (payload, route) => {
    const api = resolveApi(route);
    if (!api && !allowCliFallback)
      throw new Error(
        "Auditor Stage B requires an explicitly configured API endpoint so no workspace tools or chat history are exposed",
      );
    const isolatedWorkdir = api
      ? undefined
      : fs.mkdtempSync(path.join(os.tmpdir(), "helix-auditor-"));
    let result: HeadlessInvocationResult;
    try {
      result = await invokeProviderHeadlessAgent(route.harness, {
        mode: api ? "api" : "cli",
        modelId: route.modelId,
        effort: route.effort,
        prompt: buildAdversarialAuditPrompt(payload),
        workdir: isolatedWorkdir,
        timeoutMs,
        maxInputTokens: 200_000,
        maxOutputTokens: 6_000,
        maxTurns: route.maxTurns,
        readOnlyToolsOnly: true,
        ...(api ? { api } : {}),
      });
    } finally {
      if (isolatedWorkdir) fs.rmSync(isolatedWorkdir, { recursive: true, force: true });
    }
    if (result.exitCode !== 0)
      throw new Error(result.error ?? result.stderr ?? "Adversarial Auditor invocation failed");
    return {
      output: result.stdout,
      inputTokens: result.tokens.inputTokens,
      outputTokens: result.tokens.outputTokens,
    };
  };
}

export function buildFirewalledAuditPayload(value: unknown): FirewalledAuditPayload {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Firewalled audit payload must be an object");
  }
  const record = value as Record<string, unknown>;
  const expected = ["taskSpec", "gitDiff", "domainInvariants", "deterministicGateSummary"];
  const keys = Object.keys(record);
  if (keys.length !== expected.length || keys.some((key) => !expected.includes(key))) {
    throw new Error(
      "Firewalled audit payload may contain only taskSpec, gitDiff, domainInvariants, and deterministicGateSummary",
    );
  }
  if (
    typeof record.taskSpec !== "string" ||
    typeof record.gitDiff !== "string" ||
    typeof record.deterministicGateSummary !== "string" ||
    !Array.isArray(record.domainInvariants) ||
    record.domainInvariants.some((entry: unknown) => typeof entry !== "string")
  ) {
    throw new Error("Firewalled audit payload fields have invalid types");
  }
  return {
    taskSpec: record.taskSpec,
    gitDiff: record.gitDiff,
    domainInvariants: record.domainInvariants as string[],
    deterministicGateSummary: record.deterministicGateSummary,
  };
}

function requireStringField(record: Record<string, unknown>, field: string): string {
  const value = record[field];
  if (typeof value !== "string")
    throw new Error(`Adversarial Auditor field '${field}' must be a string`);
  return value;
}

export function parseAdversarialAuditVerdict(value: unknown): AdversarialAuditVerdict {
  let decoded = value;
  if (typeof value === "string") {
    try {
      decoded = JSON.parse(value) as unknown;
    } catch {
      throw new Error("Adversarial Auditor response is not valid JSON");
    }
  }
  if (decoded === null || typeof decoded !== "object" || Array.isArray(decoded)) {
    throw new Error("Adversarial Auditor response must be a JSON object");
  }
  const record = decoded as Record<string, unknown>;
  const fields = ["status", "reviewerHarness", "reviewerModelId", "findings"];
  if (
    Object.keys(record).length !== fields.length ||
    Object.keys(record).some((key) => !fields.includes(key))
  ) {
    throw new Error("Adversarial Auditor response contains unsupported fields");
  }
  if (
    (record.status !== "VERIFIED" && record.status !== "REJECTED") ||
    typeof record.reviewerHarness !== "string" ||
    typeof record.reviewerModelId !== "string" ||
    !Array.isArray(record.findings)
  ) {
    throw new Error("Adversarial Auditor response has an invalid schema");
  }
  const findings: AdversarialFinding[] = record.findings.map((entry: unknown) => {
    const finding =
      entry !== null && typeof entry === "object" && !Array.isArray(entry)
        ? (entry as Record<string, unknown>)
        : null;
    const findingFields = ["severity", "file", "lineOrAstNode", "proof", "requiredFix"];
    if (
      !finding ||
      Object.keys(finding).length !== findingFields.length ||
      Object.keys(finding).some((key) => !findingFields.includes(key)) ||
      (finding.severity !== "BLOCKING_FAULT" &&
        finding.severity !== "EDGE_CASE_RISK" &&
        finding.severity !== "NIT") ||
      typeof finding.file !== "string" ||
      typeof finding.lineOrAstNode !== "string" ||
      typeof finding.proof !== "string" ||
      typeof finding.requiredFix !== "string"
    ) {
      throw new Error("Adversarial Auditor finding has an invalid schema");
    }
    return {
      severity: finding.severity,
      file: requireStringField(finding, "file"),
      lineOrAstNode: requireStringField(finding, "lineOrAstNode"),
      proof: requireStringField(finding, "proof"),
      requiredFix: requireStringField(finding, "requiredFix"),
    };
  });
  const hasBlockingFault = findings.some((finding) => finding.severity === "BLOCKING_FAULT");
  return {
    status: hasBlockingFault ? "REJECTED" : record.status,
    reviewerHarness: requireStringField(record, "reviewerHarness"),
    reviewerModelId: requireStringField(record, "reviewerModelId"),
    findings,
  };
}

function deterministicGateSummary(report: ValidationReport): string {
  return report.checks
    .map(
      (check) =>
        `${check.passed ? "PASS" : "FAIL"} ${check.stage}: ${check.command} (exit ${check.exitCode})\n${check.failuresOnly ?? check.stdout ?? check.stderr}`,
    )
    .join("\n")
    .slice(0, 12_000);
}

export async function validateThenAudit(options: {
  readonly worktreePath: string;
  readonly taskSpec: string;
  readonly domainInvariants: readonly string[];
  readonly generatorProvider: ProviderSelection | HeadlessProvider | string;
  readonly taskId?: string;
  readonly passCommand?: string;
  readonly validator?: ValidationEngine;
  readonly invokeAuditor: (
    payload: FirewalledAuditPayload,
    route: ModelRoute,
  ) => Promise<AuditorInvocationOutput>;
}): Promise<TwoStageAuditResult> {
  const validator = options.validator ?? new DefaultValidationEngine();
  const stageA = await validator.validate(options.worktreePath, options.passCommand);
  if (!stageA.passed) {
    return {
      status: "DETERMINISTIC_FAILED",
      stageA,
      deterministicFailureDigest: validator.extractDiagnostics(stageA, 400),
    };
  }
  const root = path.resolve(options.worktreePath);
  const diff = spawnSync("git", ["diff", "--binary", "HEAD"], {
    cwd: root,
    encoding: "utf8",
    timeout: 10_000,
    maxBuffer: 32 * 1024 * 1024,
  });
  if (diff.status !== 0 || diff.error) {
    return {
      status: "AUDIT_BLOCKED",
      stageA,
      error: diff.error?.message ?? "Could not capture raw worktree diff",
    };
  }
  const payload = buildFirewalledAuditPayload({
    taskSpec: options.taskSpec,
    gitDiff: diff.stdout,
    domainInvariants: [...options.domainInvariants],
    deterministicGateSummary: deterministicGateSummary(stageA),
  });
  const route = resolveOrthogonalAuditor(options.generatorProvider);
  const invocation = await options.invokeAuditor(payload, route);
  const verdict = parseAdversarialAuditVerdict(invocation.output);
  if (verdict.reviewerHarness !== route.harness || verdict.reviewerModelId !== route.modelId) {
    throw new Error("Auditor verdict identity does not match the orthogonal reviewer route");
  }
  const tokenCost = {
    inputTokens: invocation.inputTokens ?? countTokens(JSON.stringify(payload)),
    outputTokens: invocation.outputTokens ?? countTokens(invocation.output),
  };
  recordAdversarialAuditInvocation({
    workspaceRoot: root,
    taskId: options.taskId ?? "unknown-task",
    reviewerModelId: route.modelId,
    blockingFaultsCaught: verdict.findings.filter(
      (finding) => finding.severity === "BLOCKING_FAULT",
    ).length,
    falsePositivesDisprovenByTest: invocation.falsePositivesDisprovenByTest ?? 0,
    tokenCost,
  });
  return { status: "AUDITED", stageA, verdict, reviewerRoute: route, tokenCost };
}

export function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "");
}

export class DefaultValidationEngine implements ValidationEngine {
  private readonly defaultTimeoutMs: number;

  constructor(defaultTimeoutMs = 120000) {
    this.defaultTimeoutMs = defaultTimeoutMs;
  }

  async validate(worktreePath: string, passCommand?: string): Promise<ValidationReport> {
    const t0 = Date.now();
    const checks: ValidationCheckResult[] = [];
    const root = path.resolve(worktreePath);

    // 1. Run .helix/gate.mjs if available
    const gatePath = path.join(root, ".helix", "gate.mjs");
    const gateFound = fs.existsSync(gatePath);

    if (gateFound) {
      const gateRes = spawnSync("node", [".helix/gate.mjs", "--json"], {
        cwd: root,
        encoding: "utf8",
        timeout: this.defaultTimeoutMs,
        maxBuffer: 64 * 1024 * 1024,
      });

      let parsedGate: {
        ok?: boolean;
        steps?: Array<{
          name: string;
          status: string;
          command?: string | null;
          code?: number | string;
          ms?: number;
          tail?: string;
        }>;
      } | null = null;

      try {
        parsedGate = JSON.parse(gateRes.stdout || "{}");
      } catch {
        // Fallback: gate output was not valid JSON
      }

      if (parsedGate && Array.isArray(parsedGate.steps)) {
        for (const step of parsedGate.steps) {
          let stage: ValidationStage = "tests";
          if (step.name === "secrets") stage = "secrets";
          else if (step.name === "lint") stage = "lint";
          else if (step.name === "typecheck") stage = "typecheck";

          const passed = step.status === "pass" || step.status === "skip";
          const exitCode = typeof step.code === "number" ? step.code : passed ? 0 : 1;

          checks.push({
            stage,
            passed,
            command: step.command || `gate:${step.name}`,
            exitCode,
            durationMs: step.ms ?? 0,
            stdout: step.tail || "",
            stderr: passed ? "" : step.tail || "",
            failuresOnly: passed ? undefined : step.tail,
          });
        }
      } else {
        // Raw gate run without valid JSON
        const passed = gateRes.status === 0;
        checks.push({
          stage: "tests",
          passed,
          command: "node .helix/gate.mjs",
          exitCode: gateRes.status ?? (gateRes.error ? 1 : 0),
          durationMs: Date.now() - t0,
          stdout: gateRes.stdout || "",
          stderr: gateRes.stderr || (gateRes.error ? gateRes.error.message : ""),
          failuresOnly: passed ? undefined : gateRes.stderr || gateRes.stdout,
        });
      }
    }

    // 2. Run custom passCommand if provided
    if (passCommand && passCommand.trim().length > 0) {
      const cmdStart = Date.now();
      const cmdRes = spawnSync(passCommand.trim(), {
        shell: true,
        cwd: root,
        encoding: "utf8",
        timeout: this.defaultTimeoutMs,
        maxBuffer: 64 * 1024 * 1024,
      });

      const passed = cmdRes.status === 0;
      const cleanStdErr = stripAnsi(cmdRes.stderr || "");
      const cleanStdOut = stripAnsi(cmdRes.stdout || "");

      checks.push({
        stage: "tests",
        passed,
        command: passCommand.trim(),
        exitCode: cmdRes.status ?? (cmdRes.error ? 1 : 0),
        durationMs: Date.now() - cmdStart,
        stdout: cleanStdOut,
        stderr: cleanStdErr,
        failuresOnly: passed ? undefined : (cleanStdErr || cleanStdOut).slice(-2000),
      });
    }

    // If neither gate nor passCommand ran, consider pass or perform fallback check
    if (checks.length === 0) {
      checks.push({
        stage: "tests",
        passed: true,
        command: "mechanical-check-noop",
        exitCode: 0,
        durationMs: 0,
        stdout: "No verification commands configured or detected.",
        stderr: "",
      });
    }

    const failedCheck = checks.find((c) => !c.passed);
    const passed = failedCheck === undefined;
    const failingStage = failedCheck?.stage;

    const report: ValidationReport = {
      passed,
      durationMs: Date.now() - t0,
      checks,
      failingStage,
    };

    if (!passed) {
      report.diagnosticsExcerpt = this.extractDiagnostics(report);
    }

    return report;
  }

  extractDiagnostics(report: ValidationReport, maxTokens = 400): string {
    if (report.passed) return "";

    const maxChars = maxTokens * 4; // ~4 chars per token approximation
    const failingChecks = report.checks.filter((c) => !c.passed);

    const lines: string[] = [
      `Mechanical Validation Failed at stage: ${report.failingStage || "unknown"}`,
    ];

    for (const check of failingChecks) {
      lines.push(
        `\n[Stage: ${check.stage.toUpperCase()}] Command: ${check.command} (exit ${check.exitCode})`,
      );
      const details = check.failuresOnly || check.stderr || check.stdout;
      if (details) {
        const clean = stripAnsi(details).trim();
        // Extract narrow failure lines, omitting empty lines
        const tailLines = clean
          .split("\n")
          .filter((l) => l.trim().length > 0)
          .slice(-15)
          .join("\n");
        lines.push(tailLines);
      }
    }

    let result = lines.join("\n");
    if (result.length > maxChars) {
      result = result.slice(0, maxChars) + "\n...[diagnostic output truncated to token budget]";
    }

    return result;
  }
}

/** Optional cross-model Stage B layered after the deterministic validation engine. */
export class CrossModelAdversarialValidationEngine implements ValidationEngine {
  private readonly deterministic: ValidationEngine;
  private readonly auditOptions: {
    readonly taskId: string;
    readonly taskSpec: string;
    readonly domainInvariants: readonly string[];
    readonly generatorProvider: ProviderSelection | HeadlessProvider | string;
    readonly invokeAuditor: (
      payload: FirewalledAuditPayload,
      route: ModelRoute,
    ) => Promise<AuditorInvocationOutput>;
  };

  constructor(options: {
    readonly taskId: string;
    readonly taskSpec: string;
    readonly domainInvariants: readonly string[];
    readonly generatorProvider: ProviderSelection | HeadlessProvider | string;
    readonly invokeAuditor: (
      payload: FirewalledAuditPayload,
      route: ModelRoute,
    ) => Promise<AuditorInvocationOutput>;
    readonly deterministic?: ValidationEngine;
  }) {
    this.deterministic = options.deterministic ?? new DefaultValidationEngine();
    this.auditOptions = {
      taskId: options.taskId,
      taskSpec: options.taskSpec,
      domainInvariants: options.domainInvariants,
      generatorProvider: options.generatorProvider,
      invokeAuditor: options.invokeAuditor,
    };
  }

  async validate(worktreePath: string, passCommand?: string): Promise<ValidationReport> {
    try {
      const result = await validateThenAudit({
        ...this.auditOptions,
        worktreePath,
        passCommand,
        validator: this.deterministic,
      });
      if (result.status === "DETERMINISTIC_FAILED") return result.stageA;
      if (result.status === "AUDIT_BLOCKED") {
        return this.auditFailure(
          result.stageA,
          result.error ?? "Auditor could not verify the diff",
          "AUDITOR_UNAVAILABLE",
        );
      }
      if (!result.verdict || !result.tokenCost) {
        return this.auditFailure(
          result.stageA,
          "Auditor response was incomplete",
          "INVALID_AUDITOR_RESULT",
        );
      }
      const passed = result.verdict.status === "VERIFIED";
      const summary = JSON.stringify(result.verdict);
      const auditCheck: ValidationCheckResult = {
        stage: "adversarial",
        passed,
        command: `cross-model audit: ${result.verdict.reviewerHarness}/${result.verdict.reviewerModelId}`,
        exitCode: passed ? 0 : 1,
        durationMs: 0,
        stdout: summary,
        stderr: "",
        failuresOnly: passed ? undefined : summary,
      };
      const report: ValidationReport = {
        ...result.stageA,
        passed,
        durationMs: result.stageA.durationMs,
        checks: [...result.stageA.checks, auditCheck],
        adversarialAudit: result.verdict,
        auditorTokenCost: result.tokenCost,
      };
      if (!passed) {
        report.failingStage = "adversarial";
        report.diagnosticsExcerpt = this.extractDiagnostics(report, 600);
      }
      return report;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const stageA = await this.deterministic.validate(worktreePath, passCommand);
      if (!stageA.passed) return stageA;
      return this.auditFailure(stageA, message, "AUDITOR_PROTOCOL_ERROR");
    }
  }

  extractDiagnostics(report: ValidationReport, maxTokens?: number): string {
    return this.deterministic.extractDiagnostics(report, maxTokens);
  }

  private auditFailure(report: ValidationReport, message: string, code: string): ValidationReport {
    const failure: ValidationCheckResult = {
      stage: "adversarial",
      passed: false,
      command: "cross-model audit",
      exitCode: 1,
      durationMs: 0,
      stdout: "",
      stderr: message,
      failuresOnly: `${code}: ${message}`,
    };
    const failed: ValidationReport = {
      ...report,
      passed: false,
      checks: [...report.checks, failure],
      failingStage: "adversarial",
      diagnosticsExcerpt: `${code}: ${message}`,
    };
    return failed;
  }
}
