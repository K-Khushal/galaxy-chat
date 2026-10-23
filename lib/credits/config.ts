import { z } from "zod";
import type { EnvSource } from "@/lib/auth/env";
import { AppError } from "@/lib/errors";
import { deepFreeze, resolvePlatformBudgetConfig } from "@/lib/funding/config";

export const CREDIT_MICRODOLLARS = 100_000;
export const DAILY_MICRODOLLARS = 500_000;
export const PLATFORM_CEILING_MICRODOLLARS = 10_000_000;
const integer = z.number().int().min(0).max(PLATFORM_CEILING_MICRODOLLARS);
const priceSchema = z
  .object({
    id: z.string().min(1).max(100),
    model: z.string().regex(/^[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+(?::free)?$/),
    provider: z.string().min(1).max(100),
    expiresAt: z.iso.datetime(),
    inputMicrodollarsPerMillion: integer,
    outputMicrodollarsPerMillion: integer,
    // Required assertions: this slice cannot bound reasoning, tools, search or media.
    basicTextOnly: z.literal(true),
    reasoning: z.literal("none"),
    allInPrice: z.literal(true),
  })
  .strict();
export type PriceSnapshot = z.infer<typeof priceSchema>;
export type PlanBinding = {
  readonly month: string;
  readonly revision: string;
  readonly digest: string;
  readonly capacityDigest: string;
};
export type FundingConfig = {
  readonly adapter: "openrouter";
  readonly monthlyMicrodollars: number;
  readonly commitmentsMicrodollars: number;
  readonly price: PriceSnapshot;
  readonly actorConcurrency: number;
  readonly globalConcurrency: number;
  readonly plan: PlanBinding;
};

export function assertExactPriceMatch(
  a: PriceSnapshot,
  b: PriceSnapshot,
): void {
  if (
    a.id !== b.id ||
    a.model !== b.model ||
    a.provider !== b.provider ||
    a.expiresAt !== b.expiresAt ||
    a.inputMicrodollarsPerMillion !== b.inputMicrodollarsPerMillion ||
    a.outputMicrodollarsPerMillion !== b.outputMicrodollarsPerMillion ||
    a.basicTextOnly !== b.basicTextOnly ||
    a.reasoning !== b.reasoning ||
    a.allInPrice !== b.allInPrice
  ) {
    throw new AppError("unknown_model_price", 503);
  }
}

export function assertExactFundingConfigMatch(
  a: FundingConfig,
  b: FundingConfig,
): void {
  if (
    a.adapter !== b.adapter ||
    a.monthlyMicrodollars !== b.monthlyMicrodollars ||
    a.commitmentsMicrodollars !== b.commitmentsMicrodollars ||
    a.actorConcurrency !== b.actorConcurrency ||
    a.globalConcurrency !== b.globalConcurrency
  ) {
    throw new AppError("funding_unconfigured", 503);
  }
  assertExactPriceMatch(a.price, b.price);
  if (
    a.plan.month !== b.plan.month ||
    a.plan.revision !== b.plan.revision ||
    a.plan.digest !== b.plan.digest ||
    a.plan.capacityDigest !== b.plan.capacityDigest
  ) {
    throw new AppError("plan_candidate_mismatch", 400);
  }
}

function envInteger(env: EnvSource, key: string): number {
  const value = env[key];
  if (!value || !/^(0|[1-9]\d*)$/.test(value))
    throw new AppError("funding_unconfigured", 503);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > PLATFORM_CEILING_MICRODOLLARS)
    throw new AppError("funding_unconfigured", 503);
  return parsed;
}

export function resolveFundingConfig(
  env: EnvSource,
  now = new Date(),
): FundingConfig {
  if (env.FUNDED_INFERENCE !== "1" || env.FUNDED_KILL_SWITCH !== "0")
    throw new AppError("funded_inference_disabled", 503);
  if (env.FUNDED_ADAPTER === "gateway")
    throw new AppError("gateway_receipts_unverified", 503);
  if (env.FUNDED_ADAPTER !== "openrouter")
    throw new AppError("provider_unconfigured", 503);
  // Requires an operator to verify the configured endpoint enforces these bounds.
  if (
    env.FUNDED_PROVIDER_LIMITS_VERIFIED !== "1" ||
    !env.OPENROUTER_API_KEY?.trim() ||
    !env.CREDIT_ACTOR_SECRET ||
    env.CREDIT_ACTOR_SECRET.length < 32
  )
    throw new AppError("funding_unconfigured", 503);
  let price: PriceSnapshot;
  try {
    price = priceSchema.parse(JSON.parse(env.FUNDED_BASIC_PRICE_JSON ?? ""));
  } catch {
    throw new AppError("unknown_model_price", 503);
  }
  if (new Date(price.expiresAt).getTime() <= now.getTime())
    throw new AppError("unknown_model_price", 503);

  const budgetConfig = resolvePlatformBudgetConfig(env, now);
  if (!budgetConfig || !budgetConfig.enabled) {
    throw new AppError("platform_budget_disabled", 503);
  }

  const infra = envInteger(env, "PLATFORM_INFRA_MICRODOLLARS");
  const fees = envInteger(env, "PLATFORM_PROVIDER_FEES_MICRODOLLARS");
  const safety = envInteger(env, "PLATFORM_SAFETY_RESERVE_MICRODOLLARS");
  const monthlyMicrodollars = envInteger(env, "FUNDED_MONTHLY_MICRODOLLARS");

  if (
    monthlyMicrodollars !== budgetConfig.plan.aCredit ||
    infra !== budgetConfig.plan.kInfra ||
    fees !== budgetConfig.plan.kProviderFees ||
    safety !== budgetConfig.plan.kSafety
  ) {
    throw new AppError("plan_candidate_mismatch", 400);
  }

  const commitmentsMicrodollars = infra + fees + safety;
  if (
    monthlyMicrodollars < 1 ||
    commitmentsMicrodollars + monthlyMicrodollars >
      PLATFORM_CEILING_MICRODOLLARS
  )
    throw new AppError("funding_unconfigured", 503);

  const planBinding: PlanBinding = deepFreeze({
    month: budgetConfig.plan.month,
    revision: budgetConfig.plan.revision,
    digest: budgetConfig.digest,
    capacityDigest: budgetConfig.capacityDigest,
  });

  return deepFreeze({
    adapter: "openrouter",
    monthlyMicrodollars,
    commitmentsMicrodollars,
    price,
    actorConcurrency: 1,
    globalConcurrency: 2,
    plan: planBinding,
  });
}

export const LIMITS = {
  inputBytes: 12_000,
  inputTokens: 16_384,
  outputTokens: 512,
  messages: 12,
  guestInputBytes: 2_000,
  timeoutMs: 20_000,
} as const;
export const INSTRUCTIONS =
  "You are a helpful assistant. Answer using plain text or Markdown. Do not call tools.";
export function worstCaseMicrodollars(price: PriceSnapshot): number {
  // Integer arithmetic with bounded products (< 2^53); each side rounds up.
  return Math.max(
    1,
    Math.ceil(
      (LIMITS.inputTokens * price.inputMicrodollarsPerMillion) / 1_000_000,
    ) +
      Math.ceil(
        (LIMITS.outputTokens * price.outputMicrodollarsPerMillion) / 1_000_000,
      ),
  );
}
export function utcWindows(now: Date) {
  const day = now.toISOString().slice(0, 10);
  return {
    day,
    month: day.slice(0, 7),
    resetsAt: new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1),
    ).toISOString(),
  };
}
