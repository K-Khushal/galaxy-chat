import { describe, expect, mock, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";

mock.module("server-only", () => ({}));

const {
  computeCapacityDigest,
  computePlanDigest,
  parseBudgetPlanInput,
  resolveCurrentCapacitySnapshot,
  resolvePlatformBudgetConfig,
  validateBudgetPlanArithmetics,
  PLATFORM_CEILING_MICRODOLLARS,
} = await import("../lib/funding/config");
const { PlatformBudgetStore } = await import("../lib/funding/store");
const { betaFixture, env: fixtureEnv } = await import("./helpers/beta-fixture");
const { rejectionOf } = await import("./helpers/rejection");

type BudgetPlanInput = import("../lib/funding/config").BudgetPlanInput;

function makeTestPlan(
  overrides: Partial<BudgetPlanInput> = {},
  envOverride = fixtureEnv,
): BudgetPlanInput {
  const currentCaps = resolveCurrentCapacitySnapshot(envOverride);
  const capacitySnapshot = {
    ...currentCaps,
    ...overrides.capacitySnapshot,
  };

  return {
    month: "2026-11",
    revision: crypto.randomUUID(),
    bSelected: 10_000_000,
    aCredit: capacitySnapshot.fundedMonthlyMicrodollars,
    aMcp: 2_000_000,
    kInfra: capacitySnapshot.platformInfraMicrodollars,
    kProviderFees: capacitySnapshot.platformProviderFeesMicrodollars,
    kSafety: capacitySnapshot.platformSafetyReserveMicrodollars,
    lCarried: 0,
    reviewedAt: new Date(Date.now() - 3600_000).toISOString(),
    expiresAt: new Date(Date.now() + 86400_000 * 30).toISOString(),
    coverageProofReference: "audit-operator-ref-12345",
    coverageProofDigest: "a".repeat(64),
    coverageAssertions: {
      infra: true,
      storage: true,
      transfer: true,
      database: true,
      queues: true,
      ordinaryByok: true,
      accountLevelCharges: true,
      conservativeLegacyUnknownExposure: true,
    },
    capacitySnapshot,
    ...overrides,
  };
}

function makeConfiguredEnv(
  plan: BudgetPlanInput,
  overrides: Record<string, string> = {},
) {
  return {
    ...fixtureEnv,
    PLATFORM_BUDGET_ENABLED: "1",
    PLATFORM_BUDGET_PLAN_JSON: JSON.stringify(plan),
    ...overrides,
  };
}

type CountRow = { count: number | string };
type StateRow = {
  id: string;
  state: string;
  reserved_microdollars: number | null;
  actual_microdollars: number | null;
  receipt_credits: number | null;
};
type SecurityRow = { tablename: string; rowsecurity: boolean };

describe("Platform Budget & Shared Allocation Integration Suite", () => {
  test("1. populated 0014 -> 0015 upgrade credit/search/image existing rows unchanged", async () => {
    const standaloneDb = await PGlite.create();
    try {
      const files = readdirSync("drizzle")
        .filter((name) => name.endsWith(".sql"))
        .sort();

      // Apply 0000 through 0014 only
      for (const file of files) {
        if (file > "0014_mcp_connections.sql") break;
        await standaloneDb.exec(readFileSync(`drizzle/${file}`, "utf8"));
      }

      // Populate pre-0015 data: user, credit reservation, search credential, holds
      await standaloneDb.exec(`
        INSERT INTO "user"(id, name, email, email_verified, github_login)
        VALUES ('u1', 'User 1', 'u1@example.invalid', true, 'u1');

        INSERT INTO credit_reservation(id, actor_key, actor_kind, idempotency_key, request_digest, day, month, reserved_microdollars, charged_microdollars, incurred_microdollars, state, price_snapshot)
        VALUES ('${crypto.randomUUID()}', '${"b".repeat(64)}', 'user', 'idem-1', '${"c".repeat(64)}', '2026-10-01', '2026-10', 50000, 50000, 0, 'held', '{"id":"p1"}'::jsonb);

        INSERT INTO search_credential(user_id, provider, revision, key_version, nonce, ciphertext, masked_key)
        VALUES ('u1', 'tavily', 'rev-1', 'v1', 'nonce-1', 'cipher-1', 'tvly-****');

        INSERT INTO byok_operation(id, actor_key, provider, credential_revision, kind, digest, state, price_revision, reserved_microdollars, actual_microdollars, receipt_credits)
        VALUES ('op-search-hold', 'actor-u1', 'tavily', 'rev-1', 'search', 'digest-search', 'held', 'price-search-1', 10000, 10000, 1);

        INSERT INTO byok_operation(id, actor_key, provider, credential_revision, kind, digest, state)
        VALUES ('op-image-hold', 'actor-u1', 'openrouter', 'rev-1', 'image', 'digest-img', 'held');
      `);

      // Verify pre-0015 state
      const preCredit = await standaloneDb.query<CountRow>(
        "SELECT count(*)::integer AS count FROM credit_reservation",
      );
      expect(Number(preCredit.rows[0].count)).toBe(1);

      const preSearchHold = await standaloneDb.query<StateRow>(
        "SELECT id, state, reserved_microdollars, actual_microdollars, receipt_credits FROM byok_operation WHERE id = 'op-search-hold'",
      );
      expect(preSearchHold.rows[0].state).toBe("held");
      expect(preSearchHold.rows[0].reserved_microdollars).toBe(10000);

      // Now apply migration 0015
      await standaloneDb.exec(
        readFileSync("drizzle/0015_platform_budget.sql", "utf8"),
      );

      // Verify pre-existing data unchanged
      const postCredit = await standaloneDb.query<CountRow>(
        "SELECT count(*)::integer AS count FROM credit_reservation",
      );
      expect(Number(postCredit.rows[0].count)).toBe(1);

      const postSearchHold = await standaloneDb.query<StateRow>(
        "SELECT id, state, reserved_microdollars, actual_microdollars, receipt_credits FROM byok_operation WHERE id = 'op-search-hold'",
      );
      expect(postSearchHold.rows[0].state).toBe("held");
      expect(postSearchHold.rows[0].reserved_microdollars).toBe(10000);

      // Verify RLS enabled on platform_budget_plan and platform_budget_carry
      const rlsCheck = await standaloneDb.query<SecurityRow>(`
        SELECT tablename, rowsecurity
        FROM pg_tables
        WHERE schemaname = 'public' AND tablename IN ('platform_budget_plan', 'platform_budget_carry')
        ORDER BY tablename;
      `);
      expect(rlsCheck.rows).toHaveLength(2);
      expect(rlsCheck.rows[0].rowsecurity).toBe(true);
      expect(rlsCheck.rows[1].rowsecurity).toBe(true);
    } finally {
      await standaloneDb.close();
    }
  });

  test("2. B=0 allocation zero only / overflow / negative / fractional / out of bounds / unknown coverage", async () => {
    // 2.1 B=0 with all zeros succeeds
    const zeroPlan = makeTestPlan({
      bSelected: 0,
      aCredit: 0,
      aMcp: 0,
      kInfra: 0,
      kProviderFees: 0,
      kSafety: 0,
      lCarried: 0,
      capacitySnapshot: {
        ...resolveCurrentCapacitySnapshot(fixtureEnv),
        fundedMonthlyMicrodollars: 0,
        platformInfraMicrodollars: 0,
        platformProviderFeesMicrodollars: 0,
        platformSafetyReserveMicrodollars: 0,
      },
    });
    expect(() => validateBudgetPlanArithmetics(zeroPlan)).not.toThrow();

    // 2.2 B=0 with nonzero component fails
    const badZeroPlan = makeTestPlan({
      bSelected: 0,
      aCredit: 100,
      aMcp: 0,
      kInfra: 0,
      kProviderFees: 0,
      kSafety: 0,
      lCarried: 0,
      capacitySnapshot: {
        ...resolveCurrentCapacitySnapshot(fixtureEnv),
        fundedMonthlyMicrodollars: 100,
      },
    });
    expect(() => validateBudgetPlanArithmetics(badZeroPlan)).toThrow();

    // 2.3 Binding mismatch between allocation and snapshot fails
    const bindingMismatchPlan = makeTestPlan({
      aCredit: 2_000_000,
      capacitySnapshot: {
        ...resolveCurrentCapacitySnapshot(fixtureEnv),
        fundedMonthlyMicrodollars: 1_000_000,
      },
    });
    expect(() => validateBudgetPlanArithmetics(bindingMismatchPlan)).toThrow();

    // 2.4 B > 10,000,000 fails
    expect(() =>
      parseBudgetPlanInput(
        makeTestPlan({
          bSelected: PLATFORM_CEILING_MICRODOLLARS + 1,
        }),
      ),
    ).toThrow();

    // 2.5 Negative value fails
    expect(() =>
      parseBudgetPlanInput(
        makeTestPlan({
          aCredit: -1,
        }),
      ),
    ).toThrow();

    // 2.6 Fractional value fails
    expect(() =>
      parseBudgetPlanInput(
        makeTestPlan({
          bSelected: 500000.5,
        }),
      ),
    ).toThrow();

    // 2.7 Sum exceeding bSelected fails
    const overflowPlan = makeTestPlan({
      bSelected: 2_000_000,
      aCredit: 1_000_000,
      aMcp: 1_000_000,
      kInfra: 0,
      kProviderFees: 0,
      kSafety: 1_000_000,
      lCarried: 0,
    });
    expect(() => validateBudgetPlanArithmetics(overflowPlan)).toThrow();

    // 2.8 Missing coverage assertion fails with typed AppError
    const badCoverageAssertions: Record<string, unknown> = {
      ...makeTestPlan().coverageAssertions,
    };
    delete badCoverageAssertions.queues;
    const badCoveragePlan: unknown = {
      ...makeTestPlan(),
      coverageAssertions: badCoverageAssertions,
    };
    expect(() => parseBudgetPlanInput(badCoveragePlan)).toThrow();

    // 2.9 Unknown coverage assertion fails
    const extraCoveragePlan: unknown = {
      ...makeTestPlan(),
      coverageAssertions: {
        ...makeTestPlan().coverageAssertions,
        extraUnreviewedKey: true,
      },
    };
    expect(() => parseBudgetPlanInput(extraCoveragePlan)).toThrow();

    // 2.10 Invalid month format (e.g. month 13) fails
    const badMonthPlan = makeTestPlan({
      month: "2026-13",
    });
    expect(() => validateBudgetPlanArithmetics(badMonthPlan)).toThrow();

    // 2.11 Canonical digest and config resolution
    const plan = makeTestPlan();
    const planDigest = computePlanDigest(plan);
    expect(planDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(computePlanDigest(plan)).toBe(planDigest);

    const capDigest = computeCapacityDigest(plan.capacitySnapshot);
    expect(capDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(computeCapacityDigest(plan.capacitySnapshot)).toBe(capDigest);

    const currentCaps = resolveCurrentCapacitySnapshot(fixtureEnv);
    expect(currentCaps.platformInfraMicrodollars).toBe(0);

    const resolved = resolvePlatformBudgetConfig({
      ...fixtureEnv,
      PLATFORM_BUDGET_ENABLED: "1",
      PLATFORM_BUDGET_PLAN_JSON: JSON.stringify(plan),
    });
    expect(resolved.enabled).toBe(true);
    expect(resolved.digest).toBe(planDigest);
  });

  test("3. all allocations sum global not per feature 10m", async () => {
    const perFeatureAttempt = makeTestPlan({
      bSelected: PLATFORM_CEILING_MICRODOLLARS,
      aCredit: PLATFORM_CEILING_MICRODOLLARS,
      aMcp: PLATFORM_CEILING_MICRODOLLARS,
      capacitySnapshot: {
        ...resolveCurrentCapacitySnapshot(fixtureEnv),
        fundedMonthlyMicrodollars: PLATFORM_CEILING_MICRODOLLARS,
      },
    });
    expect(() => validateBudgetPlanArithmetics(perFeatureAttempt)).toThrow();
  });

  test("4. stale / same-month conflicting deployment plans", async () => {
    const fixture = await betaFixture();
    const store = new PlatformBudgetStore(fixture.db);

    const plan1 = makeTestPlan({
      month: "2026-11",
      revision: crypto.randomUUID(),
    });
    const env1 = makeConfiguredEnv(plan1);

    const simNow = new Date("2026-11-15T12:00:00Z");
    const registered1 = await store.registerReviewedPlan(plan1, env1, simNow);
    expect(registered1.revision).toBe(plan1.revision);

    // Attempt to register a different revision for the same month -> 409 conflict
    const conflictingPlan = makeTestPlan({
      month: "2026-11",
      revision: crypto.randomUUID(),
      aMcp: 3_000_000,
    });
    const envConflict = makeConfiguredEnv(conflictingPlan);

    expect(
      await rejectionOf(
        store.registerReviewedPlan(conflictingPlan, envConflict, simNow),
      ),
    ).toMatchObject({
      id: "plan_conflict",
      status: 409,
    });
  });

  test("5. repeated same rev / digest idempotent", async () => {
    const fixture = await betaFixture();
    const store = new PlatformBudgetStore(fixture.db);

    const plan = makeTestPlan({
      month: "2026-11",
      revision: crypto.randomUUID(),
    });
    const env = makeConfiguredEnv(plan);

    const simNow = new Date("2026-11-15T12:00:00Z");
    const registered1 = await store.registerReviewedPlan(plan, env, simNow);
    const registered2 = await store.registerReviewedPlan(plan, env, simNow);

    expect(registered2.revision).toBe(registered1.revision);
    expect(registered2.digest).toBe(registered1.digest);
    expect(registered2.b_selected).toBe(registered1.b_selected);
  });

  test("6. month rollover persistent carry & 3-month multi-month carry union", async () => {
    const fixture = await betaFixture();
    const store = new PlatformBudgetStore(fixture.db);

    // Month 1: 2026-08 - insert pending hold in credit_reservation
    const holdMonth1Id = crypto.randomUUID();
    const actor1 = "1".repeat(64);
    const digest1 = "2".repeat(64);
    await fixture.db.execute(sql`
      INSERT INTO credit_reservation(
        id, actor_key, actor_kind, idempotency_key, request_digest,
        day, month, reserved_microdollars, charged_microdollars,
        incurred_microdollars, state, price_snapshot
      ) VALUES (
        ${holdMonth1Id}, ${actor1}, 'user', 'idem-aug-1', ${digest1},
        '2026-08-15', '2026-08', 60000, 60000, 0, 'held', '{"id":"p1"}'::jsonb
      )
    `);

    // Month 2: 2026-09 - bootstrap carries Month 1 hold (60,000)
    const simSep = new Date("2026-09-10T12:00:00Z");
    const planSep = makeTestPlan({
      month: "2026-09",
      lCarried: 60000,
      reviewedAt: new Date("2026-09-01T12:00:00Z").toISOString(),
      expiresAt: new Date("2026-09-30T12:00:00Z").toISOString(),
    });
    const envSep = makeConfiguredEnv(planSep);

    // Understating carry fails
    const badSep = makeTestPlan({
      month: "2026-09",
      lCarried: 40000,
      reviewedAt: new Date("2026-09-01T12:00:00Z").toISOString(),
      expiresAt: new Date("2026-09-30T12:00:00Z").toISOString(),
    });
    expect(
      await rejectionOf(
        store.registerReviewedPlan(badSep, makeConfiguredEnv(badSep), simSep),
      ),
    ).toMatchObject({
      id: "carried_liability_insufficient",
      status: 400,
    });

    await store.registerReviewedPlan(planSep, envSep, simSep);
    const carrySep = await store.getCarryRows("2026-09");
    expect(carrySep).toHaveLength(1);
    expect(carrySep[0].amount_microdollars).toBe(60000);

    // In Month 2 (2026-09), Month 1 hold releases in credit_reservation
    await fixture.db.execute(sql`
      UPDATE credit_reservation SET state = 'released', charged_microdollars = 0 WHERE id = ${holdMonth1Id}
    `);

    // Also in Month 2, a new hold is placed for Month 2 (amount 25000)
    const holdMonth2Id = crypto.randomUUID();
    await fixture.db.execute(sql`
      INSERT INTO credit_reservation(
        id, actor_key, actor_kind, idempotency_key, request_digest,
        day, month, reserved_microdollars, charged_microdollars,
        incurred_microdollars, state, price_snapshot
      ) VALUES (
        ${holdMonth2Id}, ${actor1}, 'user', 'idem-sep-2', ${digest1},
        '2026-09-20', '2026-09', 25000, 25000, 0, 'held', '{"id":"p1"}'::jsonb
      )
    `);

    // Month 3: 2026-10 - bootstrap MUST carry union of:
    // 1) Prior carried Month 1 hold (60,000 from 2026-09 carry), despite being released!
    // 2) Prior pending Month 2 hold (25,000)
    // Total required carry = 60,000 + 25,000 = 85,000
    const simOct = new Date("2026-10-05T12:00:00Z");
    const badOct = makeTestPlan({
      month: "2026-10",
      lCarried: 25000, // Tried to only carry the pending one, ignoring released historical carry
      reviewedAt: new Date("2026-10-01T12:00:00Z").toISOString(),
      expiresAt: new Date("2026-10-31T12:00:00Z").toISOString(),
    });
    expect(
      await rejectionOf(
        store.registerReviewedPlan(badOct, makeConfiguredEnv(badOct), simOct),
      ),
    ).toMatchObject({
      id: "carried_liability_insufficient",
      status: 400,
    });

    const planOct = makeTestPlan({
      month: "2026-10",
      lCarried: 85000,
      reviewedAt: new Date("2026-10-01T12:00:00Z").toISOString(),
      expiresAt: new Date("2026-10-31T12:00:00Z").toISOString(),
    });
    await store.registerReviewedPlan(
      planOct,
      makeConfiguredEnv(planOct),
      simOct,
    );
    const carryOct = await store.getCarryRows("2026-10");
    expect(carryOct).toHaveLength(2);
    expect(
      carryOct.find((c) => c.source_reservation_id === holdMonth1Id)
        ?.amount_microdollars,
    ).toBe(60000);
    expect(
      carryOct.find((c) => c.source_reservation_id === holdMonth2Id)
        ?.amount_microdollars,
    ).toBe(25000);
  });

  test("7. late original hold settlement / release cannot free period carry", async () => {
    const fixture = await betaFixture();
    const store = new PlatformBudgetStore(fixture.db);

    const holdId = crypto.randomUUID();
    const actorE = "e".repeat(64);
    const digestF = "f".repeat(64);
    await fixture.db.execute(sql`
      INSERT INTO credit_reservation(
        id, actor_key, actor_kind, idempotency_key, request_digest,
        day, month, reserved_microdollars, charged_microdollars,
        incurred_microdollars, state, price_snapshot
      ) VALUES (
        ${holdId}, ${actorE}, 'user', 'idem-oct-2', ${digestF},
        '2026-10-20', '2026-10', 80000, 80000, 0, 'held', '{"id":"p1"}'::jsonb
      )
    `);

    const plan = makeTestPlan({
      month: "2026-11",
      lCarried: 80000,
    });
    const env = makeConfiguredEnv(plan);
    const simNow = new Date("2026-11-15T12:00:00Z");
    await store.registerReviewedPlan(plan, env, simNow);

    // Later, original hold is released in month 2026-10
    await fixture.db.execute(sql`
      UPDATE credit_reservation SET state = 'released', charged_microdollars = 0 WHERE id = ${holdId}
    `);

    // Durable carry in month 2026-11 remains intact
    const carryRows = await store.getCarryRows("2026-11");
    expect(carryRows).toHaveLength(1);
    expect(carryRows[0].amount_microdollars).toBe(80000);

    // Append-only trigger rejects direct mutation
    expect(
      rejectionOf(
        fixture.db.execute(
          sql`UPDATE platform_budget_carry SET amount_microdollars = 0 WHERE month = '2026-11'`,
        ),
      ),
    ).resolves.toBeDefined();

    expect(
      rejectionOf(
        fixture.db.execute(
          sql`DELETE FROM platform_budget_carry WHERE month = '2026-11'`,
        ),
      ),
    ).resolves.toBeDefined();
  });

  test("8. config capacity drift / coverage expiry after queued lock / killswitch fail closed", async () => {
    const fixture = await betaFixture();
    const store = new PlatformBudgetStore(fixture.db);

    const plan = makeTestPlan({
      month: "2026-11",
    });
    const env = makeConfiguredEnv(plan);
    const simNow = new Date("2026-11-15T12:00:00Z");
    await store.registerReviewedPlan(plan, env, simNow);

    const assertOpts = {
      month: "2026-11",
      expectedRevision: plan.revision,
      expectedDigest: computePlanDigest(plan),
    };

    // 8.1 Active assertion succeeds when valid
    const active = await store.assertActivePlan(assertOpts, env, simNow);
    expect(active.month).toBe("2026-11");

    // 8.2 Missing funding_control fails closed
    await fixture.db.execute(
      sql`DELETE FROM funding_control WHERE id = 'platform'`,
    );
    expect(
      await rejectionOf(store.assertActivePlan(assertOpts, env, simNow)),
    ).toMatchObject({
      id: "funded_inference_disabled",
      status: 503,
    });
    await fixture.db.execute(
      sql`INSERT INTO funding_control (id, stopped) VALUES ('platform', false)`,
    );

    // 8.3 Killswitch stopped fails closed
    await fixture.db.execute(
      sql`UPDATE funding_control SET stopped = true WHERE id = 'platform'`,
    );
    expect(
      await rejectionOf(store.assertActivePlan(assertOpts, env, simNow)),
    ).toMatchObject({
      id: "funded_inference_disabled",
      status: 503,
    });
    await fixture.db.execute(
      sql`UPDATE funding_control SET stopped = false WHERE id = 'platform'`,
    );

    // 8.4 Expiry -> 503
    const expiredTime = new Date(Date.now() + 86400_000 * 35);
    expect(
      await rejectionOf(store.assertActivePlan(assertOpts, env, expiredTime)),
    ).toMatchObject({
      id: "plan_coverage_expired",
      status: 503,
    });

    // 8.5 Reviewed in future -> 400
    const futureReviewPlan = makeTestPlan({
      month: "2026-11",
      reviewedAt: new Date(simNow.getTime() + 3600_000).toISOString(),
    });
    expect(
      await rejectionOf(
        store.registerReviewedPlan(
          futureReviewPlan,
          makeConfiguredEnv(futureReviewPlan),
          simNow,
        ),
      ),
    ).toMatchObject({
      id: "plan_reviewed_in_future",
      status: 400,
    });

    // 8.6 Month mismatch against DB clock -> 400
    const futureMonthPlan = makeTestPlan({
      month: "2026-12",
    });
    expect(
      await rejectionOf(
        store.registerReviewedPlan(
          futureMonthPlan,
          makeConfiguredEnv(futureMonthPlan),
          simNow,
        ),
      ),
    ).toMatchObject({
      id: "budget_month_not_current",
      status: 400,
    });

    // 8.7 Capacity drift -> 503
    const driftedEnv = makeConfiguredEnv(plan, {
      ATTACHMENT_PLATFORM_BYTES: "50000000",
    });
    expect(
      await rejectionOf(store.assertActivePlan(assertOpts, driftedEnv, simNow)),
    ).toMatchObject({
      id: "capacity_drift",
      status: 503,
    });

    // 8.8 Stale assert expected revision mismatch -> 409
    expect(
      await rejectionOf(
        store.assertActivePlan(
          { ...assertOpts, expectedRevision: crypto.randomUUID() },
          env,
          simNow,
        ),
      ),
    ).toMatchObject({
      id: "plan_candidate_mismatch",
      status: 400,
    });

    // 8.9 Omitted / disabled env -> 503
    const disabledEnv = {
      ...fixtureEnv,
      PLATFORM_BUDGET_ENABLED: "0",
    };
    expect(
      await rejectionOf(
        store.assertActivePlan(assertOpts, disabledEnv, simNow),
      ),
    ).toMatchObject({
      id: "platform_budget_disabled",
      status: 503,
    });

    // 8.10 Actual held transaction barrier: state changed while waiting queued lock
    let releaseBlocker: (() => void) | undefined;
    const blockerPromise = new Promise<void>((resolve) => {
      releaseBlocker = resolve;
    });

    let blockerAcquired: (() => void) | undefined;
    const acquiredPromise = new Promise<void>((resolve) => {
      blockerAcquired = resolve;
    });

    const blockerTx = fixture.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(41021406)`);
      blockerAcquired?.();
      await blockerPromise;
      await tx.execute(
        sql`UPDATE funding_control SET stopped = true WHERE id = 'platform'`,
      );
    });

    await acquiredPromise;

    // Start assertActivePlan in background - it queues behind blocker transaction
    const queuedAssert = store.assertActivePlan(assertOpts, env, simNow);

    // Release blocker transaction and let it commit
    releaseBlocker?.();
    await blockerTx;

    // Queued assertion unblocks, re-evaluates funding_control after lock, and fails closed
    expect(await rejectionOf(queuedAssert)).toMatchObject({
      id: "funded_inference_disabled",
      status: 503,
    });

    // Reset killswitch
    await fixture.db.execute(
      sql`UPDATE funding_control SET stopped = false WHERE id = 'platform'`,
    );
  });

  test("9. owner deletion does not delete carry", async () => {
    const fixture = await betaFixture();
    const store = new PlatformBudgetStore(fixture.db);

    const survivorResId = crypto.randomUUID();
    const actor7 = "7".repeat(64);
    const digest8 = "8".repeat(64);

    await fixture.db.execute(sql`
      INSERT INTO "user"(id, name, email, email_verified, github_login)
      VALUES ('survivor', 'Survivor', 'survivor@example.invalid', true, 'survivor')
    `);

    await fixture.db.execute(sql`
      INSERT INTO credit_reservation(
        id, actor_key, actor_kind, idempotency_key, request_digest,
        day, month, reserved_microdollars, charged_microdollars,
        incurred_microdollars, state, price_snapshot
      ) VALUES (
        ${survivorResId}, ${actor7}, 'user', 'idem-surv-1', ${digest8},
        '2026-10-25', '2026-10', 95000, 95000, 0, 'held', '{"id":"p1"}'::jsonb
      )
    `);

    const plan = makeTestPlan({
      month: "2026-11",
      lCarried: 95000,
    });
    const env = makeConfiguredEnv(plan);
    const simNow = new Date("2026-11-15T12:00:00Z");
    await store.registerReviewedPlan(plan, env, simNow);

    // Delete user
    await fixture.db.execute(sql`DELETE FROM "user" WHERE id = 'survivor'`);

    // Verify carry row is untouched
    const carryRows = await store.getCarryRows("2026-11");
    expect(
      carryRows.some((c) => c.source_reservation_id === survivorResId),
    ).toBe(true);
    expect(
      carryRows.find((c) => c.source_reservation_id === survivorResId)
        ?.amount_microdollars,
    ).toBe(95000);
  });

  test("10. actual credit exposure overallocation deny", async () => {
    const fixture = await betaFixture();
    const store = new PlatformBudgetStore(fixture.db);

    const plan = makeTestPlan({
      month: "2026-11",
      aCredit: 1_000_000,
      bSelected: 10_000_000,
    });
    const env = makeConfiguredEnv(plan);
    const simNow = new Date("2026-11-15T12:00:00Z");
    await store.registerReviewedPlan(plan, env, simNow);

    const assertOpts = {
      month: "2026-11",
      expectedRevision: plan.revision,
      expectedDigest: computePlanDigest(plan),
    };

    // 10.1 Active plan passes when within budget
    const active = await store.assertActivePlan(assertOpts, env, simNow);
    expect(active.month).toBe("2026-11");

    // 10.2 Credit usage exceeds aCredit -> 429
    const actor9 = "9".repeat(64);
    const digestA = "a".repeat(64);
    await fixture.db.execute(sql`
      INSERT INTO credit_reservation(
        id, actor_key, actor_kind, idempotency_key, request_digest,
        day, month, reserved_microdollars, charged_microdollars,
        incurred_microdollars, state, price_snapshot
      ) VALUES (
        'res-over-1', ${actor9}, 'user', 'idem-over-1', ${digestA},
        '2026-11-05', '2026-11', 1500000, 1500000, 0, 'settled', '{"id":"p1"}'::jsonb
      )
    `);

    expect(
      await rejectionOf(store.assertActivePlan(assertOpts, env, simNow)),
    ).toMatchObject({
      id: "credit_allocation_exhausted",
      status: 429,
    });

    // 10.3 Uncovered legacy exposure: new prior hold appears that was not carried -> 503
    const actor4 = "4".repeat(64);
    const digest5 = "5".repeat(64);
    const uncarriedId = crypto.randomUUID();
    await fixture.db.execute(sql`
      INSERT INTO credit_reservation(
        id, actor_key, actor_kind, idempotency_key, request_digest,
        day, month, reserved_microdollars, charged_microdollars,
        incurred_microdollars, state, price_snapshot
      ) VALUES (
        ${uncarriedId}, ${actor4}, 'user', 'idem-uncarried', ${digest5},
        '2026-10-28', '2026-10', 30000, 30000, 0, 'held', '{"id":"p1"}'::jsonb
      )
    `);

    expect(
      await rejectionOf(store.assertActivePlan(assertOpts, env, simNow)),
    ).toMatchObject({
      id: "uncovered_legacy_exposure",
      status: 503,
    });
  });

  test("11. mutable candidate isolation: queued candidate mutation cannot leak into DB", async () => {
    const fixture = await betaFixture();
    const store = new PlatformBudgetStore(fixture.db);

    let releaseBlocker: (() => void) | undefined;
    const blockerPromise = new Promise<void>((resolve) => {
      releaseBlocker = resolve;
    });

    let blockerAcquired: (() => void) | undefined;
    const acquiredPromise = new Promise<void>((resolve) => {
      blockerAcquired = resolve;
    });

    const blockerTx = fixture.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(41021406)`);
      blockerAcquired?.();
      await blockerPromise;
    });

    await acquiredPromise;

    const baseCaps = resolveCurrentCapacitySnapshot(fixtureEnv);
    const mutableCoverage: Record<string, unknown> = {
      ...makeTestPlan().coverageAssertions,
    };
    const mutableCaps: Record<string, unknown> = {
      ...baseCaps,
      fundedMonthlyMicrodollars: 1_000_000,
    };
    const mutableCandidate: Record<string, unknown> = {
      ...makeTestPlan({
        month: "2026-11",
        aCredit: 1_000_000,
      }),
      capacitySnapshot: mutableCaps,
      coverageAssertions: mutableCoverage,
    };
    const validatedBase = parseBudgetPlanInput(mutableCandidate);
    const originalDigest = computePlanDigest(validatedBase);
    const env = makeConfiguredEnv(validatedBase);
    const simNow = new Date("2026-11-15T12:00:00Z");

    // Start registration in background - it queues behind blockerTx advisory lock
    const queuedRegister = store.registerReviewedPlan(
      mutableCandidate,
      env,
      simNow,
    );

    // Caller mutates the candidate while queued:
    mutableCandidate.aCredit = 5_000_000;
    mutableCandidate.bSelected = 1_000;
    mutableCaps.fundedMonthlyMicrodollars = 5_000_000;
    mutableCoverage.database = false;

    // Release blocker transaction and let registration proceed
    releaseBlocker?.();
    await blockerTx;

    const registered = await queuedRegister;

    // Persisted plan strictly preserves the original validated clone
    expect(registered.a_credit).toBe(1_000_000);
    expect(registered.digest).toBe(originalDigest);
    expect(registered.capacity_snapshot.fundedMonthlyMicrodollars).toBe(
      1_000_000,
    );
    expect(registered.coverage_assertions.database).toBe(true);

    const persisted = await store.getPlan("2026-11");
    expect(persisted?.a_credit).toBe(1_000_000);
    expect(persisted?.digest).toBe(originalDigest);
  });

  test("12. repeat register carry: new or increased prior pending hold rejects even with L headroom", async () => {
    const fixture = await betaFixture();
    const store = new PlatformBudgetStore(fixture.db);

    const hold1Id = crypto.randomUUID();
    const actorX = "d".repeat(64);
    const digestY = "e".repeat(64);
    await fixture.db.execute(sql`
      INSERT INTO credit_reservation(
        id, actor_key, actor_kind, idempotency_key, request_digest,
        day, month, reserved_microdollars, charged_microdollars,
        incurred_microdollars, state, price_snapshot
      ) VALUES (
        ${hold1Id}, ${actorX}, 'user', 'idem-oct-headroom', ${digestY},
        '2026-10-15', '2026-10', 30000, 30000, 0, 'held', '{"id":"p1"}'::jsonb
      )
    `);

    // Plan has L_carried = 80,000 (headroom of 50,000 above the 30,000 required)
    const plan = makeTestPlan({
      month: "2026-11",
      lCarried: 80000,
    });
    const env = makeConfiguredEnv(plan);
    const simNow = new Date("2026-11-15T12:00:00Z");

    const registered1 = await store.registerReviewedPlan(plan, env, simNow);
    expect(registered1.month).toBe("2026-11");

    const carryRows1 = await store.getCarryRows("2026-11");
    expect(carryRows1).toHaveLength(1);
    expect(carryRows1[0].amount_microdollars).toBe(30000);

    const assertOpts = {
      month: "2026-11",
      expectedRevision: plan.revision,
      expectedDigest: computePlanDigest(plan),
    };

    // Subcase 12.1: A new prior-month hold appears after initial registration (amount 20,000; total required 50,000 <= 80,000)
    const hold2Id = crypto.randomUUID();
    await fixture.db.execute(sql`
      INSERT INTO credit_reservation(
        id, actor_key, actor_kind, idempotency_key, request_digest,
        day, month, reserved_microdollars, charged_microdollars,
        incurred_microdollars, state, price_snapshot
      ) VALUES (
        ${hold2Id}, ${actorX}, 'user', 'idem-oct-new-hold', ${digestY},
        '2026-10-20', '2026-10', 20000, 20000, 0, 'held', '{"id":"p1"}'::jsonb
      )
    `);

    // Repeat register MUST reject despite L headroom
    expect(
      await rejectionOf(store.registerReviewedPlan(plan, env, simNow)),
    ).toMatchObject({
      id: "uncovered_legacy_exposure",
      status: 503,
    });

    // Assert active plan MUST also reject
    expect(
      await rejectionOf(store.assertActivePlan(assertOpts, env, simNow)),
    ).toMatchObject({
      id: "uncovered_legacy_exposure",
      status: 503,
    });

    // Immutable carry was NOT mutated
    const carryRowsAfterNew = await store.getCarryRows("2026-11");
    expect(carryRowsAfterNew).toHaveLength(1);
    expect(carryRowsAfterNew[0].amount_microdollars).toBe(30000);

    // Clean up hold2
    await fixture.db.execute(sql`
      UPDATE credit_reservation SET state = 'released', charged_microdollars = 0 WHERE id = ${hold2Id}
    `);

    // Subcase 12.2: Existing carried hold increases charged liability from 30,000 to 45,000 (still <= 80,000)
    await fixture.db.execute(sql`
      UPDATE credit_reservation SET charged_microdollars = 45000 WHERE id = ${hold1Id}
    `);

    expect(
      await rejectionOf(store.registerReviewedPlan(plan, env, simNow)),
    ).toMatchObject({
      id: "uncovered_legacy_exposure",
      status: 503,
    });

    expect(
      await rejectionOf(store.assertActivePlan(assertOpts, env, simNow)),
    ).toMatchObject({
      id: "uncovered_legacy_exposure",
      status: 503,
    });

    // Carry rows remain frozen
    const carryRowsAfterIncrease = await store.getCarryRows("2026-11");
    expect(carryRowsAfterIncrease).toHaveLength(1);
    expect(carryRowsAfterIncrease[0].amount_microdollars).toBe(30000);
  });

  test("13. stale validation after await: clock advancement or capacity drift before INSERT rolls back cleanly", async () => {
    const fixture = await betaFixture();
    const store = new PlatformBudgetStore(fixture.db);

    // 13.1 Clock advances past expiresAt during awaits before INSERT
    let callCount1 = 0;
    const advancingExpiryClock = () => {
      callCount1++;
      if (callCount1 > 1) {
        // Advanced past expiresAt (2026-11-20)
        return new Date("2026-11-25T00:00:00Z");
      }
      return new Date("2026-11-15T12:00:00Z");
    };

    const plan1 = makeTestPlan({
      month: "2026-11",
      expiresAt: "2026-11-20T00:00:00Z",
    });
    const env1 = makeConfiguredEnv(plan1);

    expect(
      await rejectionOf(
        store.registerReviewedPlan(plan1, env1, advancingExpiryClock),
      ),
    ).toMatchObject({
      id: "plan_coverage_expired",
      status: 503,
    });

    // Rollback invariant: 0 rows inserted in plan or carry
    expect(await store.getPlan("2026-11")).toBeNull();
    expect(await store.getCarryRows("2026-11")).toHaveLength(0);

    // 13.2 Clock advances into next month during awaits before INSERT
    let callCount2 = 0;
    const advancingMonthClock = () => {
      callCount2++;
      if (callCount2 > 1) {
        return new Date("2026-12-01T00:00:00Z");
      }
      return new Date("2026-11-15T12:00:00Z");
    };

    expect(
      await rejectionOf(
        store.registerReviewedPlan(plan1, env1, advancingMonthClock),
      ),
    ).toMatchObject({
      id: "budget_month_not_current",
      status: 400,
    });
    expect(await store.getPlan("2026-11")).toBeNull();
    expect(await store.getCarryRows("2026-11")).toHaveLength(0);

    // 13.3 Capacity drift occurring during awaits before INSERT
    let envReads = 0;
    const dynamicDriftEnv = new Proxy(env1, {
      get(target, prop, receiver) {
        if (prop === "ATTACHMENT_PLATFORM_BYTES" && envReads > 1) {
          return "50000000"; // drifted
        }
        return Reflect.get(target, prop, receiver);
      },
    });

    let callCount3 = 0;
    const trackingClock = () => {
      callCount3++;
      if (callCount3 > 1) {
        envReads = 2; // Trigger drift for pre-INSERT check
      }
      return new Date("2026-11-15T12:00:00Z");
    };

    expect(
      await rejectionOf(
        store.registerReviewedPlan(plan1, dynamicDriftEnv, trackingClock),
      ),
    ).toMatchObject({
      id: "capacity_drift",
      status: 503,
    });
    expect(await store.getPlan("2026-11")).toBeNull();
    expect(await store.getCarryRows("2026-11")).toHaveLength(0);

    // 13.4 Exact intra-helper control await delay in FINAL validation phase:
    // Proxy deterministically identifies the final phase (after plan INSERT) and advances
    // the clock during the final validation helper's funding_control query.
    let afterPlanInsert = false;
    let finalControlDelayed = false;
    let simTimeIntra = new Date("2026-11-15T12:00:00Z");
    const proxiedDb = new Proxy(fixture.db, {
      get(target, prop, receiver) {
        if (prop === "transaction") {
          return (
            cb: (tx: unknown) => unknown,
            opts?: Parameters<typeof target.transaction>[1],
          ) => {
            return target.transaction(async (tx: unknown) => {
              const proxiedTx = new Proxy(tx as object, {
                get(t, p, r) {
                  if (p === "execute") {
                    return async (
                      query: { queryChunks?: { value?: string[] } },
                      ...args: unknown[]
                    ) => {
                      const qStr = JSON.stringify(query);
                      if (
                        qStr.includes("INSERT INTO public.platform_budget_plan")
                      ) {
                        afterPlanInsert = true;
                      }
                      if (afterPlanInsert && qStr.includes("funding_control")) {
                        finalControlDelayed = true;
                        // Advance clock across the FINAL validation helper's control query await!
                        simTimeIntra = new Date("2026-11-25T00:00:00Z"); // past expiresAt (2026-11-20)
                      }
                      return (
                        t as {
                          execute: (
                            q: unknown,
                            ...a: unknown[]
                          ) => Promise<unknown>;
                        }
                      ).execute(query, ...args);
                    };
                  }
                  return Reflect.get(t, p, r);
                },
              });
              return cb(proxiedTx);
            }, opts);
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    });

    const storeWithProxy = new PlatformBudgetStore(proxiedDb);
    expect(
      await rejectionOf(
        storeWithProxy.registerReviewedPlan(plan1, env1, () => simTimeIntra),
      ),
    ).toMatchObject({
      id: "plan_coverage_expired",
      status: 503,
    });
    expect(afterPlanInsert).toBe(true);
    expect(finalControlDelayed).toBe(true);
    expect(await store.getPlan("2026-11")).toBeNull();
    expect(await store.getCarryRows("2026-11")).toHaveLength(0);
  });

  test("14. capacity bindings: each family limit and MCP profile drift invalidates plan", async () => {
    const baseCaps = resolveCurrentCapacitySnapshot(fixtureEnv);

    // 14.1 Changing search limit in snapshot causes capacity drift
    const planSearchDrift = makeTestPlan({
      capacitySnapshot: {
        ...baseCaps,
        searchMaxResults: 10, // differs from SEARCH_LIMITS.results (5)
      },
    });
    expect(() =>
      resolvePlatformBudgetConfig(makeConfiguredEnv(planSearchDrift)),
    ).toThrow();

    // 14.2 Changing BYOK limit in snapshot causes capacity drift
    const planByokDrift = makeTestPlan({
      capacitySnapshot: {
        ...baseCaps,
        byokHourlyLimit: 99, // differs from BYOK_LIMITS.hourly (30)
      },
    });
    expect(() =>
      resolvePlatformBudgetConfig(makeConfiguredEnv(planByokDrift)),
    ).toThrow();

    // 14.3 Changing attachment limit in snapshot causes capacity drift
    const planAttachmentDrift = makeTestPlan({
      capacitySnapshot: {
        ...baseCaps,
        attachmentMaxUserFiles: 999, // differs from attachmentLimits.userFiles (20)
      },
    });
    expect(() =>
      resolvePlatformBudgetConfig(makeConfiguredEnv(planAttachmentDrift)),
    ).toThrow();

    // 14.3b Changing attachment textBytes in snapshot causes capacity drift
    const planTextBytesDrift = makeTestPlan({
      capacitySnapshot: {
        ...baseCaps,
        attachmentTextBytes: 999_999,
      },
    });
    expect(() =>
      resolvePlatformBudgetConfig(makeConfiguredEnv(planTextBytesDrift)),
    ).toThrow();

    // 14.3c Changing attachment globalObjects in snapshot causes capacity drift
    const planGlobalObjectsDrift = makeTestPlan({
      capacitySnapshot: {
        ...baseCaps,
        attachmentGlobalObjects: 5000,
      },
    });
    expect(() =>
      resolvePlatformBudgetConfig(makeConfiguredEnv(planGlobalObjectsDrift)),
    ).toThrow();

    // 14.4 Changing image limit in snapshot causes capacity drift
    const planImageDrift = makeTestPlan({
      capacitySnapshot: {
        ...baseCaps,
        imageMaxMilliseconds: 999_999, // differs from imageLimits.milliseconds (60_000)
      },
    });
    expect(() =>
      resolvePlatformBudgetConfig(makeConfiguredEnv(planImageDrift)),
    ).toThrow();

    // 14.5 Changing MCP limit in snapshot causes capacity drift
    const planMcpDrift = makeTestPlan({
      capacitySnapshot: {
        ...baseCaps,
        mcpMaxTimeoutMs: 99_999, // differs from MCP_CLIENT_LIMITS.maxTimeoutMs (20_000)
      },
    });
    expect(() =>
      resolvePlatformBudgetConfig(makeConfiguredEnv(planMcpDrift)),
    ).toThrow();

    // 14.6 MCP profile canonical hashing: changing resource or timeout invalidates digest
    const sampleProfiles = [
      {
        profileId: "crm",
        revision: "rev-1",
        purpose: "mcp.call",
        resource: "https://crm.example.com/api",
        issuer: "https://auth.example.com/",
        credential: "none",
        maxRequestBytes: 10000,
        maxResponseBytes: 20000,
        timeoutMs: 5000,
        expiresAt: "2030-01-01T00:00:00Z",
      },
    ];

    const mcpEnv = {
      ...fixtureEnv,
      MCP_CLIENT_ENABLED: "1",
      MCP_CLIENT_PROFILES_JSON: JSON.stringify(sampleProfiles),
    };

    const capsWithMcp = resolveCurrentCapacitySnapshot(mcpEnv);
    expect(capsWithMcp.mcpProfilesDigest).toMatch(/^[a-f0-9]{64}$/);
    // Verified: no raw token or secret in snapshot, only hex digest
    expect(JSON.stringify(capsWithMcp)).not.toContain("bearer");
    expect(JSON.stringify(capsWithMcp)).not.toContain("secret");

    // Alter resource in profile -> digest changes
    const modifiedProfiles = [
      {
        ...sampleProfiles[0],
        resource: "https://malicious.example.com/api",
      },
    ];
    const alteredMcpEnv = {
      ...fixtureEnv,
      MCP_CLIENT_ENABLED: "1",
      MCP_CLIENT_PROFILES_JSON: JSON.stringify(modifiedProfiles),
    };
    const capsAltered = resolveCurrentCapacitySnapshot(alteredMcpEnv);
    expect(capsAltered.mcpProfilesDigest).not.toBe(
      capsWithMcp.mcpProfilesDigest,
    );

    // Alter timeout in profile -> digest changes
    const timeoutModifiedProfiles = [
      {
        ...sampleProfiles[0],
        timeoutMs: 9000,
      },
    ];
    const timeoutMcpEnv = {
      ...fixtureEnv,
      MCP_CLIENT_ENABLED: "1",
      MCP_CLIENT_PROFILES_JSON: JSON.stringify(timeoutModifiedProfiles),
    };
    const capsTimeout = resolveCurrentCapacitySnapshot(timeoutMcpEnv);
    expect(capsTimeout.mcpProfilesDigest).not.toBe(
      capsWithMcp.mcpProfilesDigest,
    );

    // Alter expiresAt in profile -> digest changes
    const expiryModifiedProfiles = [
      {
        ...sampleProfiles[0],
        expiresAt: "2031-12-31T23:59:59Z",
      },
    ];
    const expiryMcpEnv = {
      ...fixtureEnv,
      MCP_CLIENT_ENABLED: "1",
      MCP_CLIENT_PROFILES_JSON: JSON.stringify(expiryModifiedProfiles),
    };
    const capsExpiry = resolveCurrentCapacitySnapshot(expiryMcpEnv);
    expect(capsExpiry.mcpProfilesDigest).not.toBe(
      capsWithMcp.mcpProfilesDigest,
    );

    // Feature disabled: digest is empty string, but enabling it changes identity
    const capsDisabled = resolveCurrentCapacitySnapshot({
      ...fixtureEnv,
      MCP_CLIENT_ENABLED: "0",
    });
    expect(capsDisabled.mcpProfilesDigest).toBe("");
    expect(capsDisabled.mcpClientEnabled).toBe(false);
    expect(computeCapacityDigest(capsDisabled)).not.toBe(
      computeCapacityDigest(capsWithMcp),
    );
  });
});
