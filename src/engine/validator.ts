// Helix Validation Engine & Diagnostic Extractor (Phase 03 - ADR-002, ADR-006)
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type {
  ValidationCheckResult,
  ValidationEngine,
  ValidationReport,
  ValidationStage,
} from "./types.ts";

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
