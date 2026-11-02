// Helix Context Builder Integration & Knowledge Adapter (Phase 11.5)
import { AdaptiveKnowledgeRetriever } from "./retriever.ts";
import type { KnowledgeContextPackage, TaskRetrievalContext } from "./types.ts";

export interface KnowledgeContextAdapterOptions {
  retriever?: AdaptiveKnowledgeRetriever;
  enabled?: boolean;
  defaultBudget?: number;
}

export class KnowledgeContextAdapter {
  private readonly retriever?: AdaptiveKnowledgeRetriever;
  private readonly enabled: boolean;
  private readonly defaultBudget: number;

  constructor(options?: KnowledgeContextAdapterOptions) {
    this.retriever = options?.retriever;
    this.enabled = options?.enabled !== false && !!options?.retriever;
    this.defaultBudget = options?.defaultBudget || 2000;
  }

  isEnabled(): boolean {
    return this.enabled && !!this.retriever;
  }

  /**
   * Retrieves relevant project knowledge and formats it as a clean Markdown context block.
   * Fails safe: if retrieval fails or is disabled, returns an empty or diagnostic package.
   */
  async buildKnowledgeContext(
    context: TaskRetrievalContext,
  ): Promise<{ markdown: string; package?: KnowledgeContextPackage; warning?: string }> {
    if (!this.isEnabled() || !this.retriever) {
      return { markdown: "" };
    }

    try {
      const budget = context.tokenBudget || this.defaultBudget;
      const pkg = await this.retriever.retrieve({
        ...context,
        tokenBudget: budget,
      });

      return {
        markdown: pkg.markdownSection,
        package: pkg,
      };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      return {
        markdown: "",
        warning: `Project knowledge retrieval failed gracefully: ${errorMsg}`,
      };
    }
  }
}
