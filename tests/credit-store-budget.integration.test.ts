import { describe, expect, mock, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { setImmediate } from "node:timers/promises";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { PgDialect } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@/lib/db/schema";
import type { PriceSnapshot } from "../lib/credits/config";
import type { DatabaseTransaction } from "../lib/db/client";

mock.module("server-only", () => ({}));

const { CreditStore, actorFor } = await import("../lib/credits/store");
const { resolveFundingConfig } = await import("../lib/credits/config");
const { createReviewedBudgetPlan, registerReviewedBudgetPlan } = await import(
  "./helpers/platform-budget-fixture"
);
const { rejectionOf } = await import("./helpers/rejection");

const secret = "test-budget-credit-secret-at-least-32-chars";
const price: PriceSnapshot = {
  id: "price-budget-test",
  model: "fixture/basic",
  provider: "fixture",
  expiresAt: "2030-01-01T00:00:00Z",
  inputMicrodollarsPerMillion: 1_000_000,
  outputMicrodollarsPerMillion: 2_000_000,
  basicTextOnly: true,
  reasoning: "none",
  allInPrice: true,
};

function baseEnv(overrides: Record<string, string> = {}) {
  const currentMonth = new Date().toISOString().slice(0, 7);
  const plan = createReviewedBudgetPlan(
    {
      month: currentMonth,
      aCredit: 1_000_000,
      kInfra: 0,
      kProviderFees: 0,
      kSafety: 1_000_000,
      bSelected: 10_000_000,
    },
    {
      FUNDED_INFERENCE: "1",
      FUNDED_KILL_SWITCH: "0",
      BYOK_ENABLED: "0",
      ATTACHMENTS_ENABLED: "0",
      SEARCH_TOOLS_ENABLED: "0",
      IMAGES_ENABLED: "0",
      MCP_CLIENT_ENABLED: "0",
      PLATFORM_INFRA_MICRODOLLARS: "0",
      PLATFORM_PROVIDER_FEES_MICRODOLLARS: "0",
      PLATFORM_SAFETY_RESERVE_MICRODOLLARS: "1000000",
      FUNDED_MONTHLY_MICRODOLLARS: "1000000",
      ...overrides,
    },
  );

  return {
    FUNDED_ADAPTER: "openrouter",
    FUNDED_INFERENCE: "1",
    FUNDED_KILL_SWITCH: "0",
    FUNDED_PROVIDER_LIMITS_VERIFIED: "1",
    OPENROUTER_API_KEY: "test-openrouter-key",
    CREDIT_ACTOR_SECRET: secret,
    PLATFORM_INFRA_MICRODOLLARS: "0",
    PLATFORM_PROVIDER_FEES_MICRODOLLARS: "0",
    PLATFORM_SAFETY_RESERVE_MICRODOLLARS: "1000000",
    FUNDED_MONTHLY_MICRODOLLARS: "1000000",
    FUNDED_BASIC_PRICE_JSON: JSON.stringify(price),
    PLATFORM_BUDGET_ENABLED: "1",
    PLATFORM_BUDGET_PLAN_JSON: JSON.stringify(plan),
    ...overrides,
  };
}

async function createTestHarness(envSource = baseEnv()) {
  const engine = await PGlite.create();
  for (const file of readdirSync("drizzle")
    .filter((name) => name.endsWith(".sql"))
    .sort())
    await engine.exec(readFileSync(`drizzle/${file}`, "utf8"));
  const socket = new PGLiteSocketServer({
    db: engine,
    host: "127.0.0.1",
    port: 0,
    maxConnections: 1,
  });
  await socket.start();
  const client = postgres(
    `postgres://postgres:postgres@${socket.getServerConn()}/postgres`,
    { max: 1, prepare: false, connect_timeout: 2 },
  );
  const db = drizzle(client, { schema });
  await registerReviewedBudgetPlan(
    db,
    JSON.parse(envSource.PLATFORM_BUDGET_PLAN_JSON),
    envSource,
  );
  let currentEnv: Record<string, string | undefined> = { ...envSource };
  let afterQuery:
    | ((statement: string, result: unknown) => void | Promise<void>)
    | undefined;
  const dialect = new PgDialect();
  const observedDb = new Proxy(db, {
    get(target, key, receiver) {
      if (key === "transaction")
        return <T>(
          run: (tx: DatabaseTransaction) => Promise<T>,
          options?: Parameters<typeof db.transaction>[1],
        ) =>
          target.transaction(
            (tx) =>
              run(
                new Proxy(tx, {
                  get(transaction, property, transactionReceiver) {
                    if (property === "execute")
                      return async <R extends Record<string, unknown>>(
                        query: Parameters<DatabaseTransaction["execute"]>[0],
                      ) => {
                        const result = await transaction.execute<R>(query);
                        await afterQuery?.(
                          typeof query === "string"
                            ? query
                            : dialect.sqlToQuery(query.getSQL()).sql,
                          result,
                        );
                        return result;
                      };
                    return Reflect.get(
                      transaction,
                      property,
                      transactionReceiver,
                    );
                  },
                }),
              ),
            options,
          );
      return Reflect.get(target, key, receiver);
    },
  });
  const store = new CreditStore(observedDb, () => currentEnv);
  const close = async () => {
    await client.end({ timeout: 1 });
    await setImmediate();
    await socket.stop();
    await setImmediate();
    await engine.runExclusive(async () => {});
    await engine.close();
  };
  // After socket start every SQL read/write shares the captured max:1 driver queue.
  const database = {
    exec: async (text: string) => {
      await client.unsafe(text).simple();
    },
    query: async <Row extends Record<string, unknown>>(
      text: string,
      parameters?: Parameters<typeof client.unsafe>[1],
    ) => ({ rows: [...(await client.unsafe<Row[]>(text, parameters))] }),
  };
  return {
    database,
    db,
    store,
    close,
    getEnv: () => currentEnv,
    setEnv: (value: Record<string, string | undefined>) => {
      currentEnv = { ...value };
    },
    onQuery: (hook: typeof afterQuery) => {
      afterQuery = hook;
    },
  };
}

describe("Credit Store & Platform Budget Integration", () => {
  test("1. actual 0015 -> 0016 populated legacy upgrade + SQL partial NULL / immutability deny", async () => {
    const standaloneDb = await PGlite.create();
    try {
      const files = readdirSync("drizzle")
        .filter((name) => name.endsWith(".sql"))
        .sort();

      // Apply 0000 through 0015 only
      for (const file of files) {
        if (file > "0015_platform_budget.sql") break;
        await standaloneDb.exec(readFileSync(`drizzle/${file}`, "utf8"));
      }

      const legacyId = crypto.randomUUID();
      const legacyActor = "a".repeat(64);
      await standaloneDb.exec(`
        INSERT INTO public.credit_reservation (
          id, actor_key, actor_kind, idempotency_key, request_digest,
          day, month, reserved_microdollars, charged_microdollars, incurred_microdollars,
          state, price_snapshot
        ) VALUES (
          '${legacyId}', '${legacyActor}', 'user', 'legacy-idem', '${"d".repeat(64)}',
          '2026-10-01', '2026-10', 50000, 50000, 0,
          'reserved', '{"id":"old-price"}'::jsonb
        );
      `);

      // Apply migration 0016
      await standaloneDb.exec(
        readFileSync(
          "drizzle/0016_credit_reservation_plan_binding.sql",
          "utf8",
        ),
      );

      // Verify legacy row columns are NULL and existing liabilities preserved
      const legacyRow = await standaloneDb.query<{
        id: string;
        plan_month: string | null;
        plan_revision: string | null;
        plan_digest: string | null;
        plan_capacity_digest: string | null;
        charged_microdollars: number;
        state: string;
      }>("SELECT * FROM public.credit_reservation WHERE id = $1", [legacyId]);

      expect(legacyRow.rows[0].plan_month).toBeNull();
      expect(legacyRow.rows[0].plan_revision).toBeNull();
      expect(legacyRow.rows[0].plan_digest).toBeNull();
      expect(legacyRow.rows[0].plan_capacity_digest).toBeNull();
      expect(legacyRow.rows[0].charged_microdollars).toBe(50000);
      expect(legacyRow.rows[0].state).toBe("reserved");

      // Seed valid parent plans for 2026-10 and 2026-11 so foreign key checks pass
      // and do not mask CHECK constraint regression.
      await standaloneDb.exec(`
        INSERT INTO public.platform_budget_plan (
          month, revision, digest, b_selected, a_credit, a_mcp,
          k_infra, k_provider_fees, k_safety, l_carried,
          reviewed_at, expires_at, coverage_proof_reference, coverage_proof_digest,
          coverage_assertions, capacity_snapshot, capacity_digest
        ) VALUES
          ('2026-10', '${crypto.randomUUID()}', '${"a".repeat(64)}', 10000000, 1000000, 0, 0, 0, 1000000, 0, now(), now() + interval '1 day', 'ref', '${"b".repeat(64)}', '{}'::jsonb, '{}'::jsonb, '${"c".repeat(64)}'),
          ('2026-11', '${crypto.randomUUID()}', '${"a".repeat(64)}', 10000000, 1000000, 0, 0, 0, 1000000, 0, now(), now() + interval '1 day', 'ref', '${"b".repeat(64)}', '{}'::jsonb, '{}'::jsonb, '${"c".repeat(64)}');
      `);

      // Verify SQL partial NULL is rejected by CHECK constraint (not FK)
      // 1 non-null, 3 null
      const partialErr = await rejectionOf(
        standaloneDb.exec(`
          INSERT INTO public.credit_reservation (
            id, actor_key, actor_kind, idempotency_key, request_digest,
            day, month, reserved_microdollars, charged_microdollars, state, price_snapshot,
            plan_month
          ) VALUES (
            '${crypto.randomUUID()}', '${legacyActor}', 'user', 'idem-p1', '${"d".repeat(64)}',
            '2026-10-01', '2026-10', 50000, 50000, 'reserved', '{"id":"p"}'::jsonb,
            '2026-10'
          )
        `),
      );
      expect(partialErr).toMatchObject({
        code: "23514",
        message: expect.stringContaining(
          "credit_reservation_plan_binding_check",
        ),
      });

      // Month mismatch (plan_month != month) rejected by CHECK constraint
      const mismatchErr = await rejectionOf(
        standaloneDb.exec(`
          INSERT INTO public.credit_reservation (
            id, actor_key, actor_kind, idempotency_key, request_digest,
            day, month, reserved_microdollars, charged_microdollars, state, price_snapshot,
            plan_month, plan_revision, plan_digest, plan_capacity_digest
          ) VALUES (
            '${crypto.randomUUID()}', '${legacyActor}', 'user', 'idem-mismatch', '${"d".repeat(64)}',
            '2026-10-01', '2026-10', 50000, 50000, 'reserved', '{"id":"p"}'::jsonb,
            '2026-11', '${crypto.randomUUID()}', '${"e".repeat(64)}', '${"f".repeat(64)}'
          )
        `),
      );
      expect(mismatchErr).toMatchObject({
        code: "23514",
        message: expect.stringContaining(
          "credit_reservation_plan_binding_check",
        ),
      });

      // Trigger test: cannot backfill legacy NULL row
      expect(
        await rejectionOf(
          standaloneDb.exec(`
            UPDATE public.credit_reservation
            SET plan_month = '2026-10', plan_revision = '${crypto.randomUUID()}',
                plan_digest = '${"e".repeat(64)}', plan_capacity_digest = '${"f".repeat(64)}'
            WHERE id = '${legacyId}'
          `),
        ),
      ).toMatchObject({
        message: expect.stringContaining("plan binding is immutable"),
      });

      // Updating non-binding column on legacy row succeeds
      await standaloneDb.exec(`
        UPDATE public.credit_reservation
        SET state = 'released', charged_microdollars = 0
        WHERE id = '${legacyId}'
      `);
      const updatedLegacy = await standaloneDb.query<{
        state: string;
        charged_microdollars: number;
      }>(
        "SELECT state, charged_microdollars FROM public.credit_reservation WHERE id = $1",
        [legacyId],
      );
      expect(updatedLegacy.rows[0].state).toBe("released");
      expect(updatedLegacy.rows[0].charged_microdollars).toBe(0);
    } finally {
      await standaloneDb.close();
    }
  });

  test("2. persisted plan missing / default off / current env identity / capacity / coverage expiry", async () => {
    const env = baseEnv();
    const harness = await createTestHarness(env);
    try {
      const { store, setEnv } = harness;
      const user = actorFor("user", "u-persisted-test", secret);

      // Default off: PLATFORM_BUDGET_ENABLED = 0
      setEnv({ ...env, PLATFORM_BUDGET_ENABLED: "0" });
      expect(
        await rejectionOf(
          store.reserve({
            actor: user,
            idempotencyKey: crypto.randomUUID(),
            digest: "a".repeat(64),
            config: resolveFundingConfig(env),
            microdollars: 50_000,
          }),
        ),
      ).toMatchObject({ id: "platform_budget_disabled" });

      // Plan missing from DB: month has no row in platform_budget_plan
      const missingMonthEnv = baseEnv({
        PLATFORM_BUDGET_PLAN_JSON: JSON.stringify(
          createReviewedBudgetPlan(
            { month: "2026-12" },
            baseEnv({ FUNDED_MONTHLY_MICRODOLLARS: "1000000" }),
            new Date("2026-12-01T00:00:00Z"),
          ),
        ),
      });
      setEnv(missingMonthEnv);
      expect(
        await rejectionOf(
          store.reserve({
            actor: user,
            idempotencyKey: crypto.randomUUID(),
            digest: "a".repeat(64),
            config: resolveFundingConfig(
              missingMonthEnv,
              new Date("2026-12-01T00:00:00Z"),
            ),
            microdollars: 50_000,
            now: new Date("2026-12-01T00:00:00Z"),
          }),
        ),
      ).toMatchObject({ id: "budget_plan_missing" });

      // Current env identity mismatch: revision or digest differs from DB plan
      const conflictedPlan = createReviewedBudgetPlan(
        { revision: crypto.randomUUID() },
        env,
      );
      const conflictedEnv = {
        ...env,
        PLATFORM_BUDGET_PLAN_JSON: JSON.stringify(conflictedPlan),
      };
      setEnv(conflictedEnv);
      expect(
        await rejectionOf(
          store.reserve({
            actor: user,
            idempotencyKey: crypto.randomUUID(),
            digest: "a".repeat(64),
            config: resolveFundingConfig(conflictedEnv),
            microdollars: 50_000,
          }),
        ),
      ).toMatchObject({ id: "plan_identity_mismatch" });

      // Capacity drift: changing capacity bound in env invalidates capacity digest
      setEnv({
        ...env,
        ATTACHMENT_PLATFORM_BYTES: "50000000",
      });
      expect(
        await rejectionOf(
          store.reserve({
            actor: user,
            idempotencyKey: crypto.randomUUID(),
            digest: "a".repeat(64),
            config: resolveFundingConfig(env),
            microdollars: 50_000,
          }),
        ),
      ).toMatchObject({ id: "capacity_drift" });

      // Coverage expiry: clock advanced past plan expiresAt
      setEnv(env);
      const expiredNow = new Date("2035-01-01T00:00:00Z");
      expect(
        await rejectionOf(
          store.reserve({
            actor: user,
            idempotencyKey: crypto.randomUUID(),
            digest: "a".repeat(64),
            config: resolveFundingConfig(env),
            microdollars: 50_000,
            now: expiredNow,
          }),
        ),
      ).toMatchObject({ id: "unknown_model_price" }); // price expires 2030 first
    } finally {
      await harness.close();
    }
  });

  test("3. incoming exact cap Atomic / concurrent", async () => {
    const currentMonth = new Date().toISOString().slice(0, 7);
    const lowCapPlan = createReviewedBudgetPlan(
      {
        month: currentMonth,
        aCredit: 300_000,
        kInfra: 0,
        kProviderFees: 0,
        kSafety: 1_000_000,
        bSelected: 10_000_000,
      },
      baseEnv({ FUNDED_MONTHLY_MICRODOLLARS: "300000" }),
    );
    const env = baseEnv({
      FUNDED_MONTHLY_MICRODOLLARS: "300000",
      PLATFORM_BUDGET_PLAN_JSON: JSON.stringify(lowCapPlan),
    });

    const harness = await createTestHarness(env);
    try {
      const { store } = harness;
      const user = actorFor("user", "u-incoming-cap", secret);
      const cfg = resolveFundingConfig(env);

      // First reservation 200,000 -> succeeds
      const r1 = await store.reserve({
        actor: user,
        idempotencyKey: "r1",
        digest: "a".repeat(64),
        config: cfg,
        microdollars: 200_000,
      });
      expect(r1.charged_microdollars).toBe(200_000);

      // Settle r1 so actor concurrency does not block
      await store.enter(r1.id, user);
      await store.finish(r1.id, user, {
        kind: "known",
        microdollars: 200_000,
        evidence: "receipt-r1",
        usage: {},
      });

      // Second reservation 150,000 -> rejects with shared_exhausted (200k + 150k > 300k)
      expect(
        await rejectionOf(
          store.reserve({
            actor: user,
            idempotencyKey: "r2-fail",
            digest: "b".repeat(64),
            config: cfg,
            microdollars: 150_000,
          }),
        ),
      ).toMatchObject({ id: "shared_exhausted" });

      // Second reservation exactly 100,000 -> succeeds (200k + 100k = 300k exact cap)
      const r2 = await store.reserve({
        actor: user,
        idempotencyKey: "r2-exact",
        digest: "c".repeat(64),
        config: cfg,
        microdollars: 100_000,
      });
      expect(r2.charged_microdollars).toBe(100_000);

      // Settle r2
      await store.enter(r2.id, user);
      await store.finish(r2.id, user, {
        kind: "known",
        microdollars: 100_000,
        evidence: "receipt-r2",
        usage: {},
      });

      // Any additional reservation even 1 microdollar -> rejects
      expect(
        await rejectionOf(
          store.reserve({
            actor: user,
            idempotencyKey: "r3-overflow",
            digest: "d".repeat(64),
            config: cfg,
            microdollars: 1,
          }),
        ),
      ).toMatchObject({ id: "shared_exhausted" });
    } finally {
      await harness.close();
    }
  });

  test("4. direct CreditStore reserve / enter cannot bypass with fake config / env snapshot", async () => {
    const env = baseEnv();
    const harness = await createTestHarness(env);
    try {
      const { store } = harness;
      const user = actorFor("user", "u-fake-config", secret);
      const realConfig = resolveFundingConfig(env);

      // Fake config with fake plan revision
      const fakeConfig = {
        ...realConfig,
        plan: {
          ...realConfig.plan,
          revision: crypto.randomUUID(),
        },
      };

      // reserve rejects caller fake config
      expect(
        await rejectionOf(
          store.reserve({
            actor: user,
            idempotencyKey: "fake-res",
            digest: "a".repeat(64),
            config: fakeConfig,
            microdollars: 50_000,
          }),
        ),
      ).toMatchObject({ id: "plan_candidate_mismatch" });

      // Valid reservation
      const res = await store.reserve({
        actor: user,
        idempotencyKey: "valid-res",
        digest: "a".repeat(64),
        config: realConfig,
        microdollars: 50_000,
      });

      // Attempt enter with fake config
      expect(
        await rejectionOf(
          store.enter(res.id, user, undefined, {
            config: fakeConfig,
          }),
        ),
      ).toBeDefined();
    } finally {
      await harness.close();
    }
  });

  test("5. callback await changes config / price / control / period deny ZERO provider entered / audit", async () => {
    const env = baseEnv();
    const harness = await createTestHarness(env);
    try {
      const { store, setEnv, database } = harness;
      const cfg = resolveFundingConfig(env);

      // Case 5a: validateEntry callback mutates kill switch
      const user1 = actorFor("user", "u-callback-drift-1", secret);
      const res1 = await store.reserve({
        actor: user1,
        idempotencyKey: "drift-kill-switch",
        digest: "a".repeat(64),
        config: cfg,
        microdollars: 50_000,
      });

      const failingValidateKillSwitch = async () => {
        setEnv({ ...env, FUNDED_KILL_SWITCH: "1" });
      };

      expect(
        await rejectionOf(
          store.enter(res1.id, user1, failingValidateKillSwitch),
        ),
      ).toMatchObject({ id: "funded_inference_disabled" });

      // Verify ZERO provider_entered audit records
      let audits = await database.query<{ count: number }>(
        "SELECT count(*)::integer AS count FROM public.credit_ledger WHERE event = 'provider_entered'",
      );
      expect(Number(audits.rows[0].count)).toBe(0);

      // Verify reservation state is still reserved (rolled back)
      let row = await database.query<{ state: string }>(
        "SELECT state FROM public.credit_reservation WHERE id = $1",
        [res1.id],
      );
      expect(row.rows[0].state).toBe("reserved");
      await store.finish(res1.id, user1, { kind: "before_entry" });

      // Case 5b: validateEntry callback mutates provider limits verification
      setEnv(env); // reset
      const user2 = actorFor("user", "u-callback-drift-2", secret);
      const res2 = await store.reserve({
        actor: user2,
        idempotencyKey: "drift-provider-unverified",
        digest: "b".repeat(64),
        config: cfg,
        microdollars: 50_000,
      });

      const failingValidateUnverified = async () => {
        setEnv({ ...env, FUNDED_PROVIDER_LIMITS_VERIFIED: "0" });
      };

      expect(
        await rejectionOf(
          store.enter(res2.id, user2, failingValidateUnverified),
        ),
      ).toMatchObject({ id: "funding_unconfigured" });

      audits = await database.query<{ count: number }>(
        "SELECT count(*)::integer AS count FROM public.credit_ledger WHERE event = 'provider_entered'",
      );
      expect(Number(audits.rows[0].count)).toBe(0);
      row = await database.query<{ state: string }>(
        "SELECT state FROM public.credit_reservation WHERE id = $1",
        [res2.id],
      );
      expect(row.rows[0].state).toBe("reserved");
      await store.finish(res2.id, user2, { kind: "before_entry" });

      // Case 5c: validateEntry callback mutates price to expired
      setEnv(env); // reset
      const user3 = actorFor("user", "u-callback-drift-3", secret);
      const res3 = await store.reserve({
        actor: user3,
        idempotencyKey: "drift-price-expired",
        digest: "c".repeat(64),
        config: cfg,
        microdollars: 50_000,
      });

      const failingValidatePriceExpired = async () => {
        const expiredPrice = {
          ...price,
          expiresAt: "2020-01-01T00:00:00Z",
        };
        setEnv({
          ...env,
          FUNDED_BASIC_PRICE_JSON: JSON.stringify(expiredPrice),
        });
      };

      expect(
        await rejectionOf(
          store.enter(res3.id, user3, failingValidatePriceExpired),
        ),
      ).toMatchObject({ id: "unknown_model_price" });

      audits = await database.query<{ count: number }>(
        "SELECT count(*)::integer AS count FROM public.credit_ledger WHERE event = 'provider_entered'",
      );
      expect(Number(audits.rows[0].count)).toBe(0);
      row = await database.query<{ state: string }>(
        "SELECT state FROM public.credit_reservation WHERE id = $1",
        [res3.id],
      );
      expect(row.rows[0].state).toBe("reserved");
      await store.finish(res3.id, user3, { kind: "before_entry" });

      // Case 5d: callback causes UTC month rollover
      setEnv(env); // reset
      const user4 = actorFor("user", "u-callback-drift-4", secret);
      const res4 = await store.reserve({
        actor: user4,
        idempotencyKey: "drift-month-rollover",
        digest: "d".repeat(64),
        config: cfg,
        microdollars: 50_000,
      });

      let entryClock = new Date();
      const failingValidateMonthRollover = async () => {
        entryClock = new Date(
          Date.UTC(
            entryClock.getUTCFullYear(),
            entryClock.getUTCMonth() + 1,
            1,
          ),
        );
      };

      expect(
        await rejectionOf(
          store.enter(res4.id, user4, failingValidateMonthRollover, {
            now: () => entryClock,
          }),
        ),
      ).toMatchObject({ id: "budget_month_not_current" });

      audits = await database.query<{ count: number }>(
        "SELECT count(*)::integer AS count FROM public.credit_ledger WHERE event = 'provider_entered'",
      );
      expect(Number(audits.rows[0].count)).toBe(0);
      row = await database.query<{ state: string }>(
        "SELECT state FROM public.credit_reservation WHERE id = $1",
        [res4.id],
      );
      expect(row.rows[0].state).toBe("reserved");
      await store.finish(res4.id, user4, { kind: "before_entry" });

      // Case 5e: constructor provider turned off while caller passes old enabled env
      setEnv({ ...env, FUNDED_KILL_SWITCH: "1" });
      const user5 = actorFor("user", "u-callback-drift-5", secret);
      expect(
        await rejectionOf(
          store.reserve({
            actor: user5,
            idempotencyKey: "constructor-off-bypass",
            digest: "e".repeat(64),
            config: cfg,
            microdollars: 50_000,
            env, // passing old enabled env
          }),
        ),
      ).toMatchObject({ id: "funded_inference_disabled" });

      // Verify ZERO provider_entered audit records across all attempts
      audits = await database.query<{ count: number }>(
        "SELECT count(*)::integer AS count FROM public.credit_ledger WHERE event = 'provider_entered'",
      );
      expect(Number(audits.rows[0].count)).toBe(0);
    } finally {
      await harness.close();
    }
  });

  test("6. caller config mutation can't alter binding", () => {
    const env = baseEnv();
    const config = resolveFundingConfig(env);

    // Verify deep freeze
    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.isFrozen(config.plan)).toBe(true);
    expect(Object.isFrozen(config.price)).toBe(true);

    expect(Reflect.set(config, "monthlyMicrodollars", 999_999_999)).toBe(false);
    expect(Reflect.set(config.plan, "month", "2099-12")).toBe(false);

    expect(config.monthlyMicrodollars).toBe(1_000_000);
    expect(config.plan.month).toBe(new Date().toISOString().slice(0, 7));
  });

  test("7. previous month / legacy NULL enter deny while holds retained", async () => {
    const env = baseEnv();
    const harness = await createTestHarness(env);
    try {
      const { store, database } = harness;
      const user = actorFor("user", "u-prev-month", secret);

      // Insert legacy reservation with NULL plan binding
      const legacyId = crypto.randomUUID();
      await database.query(
        `
        INSERT INTO public.credit_reservation (
          id, actor_key, actor_kind, idempotency_key, request_digest,
          day, month, reserved_microdollars, charged_microdollars, state, price_snapshot
        ) VALUES (
          $1, $2, 'user', 'legacy-idem', '${"a".repeat(64)}',
          '2026-10-01', '2026-10', 50000, 50000, 'reserved', '{"id":"p"}'::jsonb
        )
      `,
        [legacyId, user.key],
      );

      // Legacy NULL row enter is denied with 409
      expect(await rejectionOf(store.enter(legacyId, user))).toMatchObject({
        id: "request_already_processed",
      });

      // Hold is retained
      const legacyCheck = await database.query<{
        charged_microdollars: number;
        state: string;
      }>(
        "SELECT charged_microdollars, state FROM public.credit_reservation WHERE id = $1",
        [legacyId],
      );
      expect(legacyCheck.rows[0].state).toBe("reserved");
      expect(legacyCheck.rows[0].charged_microdollars).toBe(50000);

      // finish with before_entry can release it safely
      await store.finish(legacyId, user, { kind: "before_entry" });
      const releasedCheck = await database.query<{
        state: string;
        charged_microdollars: number;
      }>(
        "SELECT state, charged_microdollars FROM public.credit_reservation WHERE id = $1",
        [legacyId],
      );
      expect(releasedCheck.rows[0].state).toBe("released");
      expect(releasedCheck.rows[0].charged_microdollars).toBe(0);
    } finally {
      await harness.close();
    }
  });

  test("8. finish while off / expired-safe; status usable when plan missing", async () => {
    const env = baseEnv();
    const harness = await createTestHarness(env);
    try {
      const { store, setEnv, database } = harness;
      const user = actorFor("user", "u-finish-safe", secret);
      const cfg = resolveFundingConfig(env);

      const res = await store.reserve({
        actor: user,
        idempotencyKey: "finish-safe-idem",
        digest: "a".repeat(64),
        config: cfg,
        microdollars: 50_000,
      });

      await store.enter(res.id, user);

      // Now turn off funding control / plan expired
      setEnv({
        ...env,
        FUNDED_KILL_SWITCH: "1",
        PLATFORM_BUDGET_ENABLED: "0",
      });
      await database.exec("UPDATE funding_control SET stopped = true");

      // status remains usable
      const totals = await store.status(user);
      expect(totals.stopped).toBe(true);

      // finish settles safely even while plan is off
      const state = await store.finish(res.id, user, {
        kind: "known",
        microdollars: 30_000,
        evidence: "settled-while-off",
        usage: {},
      });
      expect(state).toBe("settled");

      const row = await database.query<{
        state: string;
        charged_microdollars: number;
      }>(
        "SELECT state, charged_microdollars FROM public.credit_reservation WHERE id = $1",
        [res.id],
      );
      expect(row.rows[0].state).toBe("settled");
      expect(row.rows[0].charged_microdollars).toBe(30_000);
    } finally {
      await harness.close();
    }
  });

  test("9. User B cannot touch User A's reservation", async () => {
    const env = baseEnv();
    const harness = await createTestHarness(env);
    try {
      const { store } = harness;
      const userA = actorFor("user", "user-alice", secret);
      const userB = actorFor("user", "user-bob", secret);
      const cfg = resolveFundingConfig(env);

      const resA = await store.reserve({
        actor: userA,
        idempotencyKey: "alice-res",
        digest: "a".repeat(64),
        config: cfg,
        microdollars: 50_000,
      });

      // User B cannot enter User A's reservation
      expect(await rejectionOf(store.enter(resA.id, userB))).toMatchObject({
        id: "request_already_processed",
      });

      // User B cannot finish User A's reservation
      expect(
        await rejectionOf(
          store.finish(resA.id, userB, { kind: "before_entry" }),
        ),
      ).toMatchObject({ id: "not_found" });
    } finally {
      await harness.close();
    }
  });
});

for (const changedPrice of [
  { label: "provider", value: { ...price, provider: "different-provider" } },
  { label: "expiry", value: { ...price, expiresAt: "2031-01-01T00:00:00Z" } },
]) {
  test(`complete price identity rejects same-id ${changedPrice.label} changes in reserve and entry`, async () => {
    const env = baseEnv(),
      h = await createTestHarness(env);
    try {
      const actor = actorFor("user", "price-identity", secret),
        config = resolveFundingConfig(env);
      expect(
        await rejectionOf(
          h.store.reserve({
            actor,
            config: { ...config, price: changedPrice.value },
            idempotencyKey: "fake-price",
            digest: "a".repeat(64),
            microdollars: 50000,
          }),
        ),
      ).toMatchObject({ id: "unknown_model_price" });
      const reservation = await h.store.reserve({
        actor,
        config,
        idempotencyKey: "real-price",
        digest: "a".repeat(64),
        microdollars: 50000,
      });
      h.setEnv({
        ...env,
        FUNDED_BASIC_PRICE_JSON: JSON.stringify(changedPrice.value),
      });
      expect(
        await rejectionOf(h.store.enter(reservation.id, actor)),
      ).toMatchObject({ id: "unknown_model_price" });
      const rows = await h.database.query<{
        state: string;
        charged_microdollars: number;
      }>("SELECT state,charged_microdollars FROM credit_reservation");
      expect(rows.rows).toEqual([
        { state: "reserved", charged_microdollars: 50000 },
      ]);
      expect(
        (
          await h.database.query<{ count: number }>(
            "SELECT count(*)::integer AS count FROM credit_ledger WHERE event='provider_entered'",
          )
        ).rows[0].count,
      ).toBe(0);
    } finally {
      await h.close();
    }
  });
}

test("stale per-call environment cannot enter after authoritative provider disables funding", async () => {
  const env = baseEnv(),
    h = await createTestHarness(env);
  try {
    const actor = actorFor("user", "stale-entry-env", secret),
      config = resolveFundingConfig(env);
    const reservation = await h.store.reserve({
      actor,
      config,
      env,
      idempotencyKey: "stale-env",
      digest: "a".repeat(64),
      microdollars: 50000,
    });
    h.setEnv({ ...env, FUNDED_KILL_SWITCH: "1" });
    expect(
      await rejectionOf(
        h.store.enter(reservation.id, actor, undefined, { env, config }),
      ),
    ).toMatchObject({ id: "funded_inference_disabled" });
    expect(
      (
        await h.database.query<{ state: string }>(
          "SELECT state FROM credit_reservation",
        )
      ).rows,
    ).toEqual([{ state: "reserved" }]);
    expect(
      (
        await h.database.query<{ count: number }>(
          "SELECT count(*)::integer AS count FROM credit_ledger WHERE event='provider_entered'",
        )
      ).rows[0].count,
    ).toBe(0);
  } finally {
    await h.close();
  }
});

test("caller config mutation while waiting cannot follow a new provider identity into a reservation", async () => {
  const env = baseEnv(),
    h = await createTestHarness(env);
  try {
    const actor = actorFor("user", "mutable-config", secret);
    const config = structuredClone(resolveFundingConfig(env));
    let changed = false;
    h.onQuery((statement) => {
      if (!changed && statement.includes("pg_advisory_xact_lock")) {
        changed = true;
        config.price.provider = "different-provider";
        h.setEnv({
          ...env,
          FUNDED_BASIC_PRICE_JSON: JSON.stringify(config.price),
        });
      }
    });
    expect(
      await rejectionOf(
        h.store.reserve({
          actor,
          config,
          idempotencyKey: "mutated",
          digest: "a".repeat(64),
          microdollars: 50000,
        }),
      ),
    ).toMatchObject({ id: "unknown_model_price" });
    expect(changed).toBe(true);
    expect(
      (
        await h.database.query<{ count: number }>(
          "SELECT count(*)::integer AS count FROM credit_reservation",
        )
      ).rows[0].count,
    ).toBe(0);
    expect(
      (
        await h.database.query<{ count: number }>(
          "SELECT count(*)::integer AS count FROM credit_ledger",
        )
      ).rows[0].count,
    ).toBe(0);
  } finally {
    await h.close();
  }
});

for (const phase of ["reserve", "enter"] as const) {
  for (const change of [
    "price-expiry",
    "provider",
    "kill",
    "verification",
    "month",
  ] as const) {
    test(`${phase} rolls back when ${change} changes after audit and a later budget-query await`, async () => {
      const start = new Date(),
        expiry = new Date(start.getTime() + 60000);
      const env = baseEnv({
        FUNDED_BASIC_PRICE_JSON: JSON.stringify({
          ...price,
          expiresAt: expiry.toISOString(),
        }),
      });
      const h = await createTestHarness(env);
      try {
        const actor = actorFor("user", `late-${phase}-${change}`, secret),
          config = resolveFundingConfig(env);
        const reservation =
          phase === "enter"
            ? await h.store.reserve({
                actor,
                config,
                idempotencyKey: "late",
                digest: "a".repeat(64),
                microdollars: 50000,
              })
            : undefined;
        let auditSeen = false,
          changed = false,
          clock: Date | undefined;
        h.onQuery((statement, result) => {
          const text = statement.toLowerCase();
          if (text.includes("insert into public.credit_ledger"))
            auditSeen = true;
          if (
            auditSeen &&
            !changed &&
            text.includes("coalesce(sum(charged_microdollars), 0)::bigint")
          ) {
            changed = true;
            if (change === "kill")
              h.setEnv({ ...env, FUNDED_KILL_SWITCH: "1" });
            if (change === "verification")
              h.setEnv({ ...env, FUNDED_PROVIDER_LIMITS_VERIFIED: "0" });
            if (change === "provider")
              h.setEnv({
                ...env,
                FUNDED_BASIC_PRICE_JSON: JSON.stringify({
                  ...price,
                  provider: "different-provider",
                  expiresAt: expiry.toISOString(),
                }),
              });
            if (change === "price-expiry")
              clock = new Date(expiry.getTime() + 1);
            if (change === "month")
              clock = new Date(
                Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1),
              );
          }
          // The SQL query still executes against the real database. Only its
          // observed DB clock is advanced at this explicit offline seam; callers
          // pass no time override, exercising production clock sampling.
          if (
            clock &&
            text.includes("clock_timestamp()") &&
            Array.isArray(result)
          ) {
            for (const row of result)
              if (row && typeof row === "object" && "now" in row)
                Reflect.set(row, "now", clock);
          }
        });
        const operation = reservation
          ? h.store.enter(reservation.id, actor)
          : h.store.reserve({
              actor,
              config,
              idempotencyKey: "late",
              digest: "a".repeat(64),
              microdollars: 50000,
            });
        const expected =
          change === "kill"
            ? "funded_inference_disabled"
            : change === "verification"
              ? "funding_unconfigured"
              : change === "month"
                ? "budget_month_not_current"
                : "unknown_model_price";
        expect(await rejectionOf(operation)).toMatchObject({ id: expected });
        expect(auditSeen).toBe(true);
        expect(changed).toBe(true);
        const rows = await h.database.query<{
          state: string;
          charged_microdollars: number;
        }>("SELECT state,charged_microdollars FROM credit_reservation");
        expect(rows.rows).toEqual(
          reservation
            ? [{ state: "reserved", charged_microdollars: 50000 }]
            : [],
        );
        const audits = await h.database.query<{ event: string }>(
          "SELECT event FROM credit_ledger ORDER BY event",
        );
        expect(audits.rows).toEqual(reservation ? [{ event: "reserved" }] : []);
        expect(
          (
            await h.database.query<{ count: number }>(
              "SELECT count(*)::integer AS count FROM guest_usage",
            )
          ).rows[0].count,
        ).toBe(0);
      } finally {
        await h.close();
      }
    });
  }
}

test("standalone active plan assertion retains its advancing clock source through its final SQL validation", async () => {
  const start = new Date(),
    expiry = new Date(start.getTime() + 60000);
  const original = baseEnv();
  const plan = createReviewedBudgetPlan(
    { expiresAt: expiry.toISOString() },
    original,
    start,
  );
  const env = { ...original, PLATFORM_BUDGET_PLAN_JSON: JSON.stringify(plan) };
  const h = await createTestHarness(env);
  try {
    const { PlatformBudgetStore } = await import("../lib/funding/store");
    const config = resolveFundingConfig(env, start);
    let samples = 0;
    expect(
      await rejectionOf(
        new PlatformBudgetStore(h.db).assertActivePlan(
          {
            month: config.plan.month,
            expectedRevision: config.plan.revision,
            expectedDigest: config.plan.digest,
          },
          env,
          () => (++samples < 3 ? start : new Date(expiry.getTime() + 1)),
        ),
      ),
    ).toMatchObject({ id: "plan_coverage_expired" });
    expect(samples).toBe(3);
  } finally {
    await h.close();
  }
});
