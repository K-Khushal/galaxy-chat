/**
 * The curated model catalog. Every model is served through OpenRouter.
 * Prices and capabilities come from docs/research/credit-models.md
 * (OpenRouter models API, 2026-10-31); refresh them from that API.
 */

export type ReasoningEffort = "none" | "minimal" | "low" | "medium" | "high";

export type ModelCapabilities = {
  vision: boolean;
  /** The endpoint advertises file input; re-check before relying on it. */
  pdf: boolean;
  reasoning: boolean;
  /** Accepts an OpenRouter `reasoning.effort` setting. */
  reasoningEffort: boolean;
  /** Context window in tokens. */
  context: number;
};

export type CatalogModel = {
  id: string;
  provider: string;
  label: string;
  capabilities: ModelCapabilities;
  /** USD per million tokens. */
  pricing: { input: number; output: number };
  /** Credits can pay for Replies on this model (ADR 0003). */
  creditModel: boolean;
};

/** A model a Generation runs on: a catalog entry or a BYOK custom model ID. */
export type ResolvedModel = {
  id: string;
  creditModel: boolean;
  catalog: CatalogModel | null;
};

const caps = (
  vision: boolean,
  pdf: boolean,
  reasoning: boolean,
  reasoningEffort: boolean,
  context: number,
): ModelCapabilities => ({ vision, pdf, reasoning, reasoningEffort, context });

export const MODELS: readonly CatalogModel[] = [
  {
    id: "openai/gpt-6-luna",
    provider: "OpenAI",
    label: "GPT-6 Luna",
    capabilities: caps(true, true, true, true, 1_050_000),
    pricing: { input: 0.1, output: 0.5 },
    creditModel: true,
  },
  {
    id: "anthropic/claude-haiku-5.5",
    provider: "Anthropic",
    label: "Claude Haiku 5.5",
    capabilities: caps(true, true, true, true, 1_000_000),
    pricing: { input: 0.1, output: 0.5 },
    creditModel: true,
  },
  {
    id: "google/gemini-2.5-flash-lite",
    provider: "Google",
    label: "Gemini 2.5 Flash-Lite",
    capabilities: caps(true, true, true, false, 1_048_576),
    pricing: { input: 0.1, output: 0.4 },
    creditModel: true,
  },
  {
    id: "openai/gpt-6.1-sol",
    provider: "OpenAI",
    label: "GPT-6.1 Sol",
    capabilities: caps(true, true, true, true, 1_050_000),
    pricing: { input: 2, output: 10 },
    creditModel: false,
  },
  {
    id: "anthropic/claude-sonnet-5.5",
    provider: "Anthropic",
    label: "Claude Sonnet 5.5",
    capabilities: caps(true, true, true, true, 1_000_000),
    pricing: { input: 2, output: 10 },
    creditModel: false,
  },
  {
    id: "google/gemini-4-argon",
    provider: "Google",
    label: "Gemini 4 Argon",
    capabilities: caps(true, true, true, true, 1_048_576),
    pricing: { input: 2, output: 10 },
    creditModel: false,
  },
  {
    id: "google/gemini-3.8-flash",
    provider: "Google",
    label: "Gemini 3.8 Flash",
    capabilities: caps(true, true, true, true, 1_048_576),
    pricing: { input: 0.825, output: 4.125 },
    creditModel: false,
  },
  {
    id: "x-ai/grok-4.7",
    provider: "xAI",
    label: "Grok 4.7",
    capabilities: caps(true, true, true, true, 500_000),
    pricing: { input: 2, output: 6 },
    creditModel: false,
  },
  {
    id: "deepseek/deepseek-v4.1-flash",
    provider: "DeepSeek",
    label: "DeepSeek V4.1 Flash",
    capabilities: caps(true, false, true, true, 1_048_576),
    pricing: { input: 0.045, output: 0.5 },
    creditModel: false,
  },
  {
    id: "meta-llama/llama-4-maverick",
    provider: "Meta",
    label: "Llama 4 Maverick",
    capabilities: caps(true, false, false, false, 524_288),
    pricing: { input: 0.1875, output: 0.6525 },
    creditModel: false,
  },
  {
    id: "qwen/qwen3.8-flash",
    provider: "Qwen",
    label: "Qwen3.8 Flash",
    capabilities: caps(true, false, true, false, 1_000_000),
    pricing: { input: 0.15, output: 0.47 },
    creditModel: false,
  },
  {
    id: "qwen/qwen3.8-max-prime",
    provider: "Qwen",
    label: "Qwen3.8 Max Prime",
    capabilities: caps(true, false, true, true, 1_000_000),
    pricing: { input: 4, output: 12 },
    creditModel: false,
  },
  {
    id: "mistralai/mistral-large-4-0",
    provider: "Mistral",
    label: "Mistral Large 4",
    capabilities: caps(true, false, true, true, 1_048_576),
    pricing: { input: 0.7, output: 2.1 },
    creditModel: false,
  },
];

/** The model new Chats start on. */
export const DEFAULT_MODEL_ID = "openai/gpt-6-luna";

/** Credit Replies are capped so ten Credits stay well under $0.05. */
export const CREDIT_MAX_OUTPUT_TOKENS = 4096;

/** Reasoning effort for Credit Replies on models that accept one. */
export const CREDIT_REASONING_EFFORT: ReasoningEffort = "low";

const CUSTOM_MODEL_ID = /^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._:-]*$/i;

export function findModel(id: string): CatalogModel | null {
  return MODELS.find((model) => model.id === id) ?? null;
}

/**
 * Resolves a catalog model or, for BYOK use, a well-formed custom OpenRouter
 * model ID. Custom models are never Credit models. Returns null when invalid.
 */
export function resolveModel(id: string): ResolvedModel | null {
  const catalog = findModel(id);
  if (catalog) {
    return { id, creditModel: catalog.creditModel, catalog };
  }
  if (id.length > 100 || !CUSTOM_MODEL_ID.test(id)) {
    return null;
  }
  return { id, creditModel: false, catalog: null };
}

/** The cheapest Credit model, used for Chat titles. */
export function titleModel(): CatalogModel {
  const credit = MODELS.filter((model) => model.creditModel);
  return credit.reduce((best, model) =>
    model.pricing.input + model.pricing.output <
    best.pricing.input + best.pricing.output
      ? model
      : best,
  );
}
