// Helix Knowledge Export to Skills & Agent Formats (Phase 11.12)
import fs from "node:fs";
import path from "node:path";
import { KnowledgeRepository } from "./repository.ts";
import { serializeFrontmatter } from "./repository.ts";

export class KnowledgeExporter {
  private readonly repository: KnowledgeRepository;

  constructor(repository: KnowledgeRepository) {
    this.repository = repository;
  }

  /**
   * Exports a domain's workflows and architecture as a portable SKILL.md.
   */
  exportDomainToSkill(
    domainId: string,
    outputDir: string,
  ): { skillPath: string; exportedFiles: string[] } {
    const domain = this.repository.loadAllDomains().find((d) => d.id === domainId);
    if (!domain) {
      throw new Error(`Domain not found: ${domainId}`);
    }

    const items = this.repository.loadAllItems().filter((i) => i.domainId === domainId);
    const targetDir = path.resolve(outputDir, `skill-${domainId}`);
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    // Build SKILL.md
    const frontmatter = {
      name: `helix-${domain.id}`,
      description: domain.description,
      version: "1.0.0",
      keywords: domain.keywords || [],
    };

    const lines: string[] = [
      `# Helix Skill: ${domain.name}`,
      "",
      domain.description,
      "",
      "## Associated Source Files",
      ...domain.sourcePaths.map((p) => `- \`${p}\``),
      "",
      "## Domain Architectural Knowledge",
    ];

    for (const item of items) {
      lines.push(
        `### ${item.title} (${item.type})`,
        `Status: ${item.status}`,
        "",
        item.content,
        "",
      );
    }

    const skillContent = serializeFrontmatter(frontmatter, lines.join("\n"));
    const skillPath = path.join(targetDir, "SKILL.md");
    fs.writeFileSync(skillPath, skillContent, "utf8");

    return {
      skillPath,
      exportedFiles: [skillPath],
    };
  }
}
