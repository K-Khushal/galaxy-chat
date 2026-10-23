import "server-only";
import { sql } from "drizzle-orm";
import type { EnvSource } from "@/lib/auth/env";
import { type DatabaseTransaction, requireDb } from "@/lib/db/client";
import { AppError } from "@/lib/errors";
import {
  type BudgetPlanInput,
  type CapacitySnapshot,
  type CoverageAssertions,
  computeCapacityDigest,
  computePlanDigest,
  FUNDING_ADVISORY_LOCK_ID,
  type PlatformBudgetConfig,
  parseBudgetPlanInput,
  resolveCurrentCapacitySnapshot,
  resolvePlatformBudgetConfig,
  validateBudgetPlanArithmetics,
} from "./config";

type Db = ReturnType<typeof requireDb>;

export type BudgetPlanRow = {
  month: string;
  revision: string;
  digest: string;
  b_selected: number;
  a_credit: number;
  a_mcp: number;
  k_infra: number;
  k_provider_fees: number;
  k_safety: number;
  l_carried: number;
  reviewed_at: Date;
  expires_at: Date;
  coverage_proof_reference: string;
  coverage_proof_digest: string;
  coverage_assertions: CoverageAssertions;
  capacity_snapshot: CapacitySnapshot;
  capacity_digest: string;
  created_at: Date;
};

export type PlatformBudgetCarryRow = {
  id: string;
  month: string;
  source_reservation_id: string;
  actor_key: string;
  amount_microdollars: number;
  created_at: Date;
};

export type AssertActivePlanOptions = {
  month: string;
  expectedRevision: string;
  expectedDigest: string;
  expectedCapacityDigest?: string;
};

export type { BudgetPlanInput } from "./config";
export type ActivePlanInputSnapshot =
  | AssertActivePlanOptions
  | {
      month: string;
      revision: string;
      digest: string;
      capacityDigest?: string;
    };

export async function assertActivePlanInTx(
  tx: DatabaseTransaction,
  expected: Readonly<ActivePlanInputSnapshot>,
  env: EnvSource = process.env,
  clockProvider?: Date | (() => Date),
  incoming = 0,
): Promise<BudgetPlanRow> {
  if (!expected || typeof expected !== "object") {
    throw new AppError("invalid_request", 400);
  }
  if (
    typeof incoming !== "number" ||
    !Number.isSafeInteger(incoming) ||
    incoming < 0
  ) {
    throw new AppError("invalid_request", 400);
  }

  const snapMonth = String(expected.month ?? "");
  const snapRevision = String(
    "expectedRevision" in expected
      ? (expected.expectedRevision ?? "")
      : "revision" in expected
        ? (expected.revision ?? "")
        : "",
  );
  const snapDigest = String(
    "expectedDigest" in expected
      ? (expected.expectedDigest ?? "")
      : "digest" in expected
        ? (expected.digest ?? "")
        : "",
  );
  const rawCapDigest =
    "expectedCapacityDigest" in expected
      ? expected.expectedCapacityDigest
      : "capacityDigest" in expected
        ? expected.capacityDigest
        : undefined;
  const snapCapacityDigest = rawCapDigest ? String(rawCapDigest) : undefined;

  const [control] = await tx.execute<{ stopped: boolean }>(
    sql`SELECT stopped FROM public.funding_control WHERE id = 'platform'`,
  );
  if (!control || control.stopped) {
    throw new AppError("funded_inference_disabled", 503);
  }

  const [clock] = await tx.execute<{ now: Date }>(
    sql`SELECT clock_timestamp() AS now`,
  );
  const now =
    typeof clockProvider === "function"
      ? clockProvider()
      : (clockProvider ?? new Date(clock.now));

  if (!/^[0-9]{4}-(0[1-9]|1[0-2])$/.test(snapMonth)) {
    throw new AppError("invalid_budget_month", 400);
  }

  const currentUtcMonth = now.toISOString().slice(0, 7);
  if (snapMonth !== currentUtcMonth) {
    throw new AppError("budget_month_not_current", 400);
  }

  // Fresh config resolution AFTER awaited lock
  const runtimeConfig = resolvePlatformBudgetConfig(env, now);
  if (!runtimeConfig || !runtimeConfig.enabled) {
    throw new AppError("platform_budget_disabled", 503);
  }
  if (
    runtimeConfig.plan.month !== snapMonth ||
    runtimeConfig.plan.revision !== snapRevision ||
    runtimeConfig.digest !== snapDigest
  ) {
    throw new AppError("plan_candidate_mismatch", 400);
  }
  if (
    snapCapacityDigest &&
    runtimeConfig.capacityDigest !== snapCapacityDigest
  ) {
    throw new AppError("capacity_drift", 503);
  }

  const [plan] = await tx.execute<BudgetPlanRow>(
    sql`SELECT * FROM public.platform_budget_plan WHERE month = ${snapMonth}`,
  );
  if (!plan) {
    throw new AppError("budget_plan_missing", 503);
  }

  if (plan.revision !== snapRevision || plan.digest !== snapDigest) {
    throw new AppError("plan_identity_mismatch", 409);
  }
  if (snapCapacityDigest && plan.capacity_digest !== snapCapacityDigest) {
    throw new AppError("capacity_drift", 503);
  }

  await verifyActiveEnvironmentAndClock(
    tx,
    {
      month: plan.month,
      revision: plan.revision,
      digest: plan.digest,
      capacityDigest: plan.capacity_digest,
      reviewedAt: plan.reviewed_at,
      expiresAt: plan.expires_at,
    },
    env,
    now,
  );

  // Verify no uncarried or increased legacy exposure from prior months against frozen carry rows
  await checkUncoveredLegacyExposure(tx, snapMonth);

  const [currentCredit] = await tx.execute<{ total: string }>(sql`
    SELECT coalesce(sum(charged_microdollars), 0)::bigint AS total
    FROM public.credit_reservation
    WHERE month = ${snapMonth}
  `);
  const creditCharged = Number(currentCredit?.total ?? 0);
  if (creditCharged + incoming > plan.a_credit) {
    throw new AppError("credit_allocation_exhausted", 429);
  }

  const K = plan.k_infra + plan.k_provider_fees + plan.k_safety;
  const totalExposure =
    creditCharged + incoming + plan.a_mcp + K + plan.l_carried;
  if (totalExposure > plan.b_selected) {
    throw new AppError("platform_ceiling_exhausted", 429);
  }

  // Final re-evaluation immediately before return
  await verifyActiveEnvironmentAndClock(
    tx,
    {
      month: plan.month,
      revision: plan.revision,
      digest: plan.digest,
      capacityDigest: plan.capacity_digest,
      reviewedAt: plan.reviewed_at,
      expiresAt: plan.expires_at,
    },
    env,
    now,
  );

  return plan;
}

type ActiveValidationExpectations = {
  month: string;
  revision: string;
  digest: string;
  capacityDigest: string;
  reviewedAt: string | Date;
  expiresAt: string | Date;
};

export async function lockFunding(tx: DatabaseTransaction): Promise<void> {
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(${FUNDING_ADVISORY_LOCK_ID})`,
  );
}

/**
 * Shared helper to verify that fresh DB clock, funding_control, runtime environment,
 * candidate revision/digest, and capacity snapshot all remain valid.
 */
async function verifyActiveEnvironmentAndClock(
  tx: DatabaseTransaction,
  expected: ActiveValidationExpectations,
  env: EnvSource,
  nowProvider?: Date | (() => Date),
): Promise<{ now: Date; runtimeConfig: PlatformBudgetConfig }> {
  const [control] = await tx.execute<{ stopped: boolean }>(
    sql`SELECT stopped FROM public.funding_control WHERE id = 'platform'`,
  );
  if (!control || control.stopped) {
    throw new AppError("funded_inference_disabled", 503);
  }

  const [clock] = await tx.execute<{ now: Date }>(
    sql`SELECT clock_timestamp() AS now`,
  );
  const now =
    typeof nowProvider === "function"
      ? nowProvider()
      : (nowProvider ?? new Date(clock.now));

  if (!/^[0-9]{4}-(0[1-9]|1[0-2])$/.test(expected.month)) {
    throw new AppError("invalid_budget_month", 400);
  }

  const currentUtcMonth = now.toISOString().slice(0, 7);
  if (expected.month !== currentUtcMonth) {
    throw new AppError("budget_month_not_current", 400);
  }

  const runtimeConfig = resolvePlatformBudgetConfig(env, now);
  if (!runtimeConfig || !runtimeConfig.enabled) {
    throw new AppError("platform_budget_disabled", 503);
  }
  if (
    runtimeConfig.plan.month !== expected.month ||
    runtimeConfig.plan.revision !== expected.revision ||
    runtimeConfig.digest !== expected.digest
  ) {
    throw new AppError("plan_candidate_mismatch", 400);
  }

  const reviewedTime = new Date(expected.reviewedAt).getTime();
  const expiresTime = new Date(expected.expiresAt).getTime();
  if (reviewedTime > now.getTime()) {
    throw new AppError("plan_reviewed_in_future", 400);
  }
  if (expiresTime <= now.getTime()) {
    throw new AppError("plan_coverage_expired", 503);
  }

  const currentCaps = resolveCurrentCapacitySnapshot(env);
  const currentCapDigest = computeCapacityDigest(currentCaps);
  if (currentCapDigest !== expected.capacityDigest) {
    throw new AppError("capacity_drift", 503);
  }

  return { now, runtimeConfig };
}

/**
 * Shared helper to inspect current month's persisted carry rows against fresh prior-month
 * pending holds. Rejects if any prior pending hold is missing or has increased.
 */
async function checkUncoveredLegacyExposure(
  tx: DatabaseTransaction,
  month: string,
): Promise<void> {
  const [uncarried] = await tx.execute<{ count: number }>(sql`
    SELECT count(*)::integer AS count
    FROM public.credit_reservation r
    LEFT JOIN public.platform_budget_carry c
      ON c.month = ${month} AND c.source_reservation_id = r.id
    WHERE r.month < ${month}
      AND r.state IN ('reserved', 'entered', 'held')
      AND (c.source_reservation_id IS NULL OR r.charged_microdollars > c.amount_microdollars)
  `);
  if (uncarried && uncarried.count > 0) {
    throw new AppError("uncovered_legacy_exposure", 503);
  }
}

export class PlatformBudgetStore {
  constructor(private readonly db: Db = requireDb()) {}

  /**
   * Internal server-only API to register an operator-reviewed monthly budget plan.
   * Clones and freezes candidate input to prevent caller mutations across awaits.
   * Enforces immutability: returns identical existing plan on exact match, or rejects
   * conflicts with 409. Bootstraps durable multi-month carry union from all prior carry
   * rows and prior pending credit reservations. Both new and repeat calls verify credit exposure
   * and fail closed if uncarried or increased legacy exposure exists.
   */
  async registerReviewedPlan(
    planCandidate: unknown,
    env: EnvSource = process.env,
    testNow?: Date | (() => Date),
  ): Promise<BudgetPlanRow> {
    const planInput: BudgetPlanInput = parseBudgetPlanInput(planCandidate);
    validateBudgetPlanArithmetics(planInput);

    const computedDigest = computePlanDigest(planInput);
    const computedCapacityDigest = computeCapacityDigest(
      planInput.capacitySnapshot,
    );

    return this.db.transaction(
      async (tx) => {
        await lockFunding(tx);

        await verifyActiveEnvironmentAndClock(
          tx,
          {
            month: planInput.month,
            revision: planInput.revision,
            digest: computedDigest,
            capacityDigest: computedCapacityDigest,
            reviewedAt: planInput.reviewedAt,
            expiresAt: planInput.expiresAt,
          },
          env,
          testNow,
        );

        const [existing] = await tx.execute<BudgetPlanRow>(
          sql`SELECT * FROM public.platform_budget_plan WHERE month = ${planInput.month}`,
        );

        if (existing) {
          if (
            existing.revision !== planInput.revision ||
            existing.digest !== computedDigest
          ) {
            throw new AppError("plan_conflict", 409);
          }

          // Credit exposure checks on existing plan
          const [currentCredit] = await tx.execute<{ total: string }>(sql`
            SELECT coalesce(sum(charged_microdollars), 0)::bigint AS total
            FROM public.credit_reservation
            WHERE month = ${existing.month}
          `);
          const creditCharged = Number(currentCredit?.total ?? 0);
          if (creditCharged > existing.a_credit) {
            throw new AppError("credit_allocation_exhausted", 429);
          }

          const K =
            existing.k_infra + existing.k_provider_fees + existing.k_safety;
          const totalExposure =
            creditCharged + existing.a_mcp + K + existing.l_carried;
          if (totalExposure > existing.b_selected) {
            throw new AppError("platform_ceiling_exhausted", 429);
          }

          // Uncovered legacy exposure check against frozen persisted carry rows
          await checkUncoveredLegacyExposure(tx, existing.month);

          // Re-evaluate fresh clock, control, config, capacity immediately before returning
          await verifyActiveEnvironmentAndClock(
            tx,
            {
              month: existing.month,
              revision: existing.revision,
              digest: existing.digest,
              capacityDigest: existing.capacity_digest,
              reviewedAt: existing.reviewed_at,
              expiresAt: existing.expires_at,
            },
            env,
            testNow,
          );

          return existing;
        }

        // Multi-month durable carry union: ALL prior carry sources + prior pending holds
        const priorCarryRows = await tx.execute<{
          source_reservation_id: string;
          actor_key: string;
          carried_amount: string;
        }>(sql`
          SELECT source_reservation_id, actor_key, max(amount_microdollars)::bigint AS carried_amount
          FROM public.platform_budget_carry
          WHERE month < ${planInput.month}
          GROUP BY source_reservation_id, actor_key
        `);

        const priorPendingRows = await tx.execute<{
          source_reservation_id: string;
          actor_key: string;
          pending_amount: string;
        }>(sql`
          SELECT id AS source_reservation_id, actor_key, charged_microdollars::bigint AS pending_amount
          FROM public.credit_reservation
          WHERE month < ${planInput.month} AND state IN ('reserved', 'entered', 'held')
        `);

        const carryUnionMap = new Map<
          string,
          { actorKey: string; amount: number }
        >();
        for (const row of priorCarryRows) {
          carryUnionMap.set(row.source_reservation_id, {
            actorKey: row.actor_key,
            amount: Number(row.carried_amount),
          });
        }
        for (const row of priorPendingRows) {
          const existingCarry = carryUnionMap.get(row.source_reservation_id);
          const pendingAmt = Number(row.pending_amount);
          if (existingCarry) {
            existingCarry.amount = Math.max(existingCarry.amount, pendingAmt);
          } else {
            carryUnionMap.set(row.source_reservation_id, {
              actorKey: row.actor_key,
              amount: pendingAmt,
            });
          }
        }

        let calculatedCarry = 0;
        for (const entry of carryUnionMap.values()) {
          calculatedCarry += entry.amount;
        }

        if (planInput.lCarried < calculatedCarry) {
          throw new AppError("carried_liability_insufficient", 400);
        }

        const [currentCredit] = await tx.execute<{ total: string }>(sql`
          SELECT coalesce(sum(charged_microdollars), 0)::bigint AS total
          FROM public.credit_reservation
          WHERE month = ${planInput.month}
        `);
        const creditCharged = Number(currentCredit?.total ?? 0);
        if (creditCharged > planInput.aCredit) {
          throw new AppError("credit_allocation_exhausted", 429);
        }

        const K =
          planInput.kInfra + planInput.kProviderFees + planInput.kSafety;
        const totalExposure =
          creditCharged + planInput.aMcp + K + planInput.lCarried;
        if (totalExposure > planInput.bSelected) {
          throw new AppError("platform_ceiling_exhausted", 429);
        }

        // Re-eval immediately before INSERT
        await verifyActiveEnvironmentAndClock(
          tx,
          {
            month: planInput.month,
            revision: planInput.revision,
            digest: computedDigest,
            capacityDigest: computedCapacityDigest,
            reviewedAt: planInput.reviewedAt,
            expiresAt: planInput.expiresAt,
          },
          env,
          testNow,
        );

        const [inserted] = await tx.execute<BudgetPlanRow>(sql`
          INSERT INTO public.platform_budget_plan (
            month, revision, digest, b_selected, a_credit, a_mcp,
            k_infra, k_provider_fees, k_safety, l_carried,
            reviewed_at, expires_at, coverage_proof_reference, coverage_proof_digest,
            coverage_assertions, capacity_snapshot, capacity_digest
          ) VALUES (
            ${planInput.month}, ${planInput.revision}, ${computedDigest}, ${planInput.bSelected},
            ${planInput.aCredit}, ${planInput.aMcp}, ${planInput.kInfra}, ${planInput.kProviderFees},
            ${planInput.kSafety}, ${planInput.lCarried}, ${planInput.reviewedAt}, ${planInput.expiresAt},
            ${planInput.coverageProofReference}, ${planInput.coverageProofDigest},
            ${JSON.stringify(planInput.coverageAssertions)}::jsonb,
            ${JSON.stringify(planInput.capacitySnapshot)}::jsonb,
            ${computedCapacityDigest}
          ) RETURNING *
        `);

        // Persist carry union rows for the month
        for (const [sourceId, entry] of carryUnionMap.entries()) {
          await tx.execute(sql`
            INSERT INTO public.platform_budget_carry (
              id, month, source_reservation_id, actor_key, amount_microdollars
            ) VALUES (
              ${crypto.randomUUID()}, ${planInput.month}, ${sourceId}, ${entry.actorKey}, ${entry.amount}
            ) ON CONFLICT (month, source_reservation_id) DO NOTHING
          `);
        }

        // Re-eval immediately before transaction return (after late await during carry inserts)
        await verifyActiveEnvironmentAndClock(
          tx,
          {
            month: inserted.month,
            revision: inserted.revision,
            digest: inserted.digest,
            capacityDigest: inserted.capacity_digest,
            reviewedAt: inserted.reviewed_at,
            expiresAt: inserted.expires_at,
          },
          env,
          testNow,
        );

        return inserted;
      },
      { isolationLevel: "read committed" },
    );
  }

  /**
   * Internal server-only API to assert that an active, unexpired budget plan covers
   * the requested month with matching revision and digest, without capacity drift or uncarried legacy exposure.
   */
  async assertActivePlan(
    expected: AssertActivePlanOptions,
    env: EnvSource = process.env,
    testNow?: Date | (() => Date),
  ): Promise<BudgetPlanRow> {
    return this.db.transaction(
      async (tx) => {
        await lockFunding(tx);
        return assertActivePlanInTx(tx, expected, env, testNow, 0);
      },
      { isolationLevel: "read committed" },
    );
  }

  async getPlan(month: string): Promise<BudgetPlanRow | null> {
    const [row] = await this.db.execute<BudgetPlanRow>(
      sql`SELECT * FROM public.platform_budget_plan WHERE month = ${month}`,
    );
    return row ?? null;
  }

  async getCarryRows(month: string): Promise<PlatformBudgetCarryRow[]> {
    return this.db.execute<PlatformBudgetCarryRow>(
      sql`SELECT * FROM public.platform_budget_carry WHERE month = ${month} ORDER BY created_at ASC`,
    );
  }
}
