import { countTokens } from "../measure.ts";
import type { CostEstimate, ModelProvider, ProviderId, TokenUsage } from "./types.ts";

export type ModelPricing = {
  inputPerMillionUsd: number;
  outputPerMillionUsd: number;
  cachePerMillionUsd: number;
};

export const MODEL_PRICING_TABLE: Record<string, ModelPricing> = {
  // Anthropic
  "claude-3-5-sonnet-20241022": {
    inputPerMillionUsd: 3.0,
    outputPerMillionUsd: 15.0,
    cachePerMillionUsd: 0.3,
  },
  "claude-3-7-sonnet": {
    inputPerMillionUsd: 3.0,
    outputPerMillionUsd: 15.0,
    cachePerMillionUsd: 0.3,
  },
  "claude-3-5-haiku": {
    inputPerMillionUsd: 0.8,
    outputPerMillionUsd: 4.0,
    cachePerMillionUsd: 0.08,
  },
  "claude-3-opus": { inputPerMillionUsd: 15.0, outputPerMillionUsd: 75.0, cachePerMillionUsd: 1.5 },

  // OpenAI
  "gpt-4o": { inputPerMillionUsd: 2.5, outputPerMillionUsd: 10.0, cachePerMillionUsd: 1.25 },
  "gpt-4o-mini": { inputPerMillionUsd: 0.15, outputPerMillionUsd: 0.6, cachePerMillionUsd: 0.075 },
  o1: { inputPerMillionUsd: 15.0, outputPerMillionUsd: 60.0, cachePerMillionUsd: 7.5 },
  "o3-mini": { inputPerMillionUsd: 1.1, outputPerMillionUsd: 4.4, cachePerMillionUsd: 0.55 },

  // Google Gemini
  "gemini-2.5-pro": {
    inputPerMillionUsd: 1.25,
    outputPerMillionUsd: 5.0,
    cachePerMillionUsd: 0.3125,
  },
  "gemini-2.5-flash": {
    inputPerMillionUsd: 0.075,
    outputPerMillionUsd: 0.3,
    cachePerMillionUsd: 0.01875,
  },
  "gemini-1.5-pro": {
    inputPerMillionUsd: 1.25,
    outputPerMillionUsd: 5.0,
    cachePerMillionUsd: 0.3125,
  },
  "gemini-1.5-flash": {
    inputPerMillionUsd: 0.075,
    outputPerMillionUsd: 0.3,
    cachePerMillionUsd: 0.01875,
  },
};

export const DEFAULT_MODEL_FOR_PROVIDER: Record<ProviderId, string> = {
  anthropic: "claude-3-5-sonnet-20241022",
  openai: "gpt-4o",
  google: "gemini-2.5-flash",
  local: "gpt-4o-mini",
  generic: "gpt-4o",
};

export class DefaultModelProvider implements ModelProvider {
  readonly providerId: ProviderId;
  private readonly customPricing: Map<string, ModelPricing>;

  constructor(
    providerId: ProviderId = "anthropic",
    customPricing: Record<string, ModelPricing> = {},
  ) {
    this.providerId = providerId;
    this.customPricing = new Map(Object.entries(customPricing));
  }

  countTokens(text: string): number {
    return countTokens(text);
  }

  calculateCost(modelId: string, usage: TokenUsage): CostEstimate {
    const pricing = this.customPricing.get(modelId) ||
      MODEL_PRICING_TABLE[modelId] ||
      MODEL_PRICING_TABLE[DEFAULT_MODEL_FOR_PROVIDER[this.providerId]] || {
        inputPerMillionUsd: 3.0,
        outputPerMillionUsd: 15.0,
        cachePerMillionUsd: 0.3,
      };

    const inputUsd = (usage.inputTokens / 1_000_000) * pricing.inputPerMillionUsd;
    const outputUsd = (usage.outputTokens / 1_000_000) * pricing.outputPerMillionUsd;
    const cacheUsd = (usage.cacheReadTokens / 1_000_000) * pricing.cachePerMillionUsd;
    const estimatedTotalUsd = inputUsd + outputUsd + cacheUsd;

    return {
      currency: "USD",
      estimatedTotalUsd: Number(estimatedTotalUsd.toFixed(6)),
      breakdown: {
        inputUsd: Number(inputUsd.toFixed(6)),
        outputUsd: Number(outputUsd.toFixed(6)),
        cacheUsd: Number(cacheUsd.toFixed(6)),
      },
    };
  }
}

export function createModelProvider(
  providerId: ProviderId = "anthropic",
  customPricing: Record<string, ModelPricing> = {},
): ModelProvider {
  return new DefaultModelProvider(providerId, customPricing);
}
