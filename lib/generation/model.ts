import "server-only";
import { APICallError } from "ai";
import type { AppContext } from "@/lib/api/context";
import type { Payment } from "@/lib/generation/payment";
import {
  CREDIT_MAX_OUTPUT_TOKENS,
  CREDIT_REASONING_EFFORT,
  type ResolvedModel,
} from "@/lib/models";

export function replyModelSettings(
  ctx: AppContext,
  model: ResolvedModel,
  payment: Payment,
) {
  const credit = payment.source === "credits";
  return {
    model: ctx.languageModel(model.id, payment.apiKey, {
      reasoningEffort:
        credit && model.catalog?.capabilities.reasoningEffort
          ? CREDIT_REASONING_EFFORT
          : undefined,
    }),
    maxOutputTokens: credit ? CREDIT_MAX_OUTPUT_TOKENS : undefined,
  };
}

/** Maps a provider failure to an error ID that is safe to store and show. */
export function errorId(error: unknown): string {
  if (APICallError.isInstance(error)) {
    if (error.statusCode === 401 || error.statusCode === 403)
      return "provider_key_rejected";
    if (error.statusCode === 402) return "provider_payment_required";
    if (error.statusCode === 429) return "provider_rate_limited";
  }
  return "generation_failed";
}
