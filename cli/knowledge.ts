// helix knowledge — Adaptive Project Knowledge System (APKS) CLI
import { resolve } from "node:path";
import { DomainDiscovery } from "../src/knowledge/discovery.ts";
import { KnowledgeExporter } from "../src/knowledge/export.ts";
import { SQLiteKnowledgeIndex } from "../src/knowledge/index.ts";
import {
  DomainRestructurer,
  KnowledgeAuditor,
  KnowledgeValidator,
} from "../src/knowledge/maintenance.ts";
import { KnowledgeRepository } from "../src/knowledge/repository.ts";
import { AdaptiveKnowledgeRetriever } from "../src/knowledge/retriever.ts";

function dirOf(args: string[]): string {
  const valueFlags = new Set(["targets", "role", "budget", "limit", "out"]);
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith("-")) {
      const name = a.replace(/^--?/, "").split("=")[0];
      if (valueFlags.has(name) && !a.includes("=")) {
        i++; // skip flag value
      }
      continue;
    }
    return resolve(a);
  }
  return resolve(".");
}

function flag(args: string[], name: string): string | null {
  for (let i = 0; i < args.length; i++) {
    if (args[i] === `--${name}`) return args[i + 1] ?? null;
    if (args[i].startsWith(`--${name}=`)) return args[i].slice(name.length + 3);
  }
  return null;
}

function has(args: string[], name: string): boolean {
  return args.includes(`--${name}`);
}

export function knowledgeUsage(): string {
  return `helix knowledge — Adaptive Project Knowledge System (APKS)

  helix knowledge status [dir] [--json]                 view knowledge base statistics and index status
  helix knowledge discover [dir] [--save] [--json]      scan project, decompose domains & emit overview
  helix knowledge index [dir] [--rebuild] [--json]      incrementally index canonical files into SQLite FTS5
  helix knowledge search <query> [dir] [--limit n]      lexical BM25 search across indexed knowledge
  helix knowledge retrieve <prompt> [dir] [--targets f] test dynamic task-aware knowledge retrieval
  helix knowledge validate [dir] [--json]               verify integrity, source links & detect stale items
  helix knowledge audit [dir] [--json]                  generate comprehensive knowledge health report
  helix knowledge restructure [dir] [--json]            evaluate domain complexity & restructuring signals
  helix knowledge export <domain> [dir] [--out dir]     export domain knowledge as portable SKILL.md
`;
}

export async function cmdKnowledge(argv: string[]): Promise<number> {
  const [sub, ...rest] = argv;

  if (!sub || sub === "-h" || sub === "--help" || sub === "help") {
    process.stdout.write(knowledgeUsage());
    return 0;
  }

  const jsonMode = has(rest, "json");

  switch (sub) {
    case "status": {
      const dir = dirOf(rest);
      const repo = new KnowledgeRepository(dir);
      const dbPath = SQLiteKnowledgeIndex.defaultPath(dir);
      const index = new SQLiteKnowledgeIndex(dbPath);

      const domains = repo.loadAllDomains();
      const items = repo.loadAllItems();
      const relationships = repo.loadAllRelationships();
      const overview = repo.loadProjectOverview();

      index.close();

      if (jsonMode) {
        process.stdout.write(
          JSON.stringify(
            {
              workspace: dir,
              hasOverview: !!overview,
              domainsCount: domains.length,
              itemsCount: items.length,
              relationshipsCount: relationships.length,
              dbPath,
            },
            null,
            2,
          ) + "\n",
        );
        return 0;
      }

      console.log(`\n=== Helix Adaptive Project Knowledge System (APKS) ===`);
      console.log(`Workspace:     ${dir}`);
      console.log(
        `Overview:      ${overview ? "Configured (.helix/knowledge/project.md)" : "Not initialized"}`,
      );
      console.log(`Domains:       ${domains.length} discovered`);
      console.log(`Knowledge:     ${items.length} canonical records`);
      console.log(`Relationships: ${relationships.length} explicit graph edges`);
      console.log(`Index SQLite:  ${dbPath}\n`);

      if (domains.length > 0) {
        console.log(`Discovered Domains:`);
        for (const d of domains) {
          const itemCount = items.filter((i) => i.domainId === d.id).length;
          console.log(
            `  - [${d.id}] ${d.name} (${itemCount} items, ${d.sourcePaths.length} source paths)`,
          );
        }
        console.log("");
      }

      return 0;
    }

    case "discover": {
      const dir = dirOf(rest);
      const repo = new KnowledgeRepository(dir);
      const discovery = new DomainDiscovery(dir);
      const shouldSave = has(rest, "save");

      const summary = shouldSave ? discovery.saveDiscoveredKnowledge(repo) : discovery.discover();

      if (jsonMode) {
        process.stdout.write(JSON.stringify(summary, null, 2) + "\n");
        return 0;
      }

      console.log(`\n=== Project Discovery: ${summary.projectName} ===`);
      console.log(`Type:       ${summary.projectType}`);
      console.log(`Languages:  ${summary.primaryLanguages.join(", ")}`);
      console.log(`Manifests:  ${summary.manifests.join(", ") || "None"}`);
      console.log(`Domains:    ${summary.discoveredDomains.length} discovered`);

      for (const d of summary.discoveredDomains) {
        console.log(`  • ${d.name} (${d.id}): ${d.description}`);
        console.log(`    Paths: ${d.sourcePaths.slice(0, 3).join(", ")}`);
      }

      if (shouldSave) {
        console.log(`\nDiscovered knowledge saved to .helix/knowledge/\n`);
      } else {
        console.log(`\n(Dry run: pass --save to write canonical files to .helix/knowledge/)\n`);
      }

      return 0;
    }

    case "index": {
      const dir = dirOf(rest);
      const repo = new KnowledgeRepository(dir);
      const forceRebuild = has(rest, "rebuild");
      const dbPath = SQLiteKnowledgeIndex.defaultPath(dir);
      const index = new SQLiteKnowledgeIndex(dbPath);

      const res = forceRebuild ? index.rebuildIndex(repo) : index.incrementalIndex(repo);
      index.close();

      if (jsonMode) {
        process.stdout.write(JSON.stringify(res, null, 2) + "\n");
        return 0;
      }

      console.log(`\n=== SQLite FTS5 Indexing Complete ===`);
      console.log(`Mode:                  ${forceRebuild ? "Full Rebuild" : "Incremental Sync"}`);
      console.log(`Domains Indexed:       ${res.domainsIndexed}`);
      console.log(`Items Indexed:         ${res.itemsIndexed}`);
      console.log(`Relationships Indexed: ${res.relationshipsIndexed}`);
      console.log(`Database Location:     ${dbPath}\n`);

      return 0;
    }

    case "search": {
      const query = rest.find((a) => !a.startsWith("-"));
      if (!query) {
        console.error("Error: search query required. Usage: helix knowledge search <query>");
        return 2;
      }

      const dir = dirOf(rest.filter((a) => a !== query));
      const limitStr = flag(rest, "limit");
      const limit = limitStr ? parseInt(limitStr, 10) : 10;
      const dbPath = SQLiteKnowledgeIndex.defaultPath(dir);
      const index = new SQLiteKnowledgeIndex(dbPath);

      const results = index.searchFts(query, limit);
      index.close();

      if (jsonMode) {
        process.stdout.write(JSON.stringify(results, null, 2) + "\n");
        return 0;
      }

      console.log(`\n=== Search Results for "${query}" (${results.length} hits) ===`);
      if (results.length === 0) {
        console.log("No matching knowledge records found.");
      } else {
        for (const r of results) {
          console.log(`\n• [${r.type.toUpperCase()}] ${r.title} (${r.id})`);
          console.log(
            `  Domain:  ${r.domainId} · Status: ${r.status} · BM25: ${r.bm25Score.toFixed(4)}`,
          );
          console.log(`  Source:  ${r.sourcePath}`);
          console.log(`  Snippet: ${r.snippet}`);
        }
      }
      console.log("");
      return 0;
    }

    case "retrieve": {
      const prompt = rest.find((a) => !a.startsWith("-"));
      if (!prompt) {
        console.error("Error: task prompt required. Usage: helix knowledge retrieve <prompt>");
        return 2;
      }

      const dir = dirOf(rest.filter((a) => a !== prompt));
      const targetsStr = flag(rest, "targets");
      const targetFiles = targetsStr ? targetsStr.split(",").map((s) => s.trim()) : [];
      const role = flag(rest, "role") || "implementer";
      const budgetStr = flag(rest, "budget");
      const tokenBudget = budgetStr ? parseInt(budgetStr, 10) : 2500;

      const dbPath = SQLiteKnowledgeIndex.defaultPath(dir);
      const index = new SQLiteKnowledgeIndex(dbPath);
      const retriever = new AdaptiveKnowledgeRetriever({ index, defaultTokenBudget: tokenBudget });

      const pkg = await retriever.retrieve({
        taskId: `cli-${Date.now().toString(36)}`,
        prompt,
        targetFiles,
        agentRole: role,
        tokenBudget,
      });

      index.close();

      if (jsonMode) {
        process.stdout.write(JSON.stringify(pkg, null, 2) + "\n");
        return 0;
      }

      console.log(`\n=== Dynamic APKS Context Retrieval ===`);
      console.log(`Prompt:          "${prompt}"`);
      console.log(`Role:            ${role}`);
      console.log(`Target Files:    ${targetFiles.join(", ") || "(none)"}`);
      console.log(`Active Domains:  ${pkg.domains.join(", ")}`);
      console.log(`Selected Items:  ${pkg.items.length} (Omitted: ${pkg.omittedCount})`);
      console.log(`Token Budget:    ${pkg.totalEstimatedTokens} / ${pkg.budget} tokens\n`);

      for (const item of pkg.items) {
        console.log(`• [Score ${item.score}] ${item.item.title} (${item.item.id})`);
        console.log(`  Relevance: ${item.relevanceReason}`);
        console.log(`  Tokens:    ${item.estimatedTokens}`);
      }

      console.log(`\n--- Rendered Markdown Context ---`);
      console.log(pkg.markdownSection);
      console.log("---------------------------------\n");

      return 0;
    }

    case "validate": {
      const dir = dirOf(rest);
      const repo = new KnowledgeRepository(dir);
      const validator = new KnowledgeValidator(repo);

      const result = validator.validate();

      if (jsonMode) {
        process.stdout.write(JSON.stringify(result, null, 2) + "\n");
        return result.valid ? 0 : 1;
      }

      console.log(`\n=== Knowledge Validation: ${result.valid ? "PASSED" : "FAILED"} ===`);
      console.log(`Errors:   ${result.errors.length}`);
      console.log(`Warnings: ${result.warnings.length}`);
      console.log(`Stale:    ${result.staleCount}`);

      if (result.errors.length > 0) {
        console.log(`\nErrors:`);
        for (const e of result.errors) console.log(`  ✖ ${e}`);
      }

      if (result.warnings.length > 0) {
        console.log(`\nWarnings:`);
        for (const w of result.warnings) console.log(`  ⚠ ${w}`);
      }

      console.log("");
      return result.valid ? 0 : 1;
    }

    case "audit": {
      const dir = dirOf(rest);
      const repo = new KnowledgeRepository(dir);
      const auditor = new KnowledgeAuditor(repo);

      const report = auditor.audit();

      if (jsonMode) {
        process.stdout.write(JSON.stringify(report, null, 2) + "\n");
        return 0;
      }

      console.log(`\n=== Helix APKS Health Audit ===`);
      console.log(`Timestamp:        ${report.timestamp}`);
      console.log(`Domains Count:    ${report.domainsCount}`);
      console.log(`Items Count:      ${report.itemsCount}`);
      console.log(`Relationships:    ${report.relationshipsCount}`);
      console.log(`Freshness:        ${report.indexFreshness.isFresh ? "Fresh" : "Out of sync"}`);

      console.log(`\nVerification Breakdown:`);
      for (const [status, count] of Object.entries(report.statusBreakdown)) {
        console.log(`  - ${status.padEnd(12)}: ${count}`);
      }

      console.log(`\nRecommendations:`);
      for (const r of report.recommendations) {
        console.log(`  • ${r}`);
      }
      console.log("");
      return 0;
    }

    case "restructure": {
      const dir = dirOf(rest);
      const repo = new KnowledgeRepository(dir);
      const restructurer = new DomainRestructurer(repo);

      const proposals = restructurer.evaluateRestructuringSignals();

      if (jsonMode) {
        process.stdout.write(JSON.stringify(proposals, null, 2) + "\n");
        return 0;
      }

      console.log(`\n=== Domain Restructuring Evaluation ===`);
      if (proposals.length === 0) {
        console.log(
          `No domain restructuring currently warranted. Domain sizes and coupling remain healthy.\n`,
        );
      } else {
        console.log(`Generated ${proposals.length} restructuring proposals:`);
        for (const p of proposals) {
          console.log(`\nProposal: ${p.id} (${p.action.toUpperCase()})`);
          console.log(`Domain:   ${p.domainId}`);
          console.log(`Reason:   ${p.reason}`);
          console.log(`Signals:  ${p.signals.join("; ")}`);
        }
        console.log("");
      }
      return 0;
    }

    case "export": {
      const domain = rest.find((a) => !a.startsWith("-"));
      if (!domain) {
        console.error(
          "Error: domain ID required. Usage: helix knowledge export <domain> [--out dir]",
        );
        return 2;
      }

      const dir = dirOf(rest.filter((a) => a !== domain));
      const outDir = flag(rest, "out") || resolve(dir, ".agents", "skills");
      const repo = new KnowledgeRepository(dir);
      const exporter = new KnowledgeExporter(repo);

      try {
        const res = exporter.exportDomainToSkill(domain, outDir);
        if (jsonMode) {
          process.stdout.write(JSON.stringify(res, null, 2) + "\n");
          return 0;
        }
        console.log(`\nDomain "${domain}" successfully exported to skill:`);
        console.log(`  Path: ${res.skillPath}\n`);
        return 0;
      } catch (err) {
        console.error(`Export failed: ${err instanceof Error ? err.message : String(err)}`);
        return 1;
      }
    }

    default: {
      console.error(`Unknown subcommand: ${sub}\n`);
      process.stdout.write(knowledgeUsage());
      return 2;
    }
  }
}
