import "server-only";
import { createHmac } from "node:crypto";
import { sql } from "drizzle-orm";
import type { EnvSource } from "@/lib/auth/env";
import { type EntryValidation, requireDb } from "@/lib/db/client";
import { AppError } from "@/lib/errors";
import { deepFreeze } from "@/lib/funding/config";
import { assertActivePlanInTx } from "@/lib/funding/store";
import {
  assertExactFundingConfigMatch,
  assertExactPriceMatch,
  DAILY_MICRODOLLARS,
  type FundingConfig,
  LIMITS,
  type PriceSnapshot,
  resolveFundingConfig,
  utcWindows,
} from "./config";

type Db = ReturnType<typeof requireDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type ClockSource = Date | (() => Date);
export type Actor = { key: string; kind: "user" | "guest" };
export type Reservation = {
  id: string;
  actor_key: string;
  actor_kind: "user" | "guest";
  state: "reserved" | "entered" | "held" | "settled" | "released";
  reserved_microdollars: number;
  charged_microdollars: number;
  incurred_microdollars: number;
  request_digest: string;
  day?: string;
  month?: string;
  price_snapshot: PriceSnapshot;
  plan_month?: string | null;
  plan_revision?: string | null;
  plan_digest?: string | null;
  plan_capacity_digest?: string | null;
};
export type Totals = {
  daily: number;
  monthly: number;
  actorActive: number;
  globalActive: number;
  stopped: boolean;
};
const pending = sql`state IN ('reserved', 'entered', 'held')`;
async function lock(tx: Tx) {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(41021406)`);
}
async function audit(
  tx: Tx,
  id: string,
  event: string,
  amount: number,
  evidence: Record<string, unknown> = {},
) {
  await tx.execute(
    sql`INSERT INTO public.credit_ledger(id, reservation_id, event, microdollars, evidence) VALUES (${crypto.randomUUID()}, ${id}, ${event}, ${amount}, ${JSON.stringify(evidence)}::jsonb)`,
  );
}
async function totals(tx: Tx, actor: Actor, now: Date): Promise<Totals> {
  const { day, month } = utcWindows(now);
  const [row] = await tx.execute<{
    daily: number;
    monthly: number;
    actor_active: number;
    global_active: number;
  }>(sql`
    SELECT
      coalesce(sum(charged_microdollars) FILTER (WHERE actor_key = ${actor.key} AND (day = ${day} OR ${pending})), 0)::integer AS daily,
      coalesce(sum(charged_microdollars) FILTER (WHERE month = ${month} OR ${pending}), 0)::integer AS monthly,
      count(*) FILTER (WHERE actor_key = ${actor.key} AND ${pending})::integer AS actor_active,
      count(*) FILTER (WHERE ${pending})::integer AS global_active
    FROM public.credit_reservation`);
  const [control] = await tx.execute<{ stopped: boolean }>(
    sql`SELECT stopped FROM public.funding_control WHERE id = 'platform'`,
  );
  if (!row || !control) throw new AppError("funding_unconfigured", 503);
  return {
    daily: row.daily,
    monthly: row.monthly,
    actorActive: row.actor_active,
    globalActive: row.global_active,
    stopped: control.stopped,
  };
}
export function actorFor(
  kind: Actor["kind"],
  id: string,
  secret: string,
): Actor {
  if (secret.length < 32 || !id)
    throw new AppError("funding_unconfigured", 503);
  return {
    kind,
    key: createHmac("sha256", secret).update(`${kind}:${id}`).digest("hex"),
  };
}

export class CreditStore {
  constructor(
    private readonly db: Db = requireDb(),
    private readonly envProvider: EnvSource | (() => EnvSource) = () =>
      process.env,
  ) {}

  private getEnv(): EnvSource {
    return typeof this.envProvider === "function"
      ? this.envProvider()
      : this.envProvider;
  }

  private transaction<T>(run: (tx: Tx) => Promise<T>) {
    // After waiting for the advisory lock, each statement must see the latest
    // committed budget. Do not inherit a pool role's repeatable-read default.
    return this.db.transaction(run, { isolationLevel: "read committed" });
  }

  async status(actor: Actor, now = new Date()) {
    return this.transaction(async (tx) => {
      await lock(tx);
      return totals(tx, actor, now);
    });
  }

  /** The final awaited statement samples control and DB wall time together.
   * Runtime config is resolved synchronously afterwards from the authoritative
   * provider, so no earlier config/price/clock snapshot can authorize entry.
   */
  private async currentFunding(
    tx: Tx,
    expected?: FundingConfig,
    clockSource?: ClockSource,
  ) {
    const [observation] = await tx.execute<{ now: Date; stopped: boolean }>(
      sql`SELECT clock_timestamp() AS now, stopped FROM public.funding_control WHERE id='platform'`,
    );
    if (!observation || observation.stopped)
      throw new AppError("funded_inference_disabled", 503);
    const now =
      typeof clockSource === "function"
        ? clockSource()
        : (clockSource ?? new Date(observation.now));
    const config = resolveFundingConfig(this.getEnv(), now);
    if (expected) assertExactFundingConfigMatch(expected, config);
    return { now, config, ...utcWindows(now) };
  }

  private assertSamePeriod(initial: Date, current: Date) {
    const before = utcWindows(initial),
      after = utcWindows(current);
    if (before.month !== after.month)
      throw new AppError("budget_month_not_current", 400);
    if (before.day !== after.day)
      throw new AppError("funding_period_changed", 409);
  }

  private assertBinding(row: Reservation, config: FundingConfig) {
    assertExactPriceMatch(row.price_snapshot, config.price);
    if (
      row.plan_month !== config.plan.month ||
      row.plan_revision !== config.plan.revision ||
      row.plan_digest !== config.plan.digest ||
      row.plan_capacity_digest !== config.plan.capacityDigest
    )
      throw new AppError("plan_identity_mismatch", 409);
  }

  private assertPlan(
    tx: Tx,
    config: FundingConfig,
    clockSource?: ClockSource,
    incoming = 0,
  ) {
    return assertActivePlanInTx(
      tx,
      config.plan,
      () => this.getEnv(),
      clockSource,
      incoming,
    );
  }

  async reserve(options: {
    actor: Actor;
    idempotencyKey: string;
    digest: string;
    config: FundingConfig;
    microdollars: number;
    now?: ClockSource;
    /** Expected caller configuration only; never an authoritative override. */
    env?: EnvSource;
  }): Promise<Reservation> {
    const actor = { ...options.actor };
    const { idempotencyKey, digest, microdollars, now: clockSource } = options;
    const expected = deepFreeze(structuredClone(options.config));
    const callerEnv = options.env ? { ...options.env } : undefined;
    if (
      !/^[a-zA-Z0-9:_-]{1,160}$/.test(idempotencyKey) ||
      !/^[a-f0-9]{64}$/.test(digest) ||
      !Number.isSafeInteger(microdollars) ||
      microdollars < 1 ||
      microdollars > DAILY_MICRODOLLARS
    )
      throw new AppError("invalid_request", 400);

    return this.transaction(async (tx) => {
      await lock(tx);
      const initial = await this.currentFunding(tx, expected, clockSource);
      if (callerEnv)
        assertExactFundingConfigMatch(
          resolveFundingConfig(callerEnv, initial.now),
          initial.config,
        );
      if (initial.config.plan.month !== initial.month)
        throw new AppError("budget_month_not_current", 400);
      const [existing] = await tx.execute<Reservation>(
        sql`SELECT * FROM public.credit_reservation WHERE actor_key=${actor.key} AND idempotency_key=${idempotencyKey}`,
      );
      if (existing)
        throw new AppError(
          existing.request_digest === digest
            ? "request_already_processed"
            : "idempotency_conflict",
          409,
        );
      if (actor.kind === "guest") {
        const used = await tx.execute(
          sql`SELECT actor_key FROM public.guest_usage WHERE actor_key=${actor.key}`,
        );
        if (used.length) throw new AppError("guest_limit_reached", 429);
      }
      const balance = await totals(tx, actor, initial.now);
      if (balance.stopped) throw new AppError("funded_inference_disabled", 503);
      if (balance.daily + microdollars > DAILY_MICRODOLLARS)
        throw new AppError("daily_exhausted", 429);
      if (balance.monthly + microdollars > initial.config.monthlyMicrodollars)
        throw new AppError("shared_exhausted", 429);
      if (
        balance.actorActive >= initial.config.actorConcurrency ||
        balance.globalActive >= initial.config.globalConcurrency
      )
        throw new AppError("funding_busy", 429);

      const plan = await this.assertPlan(
        tx,
        initial.config,
        clockSource,
        microdollars,
      );
      const ready = await this.currentFunding(tx, expected, clockSource);
      this.assertSamePeriod(initial.now, ready.now);
      const id = crypto.randomUUID();
      const [reservation] = await tx.execute<Reservation>(sql`
        INSERT INTO public.credit_reservation(id,actor_key,actor_kind,idempotency_key,request_digest,day,month,
          reserved_microdollars,charged_microdollars,state,price_snapshot,plan_month,plan_revision,plan_digest,plan_capacity_digest)
        VALUES(${id},${actor.key},${actor.kind},${idempotencyKey},${digest},${ready.day},${ready.month},
          ${microdollars},${microdollars},'reserved',${JSON.stringify(ready.config.price)}::jsonb,
          ${plan.month},${plan.revision},${plan.digest},${plan.capacity_digest}) RETURNING *`);
      if (actor.kind === "guest")
        await tx.execute(
          sql`INSERT INTO public.guest_usage(actor_key,reservation_id) VALUES(${actor.key},${id})`,
        );
      await audit(tx, id, "reserved", microdollars, {
        priceSnapshot: ready.config.price,
        bounds: LIMITS,
        purpose: "basic_text",
        day: ready.day,
        month: ready.month,
        plan: {
          month: plan.month,
          revision: plan.revision,
          digest: plan.digest,
          capacityDigest: plan.capacity_digest,
        },
      });
      await this.assertPlan(tx, initial.config, clockSource);
      const final = await this.currentFunding(tx, expected, clockSource);
      this.assertSamePeriod(initial.now, final.now);
      return reservation;
    });
  }

  async enter(
    id: string,
    inputActor: Actor,
    validateEntry?: EntryValidation,
    options?: { now?: ClockSource; env?: EnvSource; config?: FundingConfig },
  ) {
    const actor = { ...inputActor };
    const clockSource = options?.now;
    const expected = options?.config
      ? deepFreeze(structuredClone(options.config))
      : undefined;
    const callerEnv = options?.env ? { ...options.env } : undefined;
    await this.transaction(async (tx) => {
      await lock(tx);
      const [row] = await tx.execute<Reservation>(
        sql`SELECT * FROM public.credit_reservation WHERE id=${id} AND actor_key=${actor.key}`,
      );
      if (
        !row ||
        row.state !== "reserved" ||
        !row.plan_month ||
        !row.plan_revision ||
        !row.plan_digest ||
        !row.plan_capacity_digest
      )
        throw new AppError("request_already_processed", 409);
      const initial = await this.currentFunding(tx, expected, clockSource);
      if (callerEnv)
        assertExactFundingConfigMatch(
          resolveFundingConfig(callerEnv, initial.now),
          initial.config,
        );
      if (row.month !== initial.month || row.plan_month !== initial.month)
        throw new AppError("budget_month_not_current", 400);
      this.assertBinding(row, initial.config);
      await validateEntry?.(tx);
      await this.assertPlan(tx, initial.config, clockSource);
      const ready = await this.currentFunding(tx, initial.config, clockSource);
      this.assertSamePeriod(initial.now, ready.now);
      this.assertBinding(row, ready.config);
      const rows =
        await tx.execute(sql`UPDATE public.credit_reservation SET state='entered',updated_at=now()
        WHERE id=${id} AND actor_key=${actor.key} AND state='reserved' RETURNING id`);
      if (!rows.length) throw new AppError("request_already_processed", 409);
      await audit(tx, id, "provider_entered", 0, {
        plan: {
          month: row.plan_month,
          revision: row.plan_revision,
          digest: row.plan_digest,
          capacityDigest: row.plan_capacity_digest,
        },
      });
      await this.assertPlan(tx, initial.config, clockSource);
      const final = await this.currentFunding(tx, initial.config, clockSource);
      this.assertSamePeriod(initial.now, final.now);
      this.assertBinding(row, final.config);
    });
  }
  async finish(
    id: string,
    actor: Actor,
    outcome:
      | {
          kind: "unknown" | "before_entry";
          evidence?: string;
          incurredMicrodollars?: number;
          stop?: boolean;
        }
      | {
          kind: "known";
          microdollars: number;
          evidence: string;
          usage: Record<string, unknown>;
        },
  ) {
    return this.transaction(async (tx) => {
      await lock(tx);
      const [row] = await tx.execute<Reservation>(
        sql`SELECT * FROM public.credit_reservation WHERE id = ${id} AND actor_key = ${actor.key}`,
      );
      if (!row) throw new AppError("not_found", 404);
      if (row.state === "settled" || row.state === "released") {
        if (
          outcome.kind === "known" &&
          row.charged_microdollars !== outcome.microdollars
        )
          throw new AppError("settlement_conflict", 409);
        return row.state;
      }
      let state: Reservation["state"] = "held";
      let charge = row.charged_microdollars;
      let incurredMinimum = row.incurred_microdollars;
      if (outcome.kind === "before_entry" && row.state === "reserved") {
        state = "released";
        charge = 0;
      }
      if (outcome.kind === "unknown") {
        const incurred = outcome.incurredMicrodollars ?? 0;
        if (
          !Number.isSafeInteger(incurred) ||
          incurred < 0 ||
          incurred > 2_000_000_000
        )
          throw new AppError("invalid_settlement", 400);
        charge = Math.max(charge, incurred);
        incurredMinimum = Math.max(incurredMinimum, incurred);
        if (outcome.stop || incurred > row.reserved_microdollars) {
          await tx.execute(
            sql`UPDATE public.funding_control SET stopped = true WHERE id = 'platform'`,
          );
          await audit(tx, id, "provider_incident", charge, {
            reference: outcome.evidence ?? "unverified-usage",
          });
        }
      }
      if (outcome.kind === "known") {
        if (
          row.state === "reserved" ||
          !Number.isSafeInteger(outcome.microdollars) ||
          outcome.microdollars < 0 ||
          !outcome.evidence.trim()
        )
          throw new AppError("invalid_settlement", 400);
        if (outcome.microdollars < incurredMinimum)
          throw new AppError("settlement_below_incurred", 409);
        incurredMinimum = outcome.microdollars;
        state = "settled";
        if (outcome.microdollars > row.reserved_microdollars) {
          // A final receipt records the entire bill and stops further funding.
          await tx.execute(
            sql`UPDATE public.funding_control SET stopped = true WHERE id = 'platform'`,
          );
          await audit(tx, id, "bound_violation", outcome.microdollars, {
            reference: outcome.evidence,
          });
          charge = outcome.microdollars;
        } else {
          state = "settled";
          charge = outcome.microdollars;
        }
      }
      if (
        row.state === state &&
        charge === row.charged_microdollars &&
        incurredMinimum === row.incurred_microdollars
      )
        return state;
      await tx.execute(
        sql`UPDATE public.credit_reservation SET state = ${state}, charged_microdollars = ${charge}, incurred_microdollars = ${incurredMinimum}, usage = ${outcome.kind === "known" ? JSON.stringify(outcome.usage) : null}::jsonb, updated_at = now() WHERE id = ${id}`,
      );
      await audit(tx, id, state, charge, {
        reference: outcome.evidence,
        incurredMicrodollars: incurredMinimum,
      });
      return state;
    });
  }
  async guestUsed(actor: Actor) {
    const rows = await this.db.execute(
      sql`SELECT actor_key FROM public.guest_usage WHERE actor_key = ${actor.key}`,
    );
    return rows.length > 0;
  }
  async guestAttempt(networkKey: string, now = new Date()) {
    // Commit attempts even when a later bot/guest/budget check rejects a request.
    const attempts = await this.transaction(async (tx) => {
      await lock(tx);
      const [row] = await tx.execute<{ attempts: number }>(
        sql`INSERT INTO public.guest_rate(network_key, hour, attempts) VALUES (${networkKey}, ${now.toISOString().slice(0, 13)}, 1) ON CONFLICT(network_key, hour) DO UPDATE SET attempts = guest_rate.attempts + 1 RETURNING attempts`,
      );
      return row.attempts;
    });
    if (attempts > 3) throw new AppError("guest_rate_limited", 429);
  }
  // Reconciliation is explicit: reserved rows may be safely released before entry;
  // entered/held rows require a final provider receipt, including verified zero.
  async operatorPending() {
    return this.db.execute(
      sql`SELECT id, actor_key, actor_kind, state, reserved_microdollars, charged_microdollars, incurred_microdollars, price_snapshot, created_at FROM public.credit_reservation WHERE ${pending} ORDER BY created_at LIMIT 100`,
    );
  }
  // Server-only operator view. No HTTP route exposes aggregate balances or IDs.
  async operatorView() {
    return this.db.execute(
      sql`SELECT month, state, count(*)::integer AS requests, sum(charged_microdollars)::bigint::text AS microdollars FROM public.credit_reservation GROUP BY month, state ORDER BY month DESC, state`,
    );
  }
}
