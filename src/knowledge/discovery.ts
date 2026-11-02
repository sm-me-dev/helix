// Helix Project Discovery and Domain Decomposition (Phase 11.1)
import fs from "node:fs";
import path from "node:path";
import { KnowledgeRepository } from "./repository.ts";
import { KnowledgeSecurityGuard } from "./security.ts";
import type { DomainRecord, DomainRelationship } from "./types.ts";

export interface ProjectDiscoverySummary {
  projectName: string;
  projectType: string;
  primaryLanguages: string[];
  manifests: string[];
  entryPoints: string[];
  discoveredDomains: DomainRecord[];
  inferredRelationships: DomainRelationship[];
  overviewMarkdown: string;
}

export class ProjectScanner {
  private readonly workspaceRoot: string;
  private readonly security: KnowledgeSecurityGuard;

  constructor(workspaceRoot: string) {
    this.workspaceRoot = path.resolve(workspaceRoot);
    this.security = new KnowledgeSecurityGuard(this.workspaceRoot);
  }

  scanWorkspace(): {
    files: string[];
    directories: string[];
    manifests: string[];
    languages: string[];
  } {
    const files: string[] = [];
    const directories: string[] = [];
    const manifests: string[] = [];
    const languages = new Set<string>();

    const walk = (dir: string): void => {
      let entries: fs.Dirent[] = [];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        const relPath = path.relative(this.workspaceRoot, fullPath).replace(/\\/g, "/");

        if (this.security.isExcludedPath(relPath)) continue;

        if (entry.isDirectory()) {
          directories.push(relPath);
          walk(fullPath);
        } else if (entry.isFile()) {
          files.push(relPath);

          // Language / manifest detection
          if (entry.name === "package.json") {
            manifests.push(relPath);
            languages.add("typescript/javascript");
          } else if (entry.name === "Cargo.toml") {
            manifests.push(relPath);
            languages.add("rust");
          } else if (
            entry.name === "pyproject.toml" ||
            entry.name === "setup.py" ||
            entry.name === "requirements.txt"
          ) {
            manifests.push(relPath);
            languages.add("python");
          } else if (entry.name === "go.mod") {
            manifests.push(relPath);
            languages.add("go");
          }

          if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx"))
            languages.add("typescript");
          if (entry.name.endsWith(".js") || entry.name.endsWith(".mjs"))
            languages.add("javascript");
          if (entry.name.endsWith(".py")) languages.add("python");
          if (entry.name.endsWith(".rs")) languages.add("rust");
          if (entry.name.endsWith(".go")) languages.add("go");
        }
      }
    };

    walk(this.workspaceRoot);

    return {
      files,
      directories,
      manifests,
      languages: Array.from(languages),
    };
  }
}

export class DomainDiscovery {
  private readonly workspaceRoot: string;
  private readonly scanner: ProjectScanner;

  constructor(workspaceRoot: string) {
    this.workspaceRoot = path.resolve(workspaceRoot);
    this.scanner = new ProjectScanner(this.workspaceRoot);
  }

  private addToCluster(
    clusters: Map<
      string,
      {
        name: string;
        desc: string;
        paths: string[];
        keywords: string[];
        deps: string[];
        evidence: string[];
      }
    >,
    id: string,
    info: {
      name: string;
      desc: string;
      path: string;
      keywords: string[];
      deps: string[];
      evidence: string;
    },
  ): void {
    const existing = clusters.get(id);
    if (existing) {
      if (!existing.paths.includes(info.path)) existing.paths.push(info.path);
      for (const k of info.keywords) {
        if (!existing.keywords.includes(k)) existing.keywords.push(k);
      }
      for (const d of info.deps) {
        if (!existing.deps.includes(d)) existing.deps.push(d);
      }
      if (!existing.evidence.includes(info.evidence)) existing.evidence.push(info.evidence);
    } else {
      clusters.set(id, {
        name: info.name,
        desc: info.desc,
        paths: [info.path],
        keywords: [...info.keywords],
        deps: [...info.deps],
        evidence: [info.evidence],
      });
    }
  }

  discover(): ProjectDiscoverySummary {
    const { files, directories, manifests, languages } = this.scanner.scanWorkspace();

    // 1. Determine Project Identity
    let projectName = path.basename(this.workspaceRoot);
    let projectDescription = "Project workspace";
    const packageJsonPath = path.join(this.workspaceRoot, "package.json");
    if (fs.existsSync(packageJsonPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
        if (pkg.name) projectName = pkg.name;
        if (pkg.description) projectDescription = pkg.description;
      } catch {
        // Fallback
      }
    }

    // 2. Identify Entry Points
    const entryPoints: string[] = [];
    const candidates = [
      "src/index.ts",
      "src/main.ts",
      "src/generate.ts",
      "cli/helix.mjs",
      "src/engine/index.ts",
      "main.py",
      "src/main.rs",
      "cmd/main.go",
    ];
    for (const c of candidates) {
      if (files.includes(c)) entryPoints.push(c);
    }

    // 3. Decompose into Meaningful Domains
    const domains: DomainRecord[] = [];
    const relationships: DomainRelationship[] = [];
    const now = new Date().toISOString().split("T")[0];

    // Cluster based on directory topology and file responsibilities
    const domainClusters: Map<
      string,
      {
        name: string;
        desc: string;
        paths: string[];
        keywords: string[];
        deps: string[];
        evidence: string[];
      }
    > = new Map();

    for (const file of files) {
      // Helix-specific and general heuristic mapping
      if (file.startsWith("src/engine/")) {
        const sub = file.replace("src/engine/", "");
        if (sub.startsWith("orchestrator") || sub.startsWith("runner")) {
          this.addToCluster(domainClusters, "orchestration", {
            name: "Agent Orchestration",
            desc: "Multi-agent task routing, lifecycle coordination, handoff protocols, and execution state",
            path: file,
            keywords: [
              "orchestration",
              "multi-agent",
              "handoff",
              "runner",
              "lifecycle",
              "delegation",
            ],
            deps: ["execution-engine", "context-optimization"],
            evidence: `Source file ${file} in engine orchestration subsystem`,
          });
        } else if (sub.startsWith("context") || sub.startsWith("retrieval")) {
          this.addToCluster(domainClusters, "context-optimization", {
            name: "Context & Token Optimization",
            desc: "Progressive context disclosure, token budgeting, excerpt citations, and prompt compression",
            path: file,
            keywords: ["context", "token", "budget", "compaction", "retrieval", "citations"],
            deps: [],
            evidence: `Source file ${file} managing context assembly and token limits`,
          });
        } else if (
          sub.startsWith("security") ||
          sub.startsWith("worktree") ||
          sub.startsWith("tools")
        ) {
          this.addToCluster(domainClusters, "security-isolation", {
            name: "Security & Tool Isolation",
            desc: "Workspace isolation, path containment, ephemeral worktrees, and prompt injection defense",
            path: file,
            keywords: [
              "security",
              "isolation",
              "worktree",
              "containment",
              "injection",
              "permissions",
            ],
            deps: [],
            evidence: `Source file ${file} enforcing isolation and security boundaries`,
          });
        } else if (sub.startsWith("benchmark") || sub.startsWith("experiment")) {
          this.addToCluster(domainClusters, "evaluation-benchmarks", {
            name: "Evaluation & Benchmarks",
            desc: "Repeatable benchmarking, paired stats evaluation, and comparative performance analysis",
            path: file,
            keywords: ["benchmark", "eval", "experiment", "metrics", "paired-stats"],
            deps: ["execution-engine"],
            evidence: `Source file ${file} providing benchmark metrics and runner`,
          });
        } else {
          this.addToCluster(domainClusters, "execution-engine", {
            name: "Core Execution Engine",
            desc: "Deterministic task execution lifecycle, single-agent baseline, and gate verification loops",
            path: file,
            keywords: ["execution", "engine", "lifecycle", "gate", "task", "state"],
            deps: ["security-isolation", "context-optimization"],
            evidence: `Core engine source file ${file}`,
          });
        }
      } else if (file.startsWith("src/adapters/") || file.startsWith("src/platforms")) {
        this.addToCluster(domainClusters, "platform-adapters", {
          name: "Platform Adapters",
          desc: "Target harness adapters for Anthropic Claude, OpenAI Codex, OpenCode, and Antigravity",
          path: file,
          keywords: ["platform", "adapter", "claude", "codex", "opencode", "antigravity", "format"],
          deps: ["pack-generation"],
          evidence: `Platform adapter implementation in ${file}`,
        });
      } else if (
        file.startsWith("src/generate") ||
        file.startsWith("src/crew") ||
        file.startsWith("src/skills") ||
        file.startsWith("src/mcps")
      ) {
        this.addToCluster(domainClusters, "pack-generation", {
          name: "File Pack Generation",
          desc: "Harness pack compiler emitting platform files, gate scripts, and repo outlines",
          path: file,
          keywords: ["generate", "pack", "compiler", "agents.md", "mcp", "crew", "skills"],
          deps: [],
          evidence: `Pack generator core file ${file}`,
        });
      } else if (file.startsWith("cli/")) {
        this.addToCluster(domainClusters, "cli-tooling", {
          name: "CLI & Developer Tooling",
          desc: "Command-line interface commands (init, doctor, measure, gate, run, bench, knowledge)",
          path: file,
          keywords: ["cli", "terminal", "commands", "init", "run", "gate", "measure"],
          deps: ["execution-engine", "pack-generation"],
          evidence: `Command line interface component ${file}`,
        });
      } else if (file.startsWith("src/knowledge/")) {
        this.addToCluster(domainClusters, "knowledge-system", {
          name: "Adaptive Project Knowledge System (APKS)",
          desc: "Persistent structured knowledge, FTS5 SQLite index, dynamic retrieval, and adaptive maintenance",
          path: file,
          keywords: ["knowledge", "apks", "domain", "retrieval", "sqlite", "fts5", "maintenance"],
          deps: ["context-optimization", "security-isolation"],
          evidence: `Knowledge system component ${file}`,
        });
      }
    }

    // Fallback for repositories without specific engine patterns
    if (domainClusters.size === 0) {
      // Create top-level directory domains
      const topDirs = new Set(
        directories
          .map((d) => d.split("/")[0])
          .filter((d) => !d.startsWith(".") && d !== "node_modules"),
      );

      for (const td of topDirs) {
        const clusterFiles = files.filter((f) => f.startsWith(`${td}/`));
        if (clusterFiles.length > 0) {
          domainClusters.set(td, {
            name: td.charAt(0).toUpperCase() + td.slice(1),
            desc: `Subsystem responsible for ${td}`,
            paths: clusterFiles.slice(0, 10),
            keywords: [td],
            deps: [],
            evidence: [`Discovered directory ${td} with ${clusterFiles.length} files`],
          });
        }
      }
    }

    // Build Domain Records & Relationships
    for (const [id, cluster] of domainClusters.entries()) {
      domains.push({
        id,
        name: cluster.name,
        description: cluster.desc,
        sourcePaths: cluster.paths,
        dependencies: cluster.deps,
        keywords: cluster.keywords,
        discoveryEvidence: cluster.evidence,
        createdAt: now,
        updatedAt: now,
      });

      for (const dep of cluster.deps) {
        relationships.push({
          sourceId: id,
          targetId: dep,
          type: "depends_on",
        });
      }
    }

    // Generate Overview Markdown
    const overviewLines: string[] = [
      `# Project Overview: ${projectName}`,
      "",
      projectDescription,
      "",
      "## Primary Technologies",
      `- Languages: ${languages.join(", ") || "Unknown"}`,
      `- Manifests: ${manifests.join(", ") || "None"}`,
      `- Entry Points: ${entryPoints.join(", ") || "None"}`,
      "",
      "## Discovered Domains",
    ];

    for (const dom of domains) {
      overviewLines.push(
        `### ${dom.name} (\`${dom.id}\`)`,
        dom.description,
        `- Source paths: ${dom.sourcePaths.slice(0, 4).join(", ")}${dom.sourcePaths.length > 4 ? ` (and ${dom.sourcePaths.length - 4} more)` : ""}`,
        `- Dependencies: ${dom.dependencies && dom.dependencies.length > 0 ? dom.dependencies.join(", ") : "None"}`,
        "",
      );
    }

    overviewLines.push(
      "## Domain Interaction Map",
      "```text",
      ...domains.map(
        (d) =>
          `${d.id} ${d.dependencies && d.dependencies.length > 0 ? "--> " + d.dependencies.join(", ") : "(standalone)"}`,
      ),
      "```",
    );

    return {
      projectName,
      projectType: manifests.includes("package.json") ? "Node.js/TypeScript" : "Polyglot",
      primaryLanguages: languages,
      manifests,
      entryPoints,
      discoveredDomains: domains,
      inferredRelationships: relationships,
      overviewMarkdown: overviewLines.join("\n"),
    };
  }

  saveDiscoveredKnowledge(repository: KnowledgeRepository): ProjectDiscoverySummary {
    const summary = this.discover();
    repository.ensureDirectories();

    // 1. Save project.md
    repository.saveProjectOverview(summary.overviewMarkdown, {
      project_name: summary.projectName,
      project_type: summary.projectType,
      discovered_at: new Date().toISOString().split("T")[0],
      domain_count: summary.discoveredDomains.length,
    });

    // 2. Save each discovered domain
    for (const domain of summary.discoveredDomains) {
      repository.saveDomain(domain);
    }

    return summary;
  }
}
