import "server-only";
import { sql } from "drizzle-orm";
import type { EnvSource } from "@/lib/auth/env";
import { type DatabaseTransaction, requireDb } from "@/lib/db/client";
import { AppError } from "@/lib/errors";
import {
  type BudgetPlanInput,
  budgetPlanInputSchema,
  type CapacitySnapshot,
  type CoverageAssertions,
  computeCapacityDigest,
  computePlanDigest,
  FUNDING_ADVISORY_LOCK_ID,
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
};

export async function lockFunding(tx: DatabaseTransaction): Promise<void> {
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(${FUNDING_ADVISORY_LOCK_ID})`,
  );
}

export class PlatformBudgetStore {
  constructor(private readonly db: Db = requireDb()) {}

  /**
   * Internal server-only API to register an operator-reviewed monthly budget plan.
   * Enforces immutability: returns identical existing plan on exact match, or rejects
   * conflicts with 409. Bootstraps durable multi-month carry union from all prior carry
   * rows and prior pending credit reservations. Both new and repeat calls verify credit exposure.
   */
  async registerReviewedPlan(
    planInput: BudgetPlanInput,
    env: EnvSource = process.env,
    testNow?: Date,
  ): Promise<BudgetPlanRow> {
    budgetPlanInputSchema.parse(planInput);
    validateBudgetPlanArithmetics(planInput);

    const computedDigest = computePlanDigest(planInput);
    const computedCapacityDigest = computeCapacityDigest(
      planInput.capacitySnapshot,
    );

    return this.db.transaction(
      async (tx) => {
        await lockFunding(tx);

        const [clock] = await tx.execute<{ now: Date }>(
          sql`SELECT clock_timestamp() AS now`,
        );
        const now = testNow ?? new Date(clock.now);

        const [control] = await tx.execute<{ stopped: boolean }>(
          sql`SELECT stopped FROM public.funding_control WHERE id = 'platform'`,
        );
        if (!control || control.stopped) {
          throw new AppError("funded_inference_disabled", 503);
        }

        if (!/^[0-9]{4}-(0[1-9]|1[0-2])$/.test(planInput.month)) {
          throw new AppError("invalid_budget_month", 400);
        }

        const currentUtcMonth = now.toISOString().slice(0, 7);
        if (planInput.month !== currentUtcMonth) {
          throw new AppError("budget_month_not_current", 400);
        }

        // Fresh config resolution AFTER awaited lock
        const runtimeConfig = resolvePlatformBudgetConfig(env, now);
        if (!runtimeConfig || !runtimeConfig.enabled) {
          throw new AppError("platform_budget_disabled", 503);
        }
        if (
          runtimeConfig.digest !== computedDigest ||
          runtimeConfig.plan.revision !== planInput.revision
        ) {
          throw new AppError("plan_candidate_mismatch", 400);
        }

        if (new Date(planInput.reviewedAt).getTime() > now.getTime()) {
          throw new AppError("plan_reviewed_in_future", 400);
        }

        if (new Date(planInput.expiresAt).getTime() <= now.getTime()) {
          throw new AppError("plan_coverage_expired", 503);
        }

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

        // Credit exposure checks (runs on BOTH new registration AND idempotent repeat)
        const [currentCredit] = await tx.execute<{ total: string }>(sql`
          SELECT coalesce(sum(charged_microdollars), 0)::bigint AS total
          FROM public.credit_reservation
          WHERE month = ${planInput.month}
        `);
        const creditCharged = Number(currentCredit?.total ?? 0);
        if (creditCharged > planInput.aCredit) {
          throw new AppError("credit_allocation_exhausted", 429);
        }

        for (const row of priorPendingRows) {
          const carried = carryUnionMap.get(row.source_reservation_id);
          if (!carried || Number(row.pending_amount) > carried.amount) {
            throw new AppError("uncovered_legacy_exposure", 503);
          }
        }

        const K =
          planInput.kInfra + planInput.kProviderFees + planInput.kSafety;
        const totalExposure =
          creditCharged + planInput.aMcp + K + planInput.lCarried;
        if (totalExposure > planInput.bSelected) {
          throw new AppError("platform_ceiling_exhausted", 429);
        }

        if (existing) {
          if (new Date(existing.expires_at).getTime() <= now.getTime()) {
            throw new AppError("plan_coverage_expired", 503);
          }
          return existing;
        }

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
    testNow?: Date,
  ): Promise<BudgetPlanRow> {
    return this.db.transaction(
      async (tx) => {
        await lockFunding(tx);

        const [clock] = await tx.execute<{ now: Date }>(
          sql`SELECT clock_timestamp() AS now`,
        );
        const now = testNow ?? new Date(clock.now);

        const [control] = await tx.execute<{ stopped: boolean }>(
          sql`SELECT stopped FROM public.funding_control WHERE id = 'platform'`,
        );
        if (!control || control.stopped) {
          throw new AppError("funded_inference_disabled", 503);
        }

        if (!/^[0-9]{4}-(0[1-9]|1[0-2])$/.test(expected.month)) {
          throw new AppError("invalid_budget_month", 400);
        }

        const currentUtcMonth = now.toISOString().slice(0, 7);
        if (expected.month !== currentUtcMonth) {
          throw new AppError("budget_month_not_current", 400);
        }

        // Fresh config resolution AFTER awaited lock
        const runtimeConfig = resolvePlatformBudgetConfig(env, now);
        if (!runtimeConfig || !runtimeConfig.enabled) {
          throw new AppError("platform_budget_disabled", 503);
        }
        if (
          runtimeConfig.plan.month !== expected.month ||
          runtimeConfig.plan.revision !== expected.expectedRevision ||
          runtimeConfig.digest !== expected.expectedDigest
        ) {
          throw new AppError("plan_candidate_mismatch", 400);
        }

        const [plan] = await tx.execute<BudgetPlanRow>(
          sql`SELECT * FROM public.platform_budget_plan WHERE month = ${expected.month}`,
        );
        if (!plan) {
          throw new AppError("budget_plan_missing", 503);
        }

        if (
          plan.revision !== expected.expectedRevision ||
          plan.digest !== expected.expectedDigest
        ) {
          throw new AppError("plan_identity_mismatch", 409);
        }

        if (new Date(plan.reviewed_at).getTime() > now.getTime()) {
          throw new AppError("plan_reviewed_in_future", 400);
        }

        if (new Date(plan.expires_at).getTime() <= now.getTime()) {
          throw new AppError("plan_coverage_expired", 503);
        }

        const currentCaps = resolveCurrentCapacitySnapshot(env);
        if (computeCapacityDigest(currentCaps) !== plan.capacity_digest) {
          throw new AppError("capacity_drift", 503);
        }

        // Verify no uncarried or increased legacy exposure from prior months
        const [uncarried] = await tx.execute<{ count: number }>(sql`
          SELECT count(*)::integer AS count
          FROM public.credit_reservation r
          LEFT JOIN public.platform_budget_carry c
            ON c.month = ${expected.month} AND c.source_reservation_id = r.id
          WHERE r.month < ${expected.month}
            AND r.state IN ('reserved', 'entered', 'held')
            AND (c.source_reservation_id IS NULL OR r.charged_microdollars > c.amount_microdollars)
        `);
        if (uncarried && uncarried.count > 0) {
          throw new AppError("uncovered_legacy_exposure", 503);
        }

        const [currentCredit] = await tx.execute<{ total: string }>(sql`
          SELECT coalesce(sum(charged_microdollars), 0)::bigint AS total
          FROM public.credit_reservation
          WHERE month = ${expected.month}
        `);
        const creditCharged = Number(currentCredit?.total ?? 0);
        if (creditCharged > plan.a_credit) {
          throw new AppError("credit_allocation_exhausted", 429);
        }

        const K = plan.k_infra + plan.k_provider_fees + plan.k_safety;
        const totalExposure = creditCharged + plan.a_mcp + K + plan.l_carried;
        if (totalExposure > plan.b_selected) {
          throw new AppError("platform_ceiling_exhausted", 429);
        }

        return plan;
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
