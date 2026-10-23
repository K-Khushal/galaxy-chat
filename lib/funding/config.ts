import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import { attachmentLimits } from "@/lib/attachments/contract";
import type { EnvSource } from "@/lib/auth/env";
import { BYOK_LIMITS } from "@/lib/byok/config";
import { AppError } from "@/lib/errors";
import { imageLimits } from "@/lib/images/contract";
import { MCP_CLIENT_LIMITS } from "@/lib/mcp/contract";

export const PLATFORM_CEILING_MICRODOLLARS = 10_000_000;
export const FUNDING_ADVISORY_LOCK_ID = 41021406;

/**
 * Explicit coverage assertions. All 8 items are mandatory and must be literal true.
 * No prices or hosted provider attestations may be invented.
 */
export const coverageAssertionsSchema = z
  .object({
    infra: z.literal(true),
    storage: z.literal(true),
    transfer: z.literal(true),
    database: z.literal(true),
    queues: z.literal(true),
    ordinaryByok: z.literal(true),
    accountLevelCharges: z.literal(true),
    conservativeLegacyUnknownExposure: z.literal(true),
  })
  .strict();

export type CoverageAssertions = z.infer<typeof coverageAssertionsSchema>;

/**
 * Finite allowlist of actual existing system caps across galaxy-chat.
 * Bound to real system constants and normalized nonsecret environment limits.
 */
export const capacitySnapshotSchema = z
  .object({
    fundedInferenceEnabled: z.boolean(),
    byokEnabled: z.boolean(),
    searchToolsEnabled: z.boolean(),
    attachmentsEnabled: z.boolean(),
    imagesEnabled: z.boolean(),
    mcpClientEnabled: z.boolean(),
    platformInfraMicrodollars: z
      .number()
      .int()
      .min(0)
      .max(PLATFORM_CEILING_MICRODOLLARS),
    platformProviderFeesMicrodollars: z
      .number()
      .int()
      .min(0)
      .max(PLATFORM_CEILING_MICRODOLLARS),
    platformSafetyReserveMicrodollars: z
      .number()
      .int()
      .min(0)
      .max(PLATFORM_CEILING_MICRODOLLARS),
    fundedMonthlyMicrodollars: z
      .number()
      .int()
      .min(0)
      .max(PLATFORM_CEILING_MICRODOLLARS),
    searchActorDailyMicrodollars: z
      .number()
      .int()
      .min(0)
      .max(PLATFORM_CEILING_MICRODOLLARS),
    searchGlobalDailyMicrodollars: z
      .number()
      .int()
      .min(0)
      .max(PLATFORM_CEILING_MICRODOLLARS),
    attachmentPlatformBytes: z
      .number()
      .int()
      .min(0)
      .max(100 * 1024 * 1024),
    attachmentUserBytes: z
      .number()
      .int()
      .min(0)
      .max(20 * 1024 * 1024),
    attachmentDailyTransferBytes: z
      .number()
      .int()
      .min(0)
      .max(100 * 1024 * 1024),
    attachmentMaxUserFiles: z.number().int().min(1).max(1000),
    byokHourlyLimit: z.number().int().min(1).max(10_000),
    byokDailyLimit: z.number().int().min(1).max(100_000),
    byokGlobalDailyLimit: z.number().int().min(1).max(1_000_000),
    byokActorConcurrency: z.number().int().min(1).max(100),
    byokGlobalConcurrency: z.number().int().min(1).max(1000),
    imageMaxBytes: z
      .number()
      .int()
      .min(1)
      .max(50 * 1024 * 1024),
    mcpMaxProfiles: z.number().int().min(1).max(256),
    mcpMaxTimeoutMs: z.number().int().min(1000).max(120_000),
  })
  .strict();

export type CapacitySnapshot = z.infer<typeof capacitySnapshotSchema>;

export const budgetPlanInputSchema = z
  .object({
    month: z.string().regex(/^[0-9]{4}-(0[1-9]|1[0-2])$/),
    revision: z
      .string()
      .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/),
    bSelected: z.number().int().min(0).max(PLATFORM_CEILING_MICRODOLLARS),
    aCredit: z.number().int().min(0).max(PLATFORM_CEILING_MICRODOLLARS),
    aMcp: z.number().int().min(0).max(PLATFORM_CEILING_MICRODOLLARS),
    kInfra: z.number().int().min(0).max(PLATFORM_CEILING_MICRODOLLARS),
    kProviderFees: z.number().int().min(0).max(PLATFORM_CEILING_MICRODOLLARS),
    kSafety: z.number().int().min(0).max(PLATFORM_CEILING_MICRODOLLARS),
    lCarried: z.number().int().min(0).max(PLATFORM_CEILING_MICRODOLLARS),
    reviewedAt: z.iso.datetime(),
    expiresAt: z.iso.datetime(),
    coverageProofReference: z.string().min(1).max(256),
    coverageProofDigest: z.string().regex(/^[a-f0-9]{64}$/),
    coverageAssertions: coverageAssertionsSchema,
    capacitySnapshot: capacitySnapshotSchema,
  })
  .strict();

export type BudgetPlanInput = z.infer<typeof budgetPlanInputSchema>;

export type BudgetPlan = BudgetPlanInput & {
  digest: string;
  capacityDigest: string;
};

export type PlatformBudgetConfig = {
  enabled: boolean;
  plan: BudgetPlanInput;
  digest: string;
  capacityDigest: string;
};

export function parseBudgetPlanInput(raw: unknown): BudgetPlanInput {
  try {
    return budgetPlanInputSchema.parse(raw);
  } catch (err) {
    if (err instanceof z.ZodError) {
      if (err.issues.some((i) => i.path[0] === "coverageAssertions")) {
        throw new AppError("invalid_budget_coverage", 400);
      }
      throw new AppError("invalid_budget_plan", 400);
    }
    throw new AppError("invalid_budget_plan", 400);
  }
}

export function canonicalJson(obj: unknown): string {
  const walk = (v: unknown): unknown => {
    if (v === null || typeof v === "string" || typeof v === "boolean") return v;
    if (typeof v === "number" && Number.isFinite(v)) {
      return Object.is(v, -0) ? 0 : v;
    }
    if (Array.isArray(v)) return v.map(walk);
    if (
      v &&
      typeof v === "object" &&
      Object.getPrototypeOf(v) === Object.prototype
    ) {
      return Object.fromEntries(
        Object.entries(v)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([k, x]) => [k, walk(x)]),
      );
    }
    throw new AppError("invalid_plan_serialization", 400);
  };
  return JSON.stringify(walk(obj));
}

export function computeCapacityDigest(snapshot: CapacitySnapshot): string {
  return createHash("sha256").update(canonicalJson(snapshot)).digest("hex");
}

export function computePlanDigest(plan: BudgetPlanInput): string {
  const payload = {
    month: plan.month,
    revision: plan.revision,
    bSelected: plan.bSelected,
    aCredit: plan.aCredit,
    aMcp: plan.aMcp,
    kInfra: plan.kInfra,
    kProviderFees: plan.kProviderFees,
    kSafety: plan.kSafety,
    lCarried: plan.lCarried,
    reviewedAt: plan.reviewedAt,
    expiresAt: plan.expiresAt,
    coverageProofReference: plan.coverageProofReference,
    coverageProofDigest: plan.coverageProofDigest,
    coverageAssertions: plan.coverageAssertions,
    capacitySnapshot: plan.capacitySnapshot,
  };
  return createHash("sha256").update(canonicalJson(payload)).digest("hex");
}

export function validateBudgetPlanArithmetics(plan: BudgetPlanInput): void {
  if (!/^[0-9]{4}-(0[1-9]|1[0-2])$/.test(plan.month)) {
    throw new AppError("invalid_budget_month", 400);
  }

  // Exact binding between plan allocations/commitments and capacity snapshot
  if (plan.aCredit !== plan.capacitySnapshot.fundedMonthlyMicrodollars) {
    throw new AppError("plan_capacity_binding_mismatch", 400);
  }
  if (plan.kInfra !== plan.capacitySnapshot.platformInfraMicrodollars) {
    throw new AppError("plan_capacity_binding_mismatch", 400);
  }
  if (
    plan.kProviderFees !==
    plan.capacitySnapshot.platformProviderFeesMicrodollars
  ) {
    throw new AppError("plan_capacity_binding_mismatch", 400);
  }
  if (
    plan.kSafety !== plan.capacitySnapshot.platformSafetyReserveMicrodollars
  ) {
    throw new AppError("plan_capacity_binding_mismatch", 400);
  }

  const K = plan.kInfra + plan.kProviderFees + plan.kSafety;
  const totalAllocated = plan.aCredit + plan.aMcp + K + plan.lCarried;

  if (
    !Number.isSafeInteger(totalAllocated) ||
    totalAllocated > plan.bSelected ||
    plan.bSelected > PLATFORM_CEILING_MICRODOLLARS
  ) {
    throw new AppError("budget_allocation_overflow", 400);
  }

  if (plan.bSelected === 0) {
    if (
      plan.aCredit !== 0 ||
      plan.aMcp !== 0 ||
      K !== 0 ||
      plan.lCarried !== 0
    ) {
      throw new AppError("budget_zero_allocation_invalid", 400);
    }
  }

  const reviewed = new Date(plan.reviewedAt).getTime();
  const expires = new Date(plan.expiresAt).getTime();
  if (expires <= reviewed) {
    throw new AppError("plan_expiry_before_review", 400);
  }
}

export function resolveCurrentCapacitySnapshot(
  env: EnvSource,
): CapacitySnapshot {
  const intEnv = (
    key: string,
    def = 0,
    max = PLATFORM_CEILING_MICRODOLLARS,
  ): number => {
    const val = env[key];
    if (!val || val.trim() === "") return def;
    if (!/^(0|[1-9]\d*)$/.test(val))
      throw new AppError("funding_unconfigured", 503);
    const n = Number(val);
    if (!Number.isSafeInteger(n) || n > max)
      throw new AppError("funding_unconfigured", 503);
    return n;
  };

  return {
    fundedInferenceEnabled: env.FUNDED_INFERENCE === "1",
    byokEnabled: env.BYOK_ENABLED === "1",
    searchToolsEnabled: env.SEARCH_TOOLS_ENABLED === "1",
    attachmentsEnabled: env.ATTACHMENTS_ENABLED === "1",
    imagesEnabled: env.IMAGES_ENABLED === "1",
    mcpClientEnabled: env.MCP_CLIENT_ENABLED === "1",
    platformInfraMicrodollars: intEnv("PLATFORM_INFRA_MICRODOLLARS", 0),
    platformProviderFeesMicrodollars: intEnv(
      "PLATFORM_PROVIDER_FEES_MICRODOLLARS",
      0,
    ),
    platformSafetyReserveMicrodollars: intEnv(
      "PLATFORM_SAFETY_RESERVE_MICRODOLLARS",
      0,
    ),
    fundedMonthlyMicrodollars: intEnv("FUNDED_MONTHLY_MICRODOLLARS", 0),
    searchActorDailyMicrodollars: intEnv("SEARCH_ACTOR_DAILY_MICRODOLLARS", 0),
    searchGlobalDailyMicrodollars: intEnv(
      "SEARCH_GLOBAL_DAILY_MICRODOLLARS",
      0,
    ),
    attachmentPlatformBytes: intEnv(
      "ATTACHMENT_PLATFORM_BYTES",
      100 * 1024 * 1024,
      100 * 1024 * 1024,
    ),
    attachmentUserBytes: intEnv(
      "ATTACHMENT_USER_BYTES",
      20 * 1024 * 1024,
      20 * 1024 * 1024,
    ),
    attachmentDailyTransferBytes: intEnv(
      "ATTACHMENT_DAILY_TRANSFER_BYTES",
      100 * 1024 * 1024,
      100 * 1024 * 1024,
    ),
    attachmentMaxUserFiles: attachmentLimits.userFiles,
    byokHourlyLimit: BYOK_LIMITS.hourly,
    byokDailyLimit: BYOK_LIMITS.daily,
    byokGlobalDailyLimit: BYOK_LIMITS.globalDaily,
    byokActorConcurrency: BYOK_LIMITS.actorConcurrency,
    byokGlobalConcurrency: BYOK_LIMITS.globalConcurrency,
    imageMaxBytes: imageLimits.bytes,
    mcpMaxProfiles: MCP_CLIENT_LIMITS.maxProfiles,
    mcpMaxTimeoutMs: MCP_CLIENT_LIMITS.maxTimeoutMs,
  };
}

export function resolvePlatformBudgetConfig(
  env: EnvSource,
  now = new Date(),
): PlatformBudgetConfig {
  if (env.PLATFORM_BUDGET_ENABLED !== "1") {
    throw new AppError("platform_budget_disabled", 503);
  }

  const rawJson = env.PLATFORM_BUDGET_PLAN_JSON;
  if (!rawJson || rawJson.trim() === "") {
    throw new AppError("budget_plan_unconfigured", 503);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    throw new AppError("budget_plan_unconfigured", 503);
  }

  const plan = parseBudgetPlanInput(parsed);
  validateBudgetPlanArithmetics(plan);

  if (new Date(plan.reviewedAt).getTime() > now.getTime()) {
    throw new AppError("plan_reviewed_in_future", 400);
  }

  if (new Date(plan.expiresAt).getTime() <= now.getTime()) {
    throw new AppError("plan_coverage_expired", 503);
  }

  // Runtime config candidate matching: candidate values cannot silently diverge from env
  if (
    env.FUNDED_MONTHLY_MICRODOLLARS &&
    Number(env.FUNDED_MONTHLY_MICRODOLLARS) !== plan.aCredit
  ) {
    throw new AppError("plan_candidate_mismatch", 400);
  }
  if (
    env.PLATFORM_INFRA_MICRODOLLARS &&
    Number(env.PLATFORM_INFRA_MICRODOLLARS) !== plan.kInfra
  ) {
    throw new AppError("plan_candidate_mismatch", 400);
  }
  if (
    env.PLATFORM_PROVIDER_FEES_MICRODOLLARS &&
    Number(env.PLATFORM_PROVIDER_FEES_MICRODOLLARS) !== plan.kProviderFees
  ) {
    throw new AppError("plan_candidate_mismatch", 400);
  }
  if (
    env.PLATFORM_SAFETY_RESERVE_MICRODOLLARS &&
    Number(env.PLATFORM_SAFETY_RESERVE_MICRODOLLARS) !== plan.kSafety
  ) {
    throw new AppError("plan_candidate_mismatch", 400);
  }

  const currentCaps = resolveCurrentCapacitySnapshot(env);
  const currentCapacityDigest = computeCapacityDigest(currentCaps);
  const planCapacityDigest = computeCapacityDigest(plan.capacitySnapshot);

  if (currentCapacityDigest !== planCapacityDigest) {
    throw new AppError("capacity_drift", 503);
  }

  const digest = computePlanDigest(plan);

  return {
    enabled: true,
    plan,
    digest,
    capacityDigest: planCapacityDigest,
  };
}
