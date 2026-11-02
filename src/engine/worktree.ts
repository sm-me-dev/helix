// Helix Ephemeral Git Worktree Manager (Phase 03 - ADR-003)
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export type WorktreeProvisionResult = {
  worktreePath: string;
  branch: string;
  isEphemeral: boolean;
};

export type WorktreeDiffResult = {
  diff: string;
  affectedFiles: string[];
};

export class GitWorktreeManager {
  private readonly storageDir: string;

  constructor(storageDir?: string) {
    this.storageDir = storageDir ? path.resolve(storageDir) : path.resolve(".helix-work/worktrees");
  }

  private runGit(cwd: string, args: string[]): { code: number; stdout: string; stderr: string } {
    const res = spawnSync("git", args, {
      cwd,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
    return {
      code: res.status ?? (res.error ? 1 : 0),
      stdout: res.stdout || "",
      stderr: res.stderr || (res.error ? res.error.message : ""),
    };
  }

  private isGitRepo(dir: string): boolean {
    const res = this.runGit(dir, ["rev-parse", "--is-inside-work-tree"]);
    return res.code === 0 && res.stdout.trim() === "true";
  }

  /**
   * Provisions an ephemeral git worktree branched off current HEAD.
   * If git worktree is unavailable or fails, falls back gracefully.
   */
  async createWorktree(
    repoRoot: string,
    taskId: string,
    branchName?: string,
  ): Promise<WorktreeProvisionResult> {
    const root = path.resolve(repoRoot);
    const branch = branchName || `helix/${taskId}`;
    const sanitizedId = taskId.replace(/[^a-zA-Z0-9_-]/g, "_");
    const worktreePath = path.join(this.storageDir, sanitizedId);

    if (!fs.existsSync(this.storageDir)) {
      fs.mkdirSync(this.storageDir, { recursive: true });
    }

    if (!this.isGitRepo(root)) {
      // Non-git fallback: work directly in repoRoot or scratch directory
      return {
        worktreePath: root,
        branch: "main",
        isEphemeral: false,
      };
    }

    // Clean up any stale worktree at target path
    if (fs.existsSync(worktreePath)) {
      this.runGit(root, ["worktree", "remove", "--force", worktreePath]);
      if (fs.existsSync(worktreePath)) {
        fs.rmSync(worktreePath, { recursive: true, force: true });
      }
    }
    this.runGit(root, ["worktree", "prune"]);

    // Add worktree with branch
    const addRes = this.runGit(root, ["worktree", "add", "-B", branch, worktreePath, "HEAD"]);

    if (addRes.code !== 0) {
      // Fallback: If worktree add fails (e.g. locked worktree or shallow clone), return repoRoot
      process.stderr.write(
        `[helix worktree] Warning: git worktree add failed: ${addRes.stderr}. Falling back to main workspace.\n`,
      );
      return {
        worktreePath: root,
        branch,
        isEphemeral: false,
      };
    }

    return {
      worktreePath,
      branch,
      isEphemeral: true,
    };
  }

  /**
   * Extracts git diff and modified/untracked file list from worktree.
   */
  async extractDiff(worktreePath: string): Promise<WorktreeDiffResult> {
    if (!fs.existsSync(worktreePath)) {
      return { diff: "", affectedFiles: [] };
    }

    if (!this.isGitRepo(worktreePath)) {
      // Non-git directory fallback: scan files in directory
      const affectedFiles: string[] = [];
      let diff = "";
      const scanDir = (dir: string, base: string) => {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const rel = base ? path.join(base, entry.name) : entry.name;
          const abs = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            if (
              entry.name !== "node_modules" &&
              entry.name !== ".helix-work" &&
              entry.name !== ".git"
            ) {
              scanDir(abs, rel);
            }
          } else if (entry.isFile()) {
            affectedFiles.push(rel);
            try {
              const body = fs.readFileSync(abs, "utf8");
              diff +=
                `\n--- /dev/null\n+++ b/${rel}\n@@ -0,0 +1,${body.split("\n").length} @@\n` +
                body
                  .split("\n")
                  .map((l) => `+${l}`)
                  .join("\n") +
                "\n";
            } catch {
              // Ignore unreadable
            }
          }
        }
      };
      scanDir(worktreePath, "");
      return { diff: diff.trim(), affectedFiles };
    }

    // Get unified diff of tracked changes
    const diffRes = this.runGit(worktreePath, ["diff", "HEAD"]);
    let diff = diffRes.stdout || "";

    // Check status for all modified, added, untracked files
    const statusRes = this.runGit(worktreePath, ["status", "--porcelain=v1"]);
    const affectedFiles: string[] = [];

    if (statusRes.code === 0 && statusRes.stdout) {
      const lines = statusRes.stdout.split("\n");
      for (const line of lines) {
        if (!line || line.length < 3) continue;
        const filePath = line.slice(3).trim();
        // Remove trailing quotes or rename pointers
        const cleanPath = filePath.includes("->")
          ? filePath.split("->")[1].trim().replace(/^"|"$/g, "")
          : filePath.replace(/^"|"$/g, "");
        if (cleanPath && !affectedFiles.includes(cleanPath)) {
          affectedFiles.push(cleanPath);
        }

        // If file is untracked (??), generate synthetic diff so diff is not empty
        if (line.startsWith("??")) {
          const abs = path.join(worktreePath, cleanPath);
          try {
            if (fs.existsSync(abs) && fs.statSync(abs).isFile()) {
              const body = fs.readFileSync(abs, "utf8");
              diff +=
                `\n--- /dev/null\n+++ b/${cleanPath}\n@@ -0,0 +1,${body.split("\n").length} @@\n` +
                body
                  .split("\n")
                  .map((l) => `+${l}`)
                  .join("\n") +
                "\n";
            }
          } catch {
            // Ignore unreadable untracked file
          }
        }
      }
    }

    return {
      diff: diff.trim(),
      affectedFiles,
    };
  }

  /**
   * Cleans up the ephemeral worktree and optionally removes the associated branch.
   */
  async cleanupWorktree(
    repoRoot: string,
    worktreePath: string,
    branch?: string,
    removeBranch = true,
  ): Promise<void> {
    const root = path.resolve(repoRoot);

    if (this.isGitRepo(root) && fs.existsSync(worktreePath)) {
      this.runGit(root, ["worktree", "remove", "--force", worktreePath]);
    }

    if (fs.existsSync(worktreePath)) {
      try {
        fs.rmSync(worktreePath, { recursive: true, force: true });
      } catch {
        // Ignore deletion errors on transient directories
      }
    }

    if (this.isGitRepo(root)) {
      this.runGit(root, ["worktree", "prune"]);
      if (branch && removeBranch) {
        this.runGit(root, ["branch", "-D", branch]);
      }
    }
  }
}
