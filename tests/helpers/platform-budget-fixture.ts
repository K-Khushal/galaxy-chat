import type { EnvSource } from "@/lib/auth/env";
import type { requireDb } from "@/lib/db/client";
import {
  type BudgetPlanInput,
  resolveCurrentCapacitySnapshot,
} from "@/lib/funding/config";
import type { BudgetPlanRow } from "@/lib/funding/store";

type Db = ReturnType<typeof requireDb>;

/**
 * Construct an operator-reviewed budget plan matching current environment capacity bounds.
 * Arithmetic invariants and coverage assertions strictly enforced.
 */
export function createReviewedBudgetPlan(
  overrides: Partial<BudgetPlanInput> = {},
  envOverride: EnvSource = process.env,
  now = new Date(),
): BudgetPlanInput {
  const currentCaps = resolveCurrentCapacitySnapshot(envOverride);
  const capacitySnapshot = {
    ...currentCaps,
    ...overrides.capacitySnapshot,
  };

  const month = overrides.month ?? now.toISOString().slice(0, 7);
  const aCredit =
    overrides.aCredit ?? capacitySnapshot.fundedMonthlyMicrodollars;
  const kInfra = overrides.kInfra ?? capacitySnapshot.platformInfraMicrodollars;
  const kProviderFees =
    overrides.kProviderFees ??
    capacitySnapshot.platformProviderFeesMicrodollars;
  const kSafety =
    overrides.kSafety ?? capacitySnapshot.platformSafetyReserveMicrodollars;
  const aMcp = overrides.aMcp ?? 0;
  const lCarried = overrides.lCarried ?? 0;
  const bSelected =
    overrides.bSelected ??
    aCredit + aMcp + kInfra + kProviderFees + kSafety + lCarried;

  return {
    month,
    revision: overrides.revision ?? crypto.randomUUID(),
    bSelected,
    aCredit,
    aMcp,
    kInfra,
    kProviderFees,
    kSafety,
    lCarried,
    reviewedAt:
      overrides.reviewedAt ?? new Date(now.getTime() - 3600_000).toISOString(),
    expiresAt:
      overrides.expiresAt ??
      new Date(now.getTime() + 86400_000 * 365).toISOString(),
    coverageProofReference:
      overrides.coverageProofReference ?? "reviewed-fixture-coverage-proof",
    coverageProofDigest: overrides.coverageProofDigest ?? "a".repeat(64),
    coverageAssertions: {
      infra: true,
      storage: true,
      transfer: true,
      database: true,
      queues: true,
      ordinaryByok: true,
      accountLevelCharges: true,
      conservativeLegacyUnknownExposure: true,
      ...overrides.coverageAssertions,
    },
    capacitySnapshot,
  };
}

/**
 * Configure environment source with valid platform budget variables.
 */
export function configureBudgetEnv(
  baseEnv: EnvSource,
  plan: BudgetPlanInput,
): EnvSource {
  return {
    ...baseEnv,
    PLATFORM_BUDGET_ENABLED: "1",
    PLATFORM_BUDGET_PLAN_JSON: JSON.stringify(plan),
    FUNDED_MONTHLY_MICRODOLLARS: String(plan.aCredit),
    PLATFORM_INFRA_MICRODOLLARS: String(plan.kInfra),
    PLATFORM_PROVIDER_FEES_MICRODOLLARS: String(plan.kProviderFees),
    PLATFORM_SAFETY_RESERVE_MICRODOLLARS: String(plan.kSafety),
  };
}

/**
 * Explicitly register a reviewed budget plan using the actual PlatformBudgetStore.
 */
export async function registerReviewedBudgetPlan(
  db: Db,
  plan: BudgetPlanInput,
  env: EnvSource,
  nowProvider?: Date | (() => Date),
): Promise<BudgetPlanRow> {
  const { PlatformBudgetStore } = await import("@/lib/funding/store");
  const store = new PlatformBudgetStore(db);
  return store.registerReviewedPlan(plan, env, nowProvider);
}
