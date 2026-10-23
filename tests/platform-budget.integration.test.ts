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
    const badCoveragePlan = makeTestPlan();
    // @ts-expect-error test coverage omission
    delete badCoveragePlan.coverageAssertions.queues;
    expect(() => parseBudgetPlanInput(badCoveragePlan)).toThrow();

    // 2.9 Unknown coverage assertion fails
    const extraCoveragePlan = makeTestPlan({
      coverageAssertions: {
        infra: true,
        storage: true,
        transfer: true,
        database: true,
        queues: true,
        ordinaryByok: true,
        accountLevelCharges: true,
        conservativeLegacyUnknownExposure: true,
        // @ts-expect-error test unknown assertion
        extraUnreviewedKey: true,
      },
    });
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
});
