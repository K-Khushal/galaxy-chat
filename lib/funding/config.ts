import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import { attachmentLimits } from "@/lib/attachments/contract";
import type { EnvSource } from "@/lib/auth/env";
import { BYOK_LIMITS } from "@/lib/byok/config";
import { AppError } from "@/lib/errors";
import { imageLimits } from "@/lib/images/contract";
import { parseProfilesJson } from "@/lib/mcp/config";
import { MCP_CLIENT_LIMITS } from "@/lib/mcp/contract";
import { SEARCH_LIMITS } from "@/lib/search/contract";

export const PLATFORM_CEILING_MICRODOLLARS = 10_000_000;
export const FUNDING_ADVISORY_LOCK_ID = 41021406;

/**
 * Deep-freeze an object hierarchy so callers cannot mutate candidate structures.
 */
export function deepFreeze<T>(obj: T): T {
  if (obj === null || typeof obj !== "object") {
    return obj;
  }
  Object.freeze(obj);
  for (const key of Object.keys(obj)) {
    const val = (obj as Record<string, unknown>)[key];
    if (val && typeof val === "object" && !Object.isFrozen(val)) {
      deepFreeze(val);
    }
  }
  return obj;
}

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
    // Feature enablement states
    fundedInferenceEnabled: z.boolean(),
    byokEnabled: z.boolean(),
    searchToolsEnabled: z.boolean(),
    attachmentsEnabled: z.boolean(),
    imagesEnabled: z.boolean(),
    mcpClientEnabled: z.boolean(),
    // Microdollar bounds
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
    // Search bounds
    searchActorHourlyRequests: z.number().int().min(0).max(2_000_000_000),
    searchActorDailyRequests: z.number().int().min(0).max(2_000_000_000),
    searchGlobalDailyRequests: z.number().int().min(0).max(2_000_000_000),
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
    searchMaxResults: z.number().int().min(1).max(100),
    searchTimeoutMs: z.number().int().min(1000).max(60_000),
    searchContextBytes: z.number().int().min(1).max(1_000_000),
    searchTransportBytes: z.number().int().min(1).max(10_000_000),
    // BYOK bounds
    byokHourlyLimit: z.number().int().min(1).max(10_000),
    byokDailyLimit: z.number().int().min(1).max(100_000),
    byokGlobalDailyLimit: z.number().int().min(1).max(1_000_000),
    byokActorConcurrency: z.number().int().min(1).max(100),
    byokGlobalConcurrency: z.number().int().min(1).max(1000),
    byokActorRecords: z.number().int().min(1).max(1_000_000),
    byokGlobalRecords: z.number().int().min(1).max(10_000_000),
    byokMetadataBytes: z.number().int().min(1).max(1_000_000),
    // Attachment bounds
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
    attachmentMaxFileBytes: z
      .number()
      .int()
      .min(1)
      .max(50 * 1024 * 1024),
    attachmentMaxPerMessage: z.number().int().min(1).max(100),
    attachmentUploadLeaseMs: z.number().int().min(1000).max(3_600_000),
    // Image bounds
    imageMaxBytes: z
      .number()
      .int()
      .min(1)
      .max(50 * 1024 * 1024),
    imageMaxMilliseconds: z.number().int().min(1000).max(300_000),
    imageMaxPromptCharacters: z.number().int().min(1).max(100_000),
    // MCP client bounds
    mcpMaxProfiles: z.number().int().min(1).max(256),
    mcpMaxTimeoutMs: z.number().int().min(1000).max(120_000),
    mcpMaxRequestBytes: z.number().int().min(1000).max(10_000_000),
    mcpMaxEnvelopeBytes: z.number().int().min(1000).max(10_000_000),
    mcpMaxTransportResponseBytes: z.number().int().min(1000).max(10_000_000),
    mcpMaxDecodedBodyBytes: z.number().int().min(1000).max(10_000_000),
    mcpProfilesDigest: z.string().regex(/^([a-f0-9]{64})?$/),
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

/**
 * Parse an untrusted candidate input into an owned, deep-frozen, validated BudgetPlanInput.
 * All public input errors are mapped to typed AppErrors.
 */
export function parseBudgetPlanInput(raw: unknown): BudgetPlanInput {
  try {
    const parsed = budgetPlanInputSchema.parse(raw);
    const cloned: BudgetPlanInput = JSON.parse(canonicalJson(parsed));
    return deepFreeze(cloned);
  } catch (err) {
    if (err instanceof z.ZodError) {
      if (err.issues.some((i) => i.path[0] === "coverageAssertions")) {
        throw new AppError("invalid_budget_coverage", 400);
      }
      throw new AppError("invalid_budget_plan", 400);
    }
    if (err instanceof AppError) {
      throw err;
    }
    throw new AppError("invalid_budget_plan", 400);
  }
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

  const searchToolsEnabled = env.SEARCH_TOOLS_ENABLED === "1";
  let searchActorHourlyRequests = 0;
  let searchActorDailyRequests = 0;
  let searchGlobalDailyRequests = 0;
  let searchActorDailyMicrodollars = 0;
  let searchGlobalDailyMicrodollars = 0;

  if (searchToolsEnabled) {
    const parsePos = (key: string) => {
      const v = env[key];
      if (!v || !/^[1-9]\d*$/.test(v)) {
        throw new AppError("funding_unconfigured", 503);
      }
      const num = Number(v);
      if (!Number.isSafeInteger(num) || num > 2_000_000_000) {
        throw new AppError("funding_unconfigured", 503);
      }
      return num;
    };
    searchActorHourlyRequests = parsePos("SEARCH_ACTOR_HOURLY_REQUESTS");
    searchActorDailyRequests = parsePos("SEARCH_ACTOR_DAILY_REQUESTS");
    searchGlobalDailyRequests = parsePos("SEARCH_GLOBAL_DAILY_REQUESTS");
    searchActorDailyMicrodollars = parsePos("SEARCH_ACTOR_DAILY_MICRODOLLARS");
    searchGlobalDailyMicrodollars = parsePos(
      "SEARCH_GLOBAL_DAILY_MICRODOLLARS",
    );
  }

  const mcpClientEnabled = env.MCP_CLIENT_ENABLED === "1";
  let mcpProfilesDigest = "";
  if (mcpClientEnabled) {
    const rawProfiles = env.MCP_CLIENT_PROFILES_JSON;
    if (!rawProfiles || rawProfiles.trim() === "") {
      throw new AppError("mcp_profiles_missing", 503);
    }
    const profilesMap = parseProfilesJson(rawProfiles);
    const canonicalEntries = Array.from(profilesMap.values())
      .map((p) => ({
        profileId: p.profileId,
        revision: p.revision,
        purpose: p.purpose,
        resource: p.resource,
        issuer: p.issuer,
        credential: p.credential,
        maxRequestBytes: p.maxRequestBytes,
        maxResponseBytes: p.maxResponseBytes,
        timeoutMs: p.timeoutMs,
      }))
      .sort((a, b) =>
        `${a.profileId}::${a.revision}::${a.purpose}`.localeCompare(
          `${b.profileId}::${b.revision}::${b.purpose}`,
        ),
      );
    mcpProfilesDigest = createHash("sha256")
      .update(canonicalJson(canonicalEntries))
      .digest("hex");
  }

  return {
    fundedInferenceEnabled: env.FUNDED_INFERENCE === "1",
    byokEnabled: env.BYOK_ENABLED === "1",
    searchToolsEnabled,
    attachmentsEnabled: env.ATTACHMENTS_ENABLED === "1",
    imagesEnabled: env.IMAGES_ENABLED === "1",
    mcpClientEnabled,
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
    searchActorHourlyRequests,
    searchActorDailyRequests,
    searchGlobalDailyRequests,
    searchActorDailyMicrodollars,
    searchGlobalDailyMicrodollars,
    searchMaxResults: SEARCH_LIMITS.results,
    searchTimeoutMs: SEARCH_LIMITS.timeoutMs,
    searchContextBytes: SEARCH_LIMITS.contextBytes,
    searchTransportBytes: SEARCH_LIMITS.transportBytes,
    byokHourlyLimit: BYOK_LIMITS.hourly,
    byokDailyLimit: BYOK_LIMITS.daily,
    byokGlobalDailyLimit: BYOK_LIMITS.globalDaily,
    byokActorConcurrency: BYOK_LIMITS.actorConcurrency,
    byokGlobalConcurrency: BYOK_LIMITS.globalConcurrency,
    byokActorRecords: BYOK_LIMITS.actorRecords,
    byokGlobalRecords: BYOK_LIMITS.globalRecords,
    byokMetadataBytes: BYOK_LIMITS.metadataBytes,
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
    attachmentMaxFileBytes: attachmentLimits.fileBytes,
    attachmentMaxPerMessage: attachmentLimits.perMessage,
    attachmentUploadLeaseMs: attachmentLimits.uploadLeaseMs,
    imageMaxBytes: imageLimits.bytes,
    imageMaxMilliseconds: imageLimits.milliseconds,
    imageMaxPromptCharacters: imageLimits.prompt,
    mcpMaxProfiles: MCP_CLIENT_LIMITS.maxProfiles,
    mcpMaxTimeoutMs: MCP_CLIENT_LIMITS.maxTimeoutMs,
    mcpMaxRequestBytes: MCP_CLIENT_LIMITS.maxRequestBytes,
    mcpMaxEnvelopeBytes: MCP_CLIENT_LIMITS.maxEnvelopeBytes,
    mcpMaxTransportResponseBytes: MCP_CLIENT_LIMITS.maxTransportResponseBytes,
    mcpMaxDecodedBodyBytes: MCP_CLIENT_LIMITS.maxDecodedBodyBytes,
    mcpProfilesDigest,
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
