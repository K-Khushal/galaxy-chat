import "server-only";
import { createHmac } from "node:crypto";
import { sql } from "drizzle-orm";
import { type EntryValidation, requireDb } from "@/lib/db/client";
import { AppError } from "@/lib/errors";
import {
  DAILY_MICRODOLLARS,
  type FundingConfig,
  LIMITS,
  type PriceSnapshot,
  utcWindows,
} from "./config";

type Db = ReturnType<typeof requireDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
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
  price_snapshot: PriceSnapshot;
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
  constructor(private readonly db: Db = requireDb()) {}
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
  async reserve(options: {
    actor: Actor;
    idempotencyKey: string;
    digest: string;
    config: FundingConfig;
    microdollars: number;
    now?: Date;
  }): Promise<Reservation> {
    const { actor, idempotencyKey, digest, config, microdollars } = options;
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
      // Use the database clock in production; test injection makes rollover deterministic.
      const [clock] = await tx.execute<{ now: Date }>(
        sql`SELECT clock_timestamp() AS now`,
      );
      const now = options.now ?? new Date(clock.now);
      const { day, month } = utcWindows(now);
      if (new Date(config.price.expiresAt).getTime() <= now.getTime())
        throw new AppError("unknown_model_price", 503);
      const [existing] = await tx.execute<Reservation>(
        sql`SELECT * FROM public.credit_reservation WHERE actor_key = ${actor.key} AND idempotency_key = ${idempotencyKey}`,
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
          sql`SELECT actor_key FROM public.guest_usage WHERE actor_key = ${actor.key}`,
        );
        if (used.length) throw new AppError("guest_limit_reached", 429);
      }
      const balance = await totals(tx, actor, now);
      if (balance.stopped) throw new AppError("funded_inference_disabled", 503);
      if (balance.daily + microdollars > DAILY_MICRODOLLARS)
        throw new AppError("daily_exhausted", 429);
      if (balance.monthly + microdollars > config.monthlyMicrodollars)
        throw new AppError("shared_exhausted", 429);
      if (
        balance.actorActive >= config.actorConcurrency ||
        balance.globalActive >= config.globalConcurrency
      )
        throw new AppError("funding_busy", 429);
      const id = crypto.randomUUID();
      const [reservation] =
        await tx.execute<Reservation>(sql`INSERT INTO public.credit_reservation
        (id, actor_key, actor_kind, idempotency_key, request_digest, day, month, reserved_microdollars, charged_microdollars, state, price_snapshot)
        VALUES (${id}, ${actor.key}, ${actor.kind}, ${idempotencyKey}, ${digest}, ${day}, ${month}, ${microdollars}, ${microdollars}, 'reserved', ${JSON.stringify(config.price)}::jsonb) RETURNING *`);
      if (actor.kind === "guest")
        await tx.execute(
          sql`INSERT INTO public.guest_usage(actor_key, reservation_id) VALUES (${actor.key}, ${id})`,
        );
      await audit(tx, id, "reserved", microdollars, {
        priceSnapshot: config.price,
        bounds: LIMITS,
        purpose: "basic_text",
        day,
        month,
      });
      return reservation;
    });
  }
  async enter(id: string, actor: Actor, validateEntry?: EntryValidation) {
    await this.transaction(async (tx) => {
      await lock(tx);
      const [control] = await tx.execute<{ stopped: boolean }>(
        sql`SELECT stopped FROM public.funding_control WHERE id = 'platform'`,
      );
      if (!control || control.stopped)
        throw new AppError("funded_inference_disabled", 503);
      // Fresh validation follows the awaited global lock in this transaction.
      // Failure rolls back before any entered state or provider_entered audit.
      await validateEntry?.(tx);
      const rows = await tx.execute(
        sql`UPDATE public.credit_reservation SET state = 'entered', updated_at = now() WHERE id = ${id} AND actor_key = ${actor.key} AND state = 'reserved' RETURNING id`,
      );
      if (!rows.length) throw new AppError("request_already_processed", 409);
      // Persist this BEFORE invoking any SDK/provider. A crash afterward retains the hold.
      await audit(tx, id, "provider_entered", 0);
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
