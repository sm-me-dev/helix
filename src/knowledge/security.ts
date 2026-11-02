// Helix APKS Security, Secret Exclusion & Path Traversal Guard (Phase 11.11)
import fs from "node:fs";
import path from "node:path";
import { UntrustedContentHandler } from "../engine/security.ts";

export const EXCLUDED_PATTERNS: RegExp[] = [
  /(^|\/)\.env($|\..*)/i,
  /(^|\/)id_[a-z0-9_]+($|\..*)/i,
  /\.(pem|key|pkcs12|pfx|p12|kdbx)$/i,
  /(^|\/|[-_])(credentials?|secrets?|tokens?|passwords?)([-_]|\.json|\.yml|\.yaml|\.txt|\.env|$)/i,
  /(^|\/)\.git\//,
  /(^|\/)node_modules\//,
  /(^|\/)\.helix-work\//,
  /(^|\/)\.helix\/cache\//,
  /(^|\/)graphify-out\//,
];

export class KnowledgeSecurityGuard {
  private readonly workspaceRoot: string;
  private readonly knowledgeDir: string;
  private gitignorePatterns: RegExp[] = [];

  constructor(workspaceRoot: string, knowledgeDir?: string) {
    this.workspaceRoot = path.resolve(workspaceRoot);
    this.knowledgeDir = knowledgeDir
      ? path.resolve(knowledgeDir)
      : path.join(this.workspaceRoot, ".helix", "knowledge");
    this.loadGitignore();
  }

  private loadGitignore(): void {
    const gitignorePath = path.join(this.workspaceRoot, ".gitignore");
    if (!fs.existsSync(gitignorePath)) return;

    try {
      const content = fs.readFileSync(gitignorePath, "utf8");
      const lines = content.split("\n");
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const escaped = trimmed
          .replace(/[.+^${}()|[\]\\]/g, "\\$&")
          .replace(/\*/g, ".*")
          .replace(/\?/g, ".");
        this.gitignorePatterns.push(new RegExp(`(^|/)${escaped}($|/)`));
      }
    } catch {
      // Ignored if cannot read
    }
  }

  /**
   * Checks whether a file path contains secrets, is ignored, or must not be indexed.
   */
  isExcludedPath(filePath: string): boolean {
    const normalized = filePath.replace(/\\/g, "/");

    for (const pattern of EXCLUDED_PATTERNS) {
      if (pattern.test(normalized)) return true;
    }

    for (const pattern of this.gitignorePatterns) {
      if (pattern.test(normalized)) return true;
    }

    return false;
  }

  /**
   * Ensures a target path is strictly within the allowed base directory, preventing path traversal.
   */
  assertSafePath(targetPath: string, allowedBase: string = this.workspaceRoot): string {
    const resolved = path.resolve(allowedBase, targetPath);
    const resolvedBase = path.resolve(allowedBase);

    if (!resolved.startsWith(resolvedBase + path.sep) && resolved !== resolvedBase) {
      throw new Error(
        `Path traversal blocked: "${targetPath}" escapes allowed boundary "${allowedBase}"`,
      );
    }

    return resolved;
  }

  /**
   * Ensures a write operation targets only the approved knowledge directory.
   */
  assertSafeKnowledgeWrite(targetPath: string): string {
    return this.assertSafePath(targetPath, this.knowledgeDir);
  }

  /**
   * Scans content for prompt injection signatures and secrets, returning sanitized text.
   */
  sanitizeSourceContent(
    content: string,
    sourcePath: string,
  ): { sanitized: string; warnings: string[] } {
    const warnings: string[] = [];

    // 1. Check for hardcoded API keys / tokens
    if (/(?:ghp_[a-zA-Z0-9]{36}|sk-[a-zA-Z0-9]{48}|AKIA[0-9A-Z]{16})/i.test(content)) {
      warnings.push(`Potential secret credential token detected and redacted in ${sourcePath}`);
      content = content.replace(
        /(ghp_[a-zA-Z0-9]{36}|sk-[a-zA-Z0-9]{48}|AKIA[0-9A-Z]{16})/gi,
        "[REDACTED_SECRET]",
      );
    }

    // 2. Scan for prompt injection signatures
    const injectionCheck = UntrustedContentHandler.detectPromptInjection(content);
    if (injectionCheck.detected) {
      warnings.push(
        `Prompt injection attempt neutralized in ${sourcePath}: ${injectionCheck.patterns.join(", ")}`,
      );
      content = injectionCheck.neutralizedText;
    }

    return { sanitized: content, warnings };
  }
}
