import { describe, expect, mock, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { mcpOperationFixture } from "./helpers/mcp-operation-fixture";
import { rejectionOf } from "./helpers/rejection";
import { setupFixtureBeforeEach } from "./helpers/setup-fixture";

mock.module("server-only", () => ({}));
const { createMcpOperationStore, createFixtureMcpOperationStore } =
  await import("../lib/mcp/operation-store");
const { operationDigest } = await import("../lib/mcp/operation-contract");
const { parseMcpFeeSnapshot } = await import("../lib/mcp/fee-config");

describe("MCP operation accounting — synthetic offline amounts, NO real cost/transport proof", () => {
  const get = setupFixtureBeforeEach(() => mcpOperationFixture());
  test("production admission and reconciliation unavailable; test factory requires test environment at construction and later entry", async () => {
    const f = get(),
      input = await f.authorized(),
      production = createMcpOperationStore({ db: f.db });
    expect(await rejectionOf(production.reserve("alice", input))).toMatchObject(
      { id: "mcp_operation_authority_unavailable" },
    );
    expect(
      await rejectionOf(production.enter("alice", input.id, 1)),
    ).toMatchObject({ id: "mcp_operation_authority_unavailable" });
    await f.store.reserve("alice", input);
    const previous = process.env.NODE_ENV;
    try {
      Reflect.set(process.env, "NODE_ENV", "production");
      expect(() =>
        createFixtureMcpOperationStore({
          db: f.db,
          env: () => f.env,
          runtime: () => f.runtime,
        }),
      ).toThrow("mcp_operation_authority_unavailable");
      expect(await rejectionOf(f.store.reserve("alice", input))).toMatchObject({
        id: "mcp_operation_authority_unavailable",
      });
      expect(
        await rejectionOf(f.store.enter("alice", input.id, 1)),
      ).toMatchObject({ id: "mcp_operation_authority_unavailable" });
      expect(
        await rejectionOf(
          f.store.reconcile(
            input.id,
            operationDigest(input),
            crypto.randomUUID(),
            1,
          ),
        ),
      ).toMatchObject({ id: "mcp_operation_authority_unavailable" });
    } finally {
      if (previous === undefined)
        Reflect.deleteProperty(process.env, "NODE_ENV");
      else Reflect.set(process.env, "NODE_ENV", previous);
    }
    expect(await f.store.status("alice", input.id)).toMatchObject({
      state: "reserved",
      attempts: 0,
    });
    expect(f.seen).toHaveLength(0);
  });
  test("strict fee proof/capacity validation rejects missing cost parts, NaN, infinity, extra fields and changed digest", () => {
    const f = get();
    for (const candidate of [
      { ...f.fee, upperBoundMicrodollars: NaN },
      { ...f.fee, upperBoundMicrodollars: Infinity },
      { ...f.fee, allInPlatformCost: false },
      { ...f.fee, coverage: { ...f.fee.coverage, broker: false } },
      { ...f.fee, extra: "secret" },
      { ...f.fee, capacity: { ...f.fee.capacity, globalActive: 3 } },
      { ...f.fee, capacityDigest: "0".repeat(64) },
    ])
      expect(() => parseMcpFeeSnapshot(candidate, new Date())).toThrow(
        "mcp_fee_unavailable",
      );
    expect(
      Object.isFrozen(parseMcpFeeSnapshot(f.fee, new Date()).capacity),
    ).toBe(true);
  });
  test("exact owner and immutable idempotency; one committed entry, consumed approval and crash replay cannot re-enter", async () => {
    const f = get(),
      input = await f.authorized();
    const first = await f.store.reserve("alice", input);
    expect(await f.store.reserve("alice", input)).toEqual(first);
    expect(
      await rejectionOf(
        f.store.reserve("alice", { ...input, requestDigest: "1".repeat(64) }),
      ),
    ).toMatchObject({ id: "idempotency_conflict" });
    expect(await rejectionOf(f.store.status("bob", input.id))).toMatchObject({
      id: "not_found",
    });
    expect(await rejectionOf(f.store.enter("bob", input.id, 1))).toMatchObject({
      id: "not_found",
    });
    expect(
      await rejectionOf(f.store.enter("alice", input.id, 2)),
    ).toMatchObject({ id: "mcp_operation_conflict" });
    const entered = await f.store.enter("alice", input.id, 1);
    expect(entered).toMatchObject({
      state: "entered",
      attempts: 1,
      revision: 2,
    });
    expect(await f.store.reserve("alice", input)).toEqual(entered);
    expect(
      await rejectionOf(f.store.enter("alice", input.id, 2)),
    ).toMatchObject({ id: "mcp_operation_already_entered" });
    expect(
      await rejectionOf(f.store.cancelReserved("alice", input.id, 2)),
    ).toMatchObject({ id: "mcp_entry_not_disproved" });
    const held = await f.store.retainUnknown("alice", input.id, 2);
    expect(held).toMatchObject({
      state: "held",
      reservedMicrodollars: 10000,
      incurredMicrodollars: 0,
    });
    expect(f.seen).toHaveLength(0);
  });
  test("missing/foreign/stale action authority and unsupported OAuth purpose cannot reserve or produce partial financial writes", async () => {
    const f = get(),
      input = f.intent();
    expect(await rejectionOf(f.store.reserve("alice", input))).toMatchObject({
      id: "mcp_authority_missing",
    });
    await f.store.issueFixtureAuthority(
      "bob",
      input,
      new Date(Date.now() + 60000).toISOString(),
    );
    expect(await rejectionOf(f.store.reserve("alice", input))).toMatchObject({
      id: "mcp_authority_missing",
    });
    const stale = await f.authorized();
    expect(
      await rejectionOf(
        f.store.reserve("alice", {
          ...stale,
          action: { ...stale.action, revision: "stale" },
        }),
      ),
    ).toMatchObject({ id: "mcp_authority_changed" });
    const oauth = await f.authorized("alice", {
      profile: { ...stale.profile, purpose: "oauth.token" },
    });
    expect(await rejectionOf(f.store.reserve("alice", oauth))).toMatchObject({
      id: "mcp_connection_changed",
    });
    const [row] = await f.db.execute<{ count: number }>(
      sql`SELECT count(*)::integer AS count FROM mcp_operation`,
    );
    expect(row.count).toBe(0);
  });
  test("reserved cancellation while disabled retains request counters and frozen commitments; financial identity is immutable", async () => {
    const f = get(),
      input = await f.authorized();
    await f.store.reserve("alice", input);
    expect(
      await rejectionOf(
        f.db.$client.unsafe(
          "UPDATE mcp_operation SET binding_digest=$1 WHERE id=$2",
          ["0".repeat(64), input.id],
        ),
      ),
    ).toMatchObject({
      code: "P0001",
      message: expect.stringContaining("immutable"),
    });
    f.setEnv({
      ...f.env,
      FUNDED_KILL_SWITCH: "1",
      PLATFORM_BUDGET_ENABLED: "0",
    });
    const production = createMcpOperationStore({ db: f.db });
    expect(await production.cancelReserved("alice", input.id, 1)).toMatchObject(
      { state: "released" },
    );
    expect(await production.status("alice", input.id)).toMatchObject({
      state: "released",
    });
    const [counts] = await f.db.execute<{
      operations: number;
      audit: number;
      commitment: string;
    }>(
      sql`SELECT (SELECT count(*)::integer FROM mcp_operation) AS operations,(SELECT count(*)::integer FROM mcp_operation_audit) AS audit,(SELECT sum(amount_microdollars)::text FROM mcp_operation_commitment) AS commitment`,
    );
    expect(counts).toEqual({ operations: 1, audit: 2, commitment: "10000" });
    expect(
      await rejectionOf(
        f.db.$client.unsafe("DELETE FROM mcp_operation WHERE id=$1", [
          input.id,
        ]),
      ),
    ).toMatchObject({
      code: "P0001",
      message: expect.stringContaining("retained"),
    });
  });
  test("operation-bound verified fixture receipts reconcile once, reject conflicting evidence, and preserve full overruns plus global stop", async () => {
    const f = get(),
      input = await f.authorized();
    await f.store.reserve("alice", input);
    await f.store.enter("alice", input.id, 1);
    expect(
      await rejectionOf(
        f.store.reconcile(
          input.id,
          operationDigest(input),
          crypto.randomUUID(),
          2,
        ),
      ),
    ).toMatchObject({ id: "mcp_receipt_unavailable" });
    const receipt = {
      id: crypto.randomUUID(),
      operationId: input.id,
      bindingDigest: operationDigest(input),
      evidenceDigest: "1".repeat(64),
      incurredMicrodollars: 15000,
      terminal: true,
      revision: "synthetic-receipt-v1",
    };
    await f.store.issueFixtureReceipt(receipt);
    f.setEnv({ ...f.env, PLATFORM_BUDGET_ENABLED: "0" });
    const settled = await f.store.reconcile(
      input.id,
      receipt.bindingDigest,
      receipt.id,
      2,
    );
    expect(settled).toMatchObject({
      state: "settled",
      incurredMicrodollars: 15000,
      reservedMicrodollars: 10000,
    });
    expect(
      await f.store.reconcile(input.id, receipt.bindingDigest, receipt.id, 2),
    ).toEqual(settled);
    const conflicting = {
      ...receipt,
      id: crypto.randomUUID(),
      evidenceDigest: "2".repeat(64),
      incurredMicrodollars: 1000,
    };
    await f.store.issueFixtureReceipt(conflicting);
    expect(
      await rejectionOf(
        f.store.reconcile(input.id, receipt.bindingDigest, conflicting.id, 3),
      ),
    ).toMatchObject({ id: "mcp_receipt_conflict" });
    const [control] = await f.db.execute<{ stopped: boolean }>(
      sql`SELECT stopped FROM funding_control WHERE id='platform'`,
    );
    expect(control.stopped).toBe(true);
    expect(
      await rejectionOf(
        createMcpOperationStore({ db: f.db }).reconcile(
          input.id,
          receipt.bindingDigest,
          receipt.id,
          3,
        ),
      ),
    ).toMatchObject({ id: "mcp_operation_authority_unavailable" });
    const [evidenceState] = await f.db.execute<{
      receipts: number;
      guards: number;
      commitments: number;
      audit: number;
    }>(sql`SELECT
      (SELECT count(*)::integer FROM mcp_fixture_receipt WHERE operation_id=${input.id}) AS receipts,
      (SELECT count(*)::integer FROM mcp_operation_commitment WHERE source_id=${input.id}) AS commitments,
      (SELECT count(*)::integer FROM mcp_operation_audit WHERE operation_id=${input.id}) AS audit,
      (SELECT count(*)::integer FROM pg_trigger WHERE tgrelid='mcp_fixture_receipt'::regclass AND tgname='mcp_immutable') AS guards`);
    expect(evidenceState).toEqual({
      receipts: 2,
      guards: 1,
      commitments: 1,
      audit: 3,
    });
    // These direct SQL guard probes use the same simple protocol as existing
    // artifact/job guard tests; the fixture contains this one financial operation.
    for (const statement of [
      "UPDATE mcp_operation SET incurred_microdollars=16000,revision=revision+1",
      "DELETE FROM mcp_fixture_receipt",
      "DELETE FROM mcp_operation_commitment",
      "DELETE FROM mcp_operation_audit",
    ]) {
      const error = await f.db.$client
        .unsafe(statement)
        .simple()
        .then(
          () => {
            throw new Error(
              `Financial mutation unexpectedly succeeded: ${statement}`,
            );
          },
          (error: unknown) => error,
        );
      expect(error).toMatchObject({
        code: "P0001",
        message: expect.stringContaining("immutable"),
      });
      expect(await f.store.status("alice", input.id)).toEqual(settled);
    }
    expect(await f.store.status("alice", input.id)).toEqual(settled);
  });
});

describe("MCP final awaits — actual SQL execution then deterministic offline drift", () => {
  const get = setupFixtureBeforeEach(() => mcpOperationFixture());
  for (const phase of ["reserve", "enter"])
    for (const change of ["fee", "kill", "expiry", "month", "invite"]) {
      test(`${phase} rolls back after final audit/query boundary changes ${change}`, async () => {
        const f = get(),
          input = await f.authorized();
        if (phase === "enter") await f.store.reserve("alice", input);
        let audited = false,
          changed = false;
        f.afterQuery((statement, result) => {
          if (statement.includes("INSERT INTO mcp_operation_audit"))
            audited = true;
          if (
            !audited ||
            changed ||
            !statement.includes("f.stopped,u.github_login")
          )
            return;
          changed = true;
          if (change === "fee")
            f.setRuntime({
              ...f.runtime,
              fee: { ...f.fee, revision: "changed-after-last-await" },
            });
          if (change === "kill")
            f.setEnv({ ...f.env, FUNDED_KILL_SWITCH: "1" });
          if (change === "invite")
            f.setEnv({ ...f.env, GITHUB_INVITE_LOGINS: "bob" });
          if (change === "expiry" || change === "month") {
            const later =
              change === "expiry"
                ? new Date(Date.now() + 60000)
                : new Date(
                    Date.UTC(
                      new Date().getUTCFullYear(),
                      new Date().getUTCMonth() + 1,
                      1,
                    ),
                  );
            if (Array.isArray(result))
              for (const row of result)
                if (row && typeof row === "object" && "now" in row)
                  Reflect.set(row, "now", later);
          }
        });
        const error = await rejectionOf(
          phase === "reserve"
            ? f.store.reserve("alice", input)
            : f.store.enter("alice", input.id, 1),
        );
        expect(error).toMatchObject({
          id:
            change === "fee"
              ? "mcp_operation_identity_changed"
              : change === "kill"
                ? "funded_inference_disabled"
                : change === "invite"
                  ? "mcp_invite_required"
                  : "mcp_operation_expired",
        });
        expect(changed).toBe(true);
        f.afterQuery(undefined);
        const rows = await f.db.execute<{ state: string; attempts: number }>(
          sql`SELECT state,attempts FROM mcp_operation WHERE id=${input.id}`,
        );
        expect(rows.map((row) => ({ ...row }))).toEqual(
          phase === "reserve" ? [] : [{ state: "reserved", attempts: 0 }],
        );
        const [audits] = await f.db.execute<{ count: number }>(
          sql`SELECT count(*)::integer AS count FROM mcp_operation_audit WHERE operation_id=${input.id}`,
        );
        expect(audits.count).toBe(phase === "reserve" ? 0 : 1);
        const [grant] = await f.db.execute<{ consumed_by: string | null }>(
          sql`SELECT consumed_by FROM mcp_fixture_authority WHERE id=${input.authority.id}`,
        );
        expect(grant.consumed_by).toBeNull();
        expect(f.seen).toHaveLength(0);
      });
    }
});

describe("MCP conservative allocation and retained abuse limits", () => {
  test("exact shared MCP allocation, queued owner/global concurrency and frozen release commitments", async () => {
    const f = await mcpOperationFixture({ aMcp: 20000 });
    f.setEnv({ ...f.env, GITHUB_INVITE_LOGINS: "alice,bob,outsider" });
    const alice = await f.authorized(),
      alice2 = await f.authorized(),
      bob = await f.authorized("bob"),
      third = await f.authorized("outsider");
    const accepted = await Promise.allSettled([
      f.store.reserve("alice", alice),
      f.store.reserve("alice", alice2),
    ]);
    expect(
      accepted.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      accepted.filter((result) => result.status === "rejected"),
    ).toHaveLength(1);
    await f.store.reserve("bob", bob);
    expect(await rejectionOf(f.store.reserve("outsider", third))).toMatchObject(
      { id: "mcp_allocation_exhausted" },
    );
    const first = accepted[0].status === "fulfilled" ? alice : alice2;
    await f.store.cancelReserved("alice", first.id, 1);
    await f.store.cancelReserved("bob", bob.id, 1);
    expect(await rejectionOf(f.store.reserve("outsider", third))).toMatchObject(
      { id: "mcp_allocation_exhausted" },
    );
    const [row] = await f.db.execute<{ total: string }>(
      sql`SELECT sum(amount_microdollars)::text AS total FROM mcp_operation_commitment`,
    );
    expect(row.total).toBe("20000");
  });
  for (const limit of [
    "ownerDailyRequests",
    "globalDailyRequests",
    "ownerRecords",
    "globalRecords",
  ]) {
    test(`${limit} retains counters after cancellation`, async () => {
      const f = await mcpOperationFixture({ capacity: { [limit]: 2 } });
      for (let i = 0; i < 2; i++) {
        const input = await f.authorized();
        await f.store.reserve("alice", input);
        await f.store.cancelReserved("alice", input.id, 1);
      }
      const third = await f.authorized();
      expect(await rejectionOf(f.store.reserve("alice", third))).toMatchObject({
        id: "mcp_operation_limit",
      });
      const [row] = await f.db.execute<{ count: number }>(
        sql`SELECT count(*)::integer AS count FROM mcp_operation`,
      );
      expect(row.count).toBe(2);
    });
  }
  test("global active cap includes unknown outcomes; missing old actor key cannot reset owner/global accounting", async () => {
    const f = await mcpOperationFixture();
    f.setEnv({ ...f.env, GITHUB_INVITE_LOGINS: "alice,bob,outsider" });
    const a = await f.authorized(),
      b = await f.authorized("bob"),
      c = await f.authorized("outsider");
    await f.store.reserve("alice", a);
    await f.store.enter("alice", a.id, 1);
    await f.store.reserve("bob", b);
    await f.store.retainUnknown("alice", a.id, 2);
    const [stop] = await f.db.execute<{ stopped: boolean }>(
      sql`SELECT stopped FROM funding_control WHERE id='platform'`,
    );
    expect(stop.stopped).toBe(true);
    expect(await rejectionOf(f.store.reserve("outsider", c))).toMatchObject({
      id: "funded_inference_disabled",
    });
    // An explicit offline operator reset still cannot recover occupied capacity.
    await f.db.execute(
      sql`UPDATE funding_control SET stopped=false WHERE id='platform'`,
    );
    expect(await rejectionOf(f.store.reserve("outsider", c))).toMatchObject({
      id: "mcp_operation_limit",
    });
    f.setRuntime({
      ...f.runtime,
      activeKeyVersion: "v2",
      actorKeys: { v2: "another-fixture-actor-key-at-least-32-characters" },
    });
    expect(await rejectionOf(f.store.reserve("outsider", c))).toMatchObject({
      id: "mcp_actor_rotation_unknown",
    });
    const [row] = await f.db.execute<{ amount: string; count: number }>(
      sql`SELECT sum(reserved_microdollars)::text AS amount,count(*)::integer AS count FROM mcp_operation`,
    );
    expect(row).toEqual({ amount: "20000", count: 2 });
  });
  test("owner/connection deletion removes access metadata while anonymous holds, receipts and counters survive", async () => {
    const f = await mcpOperationFixture(),
      input = await f.authorized();
    await f.store.reserve("alice", input);
    await f.store.enter("alice", input.id, 1);
    const receipt = {
      id: crypto.randomUUID(),
      operationId: input.id,
      bindingDigest: operationDigest(input),
      evidenceDigest: "1".repeat(64),
      incurredMicrodollars: 5000,
      terminal: true,
      revision: "synthetic-v1",
    };
    await f.store.issueFixtureReceipt(receipt);
    const { deleteOwnedAccount } = await import(
      "../lib/actions/account/account"
    );
    await deleteOwnedAccount("alice");
    expect(await rejectionOf(f.store.status("alice", input.id))).toMatchObject({
      id: "not_found",
    });
    const [row] = await f.db.execute<{ state: string; amount: string }>(
      sql`SELECT state,reserved_microdollars::text AS amount FROM mcp_operation WHERE id=${input.id}`,
    );
    expect(row).toEqual({ state: "entered", amount: "10000" });
    const [retained] = await f.db.execute<{
      receipts: number;
      audit: number;
      owner: number;
      authority: number;
    }>(sql`SELECT
      (SELECT count(*)::integer FROM mcp_fixture_receipt WHERE operation_id=${input.id}) AS receipts,
      (SELECT count(*)::integer FROM mcp_operation_audit WHERE operation_id=${input.id}) AS audit,
      (SELECT count(*)::integer FROM mcp_operation_owner WHERE operation_id=${input.id}) AS owner,
      (SELECT count(*)::integer FROM mcp_fixture_authority WHERE id=${input.authority.id}) AS authority`);
    expect(retained).toEqual({ receipts: 1, audit: 2, owner: 0, authority: 0 });
    expect(
      await f.store.reconcile(input.id, receipt.bindingDigest, receipt.id, 2),
    ).toMatchObject({ state: "settled", incurredMicrodollars: 5000 });
    const [commitment] = await f.db.execute<{ amount: string }>(
      sql`SELECT sum(amount_microdollars)::text AS amount FROM mcp_operation_commitment`,
    );
    expect(commitment.amount).toBe("10000");
  });
});

test("populated pre0018 migration preserves legacy credit and BYOK unknown holds; private ledger RLS and SQL identity guard", async () => {
  const engine = await PGlite.create();
  try {
    for (const file of readdirSync("drizzle")
      .filter((file) => file.endsWith(".sql") && file < "0018")
      .sort())
      await engine.exec(readFileSync(`drizzle/${file}`, "utf8"));
    await engine.exec(
      `INSERT INTO credit_reservation(id,actor_key,actor_kind,idempotency_key,request_digest,day,month,reserved_microdollars,charged_microdollars,incurred_microdollars,state,price_snapshot) VALUES ('legacy-credit','anonymous-legacy','guest','once','digest','2026-01-01','2026-01',500000,500000,100000,'held','{}'); INSERT INTO guest_usage(actor_key,reservation_id) VALUES ('anonymous-legacy','legacy-credit'); INSERT INTO byok_operation(id,actor_key,provider,credential_revision,kind,digest,state) VALUES ('legacy-byok','anonymous-legacy','openrouter','legacy','chat','digest','held')`,
    );
    await engine.exec(readFileSync("drizzle/0018_mcp_operations.sql", "utf8"));
    const credits = await engine.query<{
      state: string;
      charged_microdollars: number;
      plan_month: string | null;
    }>("SELECT state,charged_microdollars,plan_month FROM credit_reservation");
    expect(credits.rows).toEqual([
      { state: "held", charged_microdollars: 500000, plan_month: null },
    ]);
    const byok = await engine.query<{ state: string }>(
      "SELECT state FROM byok_operation",
    );
    expect(byok.rows).toEqual([{ state: "held" }]);
    const guest = await engine.query<{ count: number }>(
      "SELECT count(*)::integer AS count FROM guest_usage",
    );
    expect(guest.rows[0].count).toBe(1);
    const rls = await engine.query<{
      relname: string;
      relrowsecurity: boolean;
    }>(
      "SELECT relname,relrowsecurity FROM pg_class WHERE relname IN ('mcp_operation','mcp_operation_owner','mcp_actor_alias','mcp_actor_key_version','mcp_operation_period','mcp_operation_commitment','mcp_operation_audit','mcp_fixture_authority','mcp_fixture_receipt')",
    );
    expect(rls.rows).toHaveLength(9);
    expect(rls.rows.every((row) => row.relrowsecurity)).toBe(true);
  } finally {
    await engine.close();
  }
});

test("three-month carry deduplicates sources by max, survives late settlement, and rejects increased prior exposure", async () => {
  const f = await mcpOperationFixture({ aMcp: 30000 });
  f.setEnv({ ...f.env, GITHUB_INVITE_LOGINS: "alice,bob,outsider" });
  const first = await f.authorized(),
    second = await f.authorized("bob");
  await f.store.reserve("alice", first);
  await f.store.enter("alice", first.id, 1);
  await f.store.reserve("bob", second);
  await f.store.enter("bob", second.id, 1);
  await f.store.retainUnknown("alice", first.id, 2);
  await f.store.retainUnknown("bob", second.id, 2);
  // Explicit offline operator reset permits testing carry without releasing either liability.
  await f.db.execute(
    sql`UPDATE funding_control SET stopped=false WHERE id='platform'`,
  );
  const { createReviewedBudgetPlan, registerReviewedBudgetPlan } = await import(
    "./helpers/platform-budget-fixture"
  );
  const { resolvePlatformBudgetConfig } = await import("../lib/funding/config");
  const initial = new Date();
  const carry = [
    { sourceId: first.id, amountMicrodollars: 10000 },
    { sourceId: second.id, amountMicrodollars: 10000 },
  ];
  async function advance(offset: number) {
    const now = new Date(
      Date.UTC(initial.getUTCFullYear(), initial.getUTCMonth() + offset, 2, 12),
    );
    f.setClock(now);
    const plan = createReviewedBudgetPlan(
      { aMcp: 30000, bSelected: 10000000 },
      f.env,
      now,
    );
    f.setEnv({ ...f.env, PLATFORM_BUDGET_PLAN_JSON: JSON.stringify(plan) });
    await registerReviewedBudgetPlan(f.db, plan, f.env);
    const config = resolvePlatformBudgetConfig(f.env, now),
      identity = {
        month: plan.month,
        revision: plan.revision,
        digest: config.digest,
        capacityDigest: config.capacityDigest,
      };
    await f.store.bootstrapPeriod(identity, carry);
    await f.store.bootstrapPeriod(identity, carry);
    return { now, identity };
  }
  await advance(1);
  const receipt = {
    id: crypto.randomUUID(),
    operationId: first.id,
    bindingDigest: operationDigest(first),
    evidenceDigest: "1".repeat(64),
    incurredMicrodollars: 4000,
    terminal: true,
    revision: "synthetic-v1",
  };
  await f.store.issueFixtureReceipt(receipt);
  await f.store.reconcile(first.id, receipt.bindingDigest, receipt.id, 3);
  const thirdMonth = await advance(2);
  const third = await f.authorized("outsider", {
    plan: thirdMonth.identity,
    deadline: new Date(thirdMonth.now.getTime() + 19000).toISOString(),
  });
  await f.store.reserve("outsider", third);
  const [amount] = await f.db.execute<{ current: string; historical: string }>(
    sql`SELECT (SELECT sum(amount_microdollars)::text FROM mcp_operation_commitment WHERE month=${thirdMonth.identity.month}) AS current,(SELECT sum(amount_microdollars)::text FROM mcp_operation_commitment WHERE source_id=${first.id}) AS historical`,
  );
  expect(amount).toEqual({ current: "30000", historical: "30000" });
  // The same source has three 10k frozen rows but consumes only 10k of current Amcp.
  // A later verified overrun remains full and stops funding, even for a prior month.
  const overrun = {
    ...receipt,
    id: crypto.randomUUID(),
    operationId: second.id,
    bindingDigest: operationDigest(second),
    incurredMicrodollars: 15000,
  };
  await f.store.issueFixtureReceipt(overrun);
  await f.store.reconcile(second.id, overrun.bindingDigest, overrun.id, 3);
  const [stop] = await f.db.execute<{ stopped: boolean }>(
    sql`SELECT stopped FROM funding_control WHERE id='platform'`,
  );
  expect(stop.stopped).toBe(true);
  // Explicit offline operator simulation: even clearing the stop cannot bypass frozen insufficient carry.
  await f.db.execute(
    sql`UPDATE funding_control SET stopped=false WHERE id='platform'`,
  );
  const next = await f.authorized("alice", {
    plan: thirdMonth.identity,
    deadline: new Date(thirdMonth.now.getTime() + 19000).toISOString(),
  });
  expect(await rejectionOf(f.store.reserve("alice", next))).toMatchObject({
    id: "mcp_carry_insufficient",
  });
  expect(
    await rejectionOf(
      f.store.bootstrapPeriod(thirdMonth.identity, [
        { sourceId: first.id, amountMicrodollars: 10000 },
        { sourceId: second.id, amountMicrodollars: 15000 },
      ]),
    ),
  ).toMatchObject({ id: "mcp_period_conflict" });
  const [credits] = await f.db.execute<{ count: number }>(
    sql`SELECT count(*)::integer AS count FROM credit_reservation`,
  );
  expect(credits.count).toBe(0);
  expect(f.seen).toHaveLength(0);
});

describe("MCP exact queued authority, fee and connection bindings", () => {
  const get = setupFixtureBeforeEach(() => mcpOperationFixture());
  test("caller mutation after the first awaited lock cannot change the owned complete identity snapshot", async () => {
    const f = get(),
      input = await f.authorized(),
      expected = structuredClone(input),
      expectedDigest = operationDigest(expected);
    let changed = false;
    f.afterQuery((statement) => {
      if (changed || !statement.includes("pg_advisory_xact_lock")) return;
      changed = true;
      input.connection.id = crypto.randomUUID();
      input.profile.digest = "0".repeat(64);
      input.catalog.revision = "mutated";
      input.action.digest = "0".repeat(64);
      if (input.approval) input.approval.digest = "0".repeat(64);
      input.authority.revision = "mutated";
      input.requestDigest = "0".repeat(64);
      input.feeDigest = "0".repeat(64);
      input.plan.digest = "0".repeat(64);
      input.deadline = "2000-01-01T00:00:00.000Z";
      input.idempotencyKey = "mutated";
    });
    expect(await f.store.reserve("alice", input)).toMatchObject({
      id: expected.id,
      state: "reserved",
    });
    expect(changed).toBe(true);
    f.afterQuery(undefined);
    const [persisted] = await f.db.execute<{
      binding_digest: string;
      idempotency_key: string;
    }>(
      sql`SELECT binding_digest,idempotency_key FROM mcp_operation WHERE id=${expected.id}`,
    );
    expect(persisted).toEqual({
      binding_digest: expectedDigest,
      idempotency_key: expected.idempotencyKey,
    });
    expect(await f.store.enter("alice", expected.id, 1)).toMatchObject({
      state: "entered",
      attempts: 1,
    });
    expect(f.seen).toHaveLength(0);
  });
  test("required approval cannot be omitted, reused across actions, or changed through persisted authority", async () => {
    const f = get();
    expect(
      await rejectionOf(
        f.store.issueFixtureAuthority(
          "alice",
          f.intent("alice", { approval: null }),
          new Date(Date.now() + 60000).toISOString(),
        ),
      ),
    ).toMatchObject({ id: "mcp_approval_required" });
    const input = await f.authorized();
    expect(
      await rejectionOf(f.authorized("alice", { approval: input.approval })),
    ).toMatchObject({ id: "mcp_approval_consumed" });
    expect(
      await rejectionOf(
        f.db.$client.unsafe(
          "UPDATE mcp_fixture_authority SET intent_digest=$1 WHERE id=$2",
          ["0".repeat(64), input.authority.id],
        ),
      ),
    ).toMatchObject({
      code: "P0001",
      message: expect.stringContaining("immutable"),
    });
    await f.store.reserve("alice", input);
    await f.store.enter("alice", input.id, 1);
    const [row] = await f.db.execute<{ count: number }>(
      sql`SELECT count(*)::integer AS count FROM mcp_operation_audit WHERE event='entered'`,
    );
    expect(row.count).toBe(1);
  });
  test("connection disable and revision change after reservation rejects entry while preserving hold", async () => {
    const f = get(),
      input = await f.authorized();
    await f.store.reserve("alice", input);
    const { McpRegistryStore } = await import("../lib/mcp/registry-store");
    await new McpRegistryStore(f.db).disable(
      "alice",
      input.connection.id,
      input.connection.revision,
    );
    expect(
      await rejectionOf(f.store.enter("alice", input.id, 1)),
    ).toMatchObject({ id: "mcp_connection_changed" });
    expect(await f.store.status("alice", input.id)).toMatchObject({
      state: "reserved",
      attempts: 0,
      reservedMicrodollars: 10000,
    });
  });
  test("full synthetic fee proof revision change while queued cannot be overridden by old caller identity", async () => {
    const f = get(),
      input = await f.authorized();
    await f.store.reserve("alice", input);
    f.setRuntime({
      ...f.runtime,
      fee: { ...f.fee, proofDigest: "0".repeat(64) },
    });
    expect(
      await rejectionOf(f.store.enter("alice", input.id, 1)),
    ).toMatchObject({ id: "mcp_operation_identity_changed" });
    expect(await f.store.status("alice", input.id)).toMatchObject({
      state: "reserved",
      attempts: 0,
    });
  });
  for (const phase of ["reserve", "enter"])
    test(`${phase} detects fee expiry after its final awaited query and rolls back`, async () => {
      const f = get();
      f.setRuntime({
        ...f.runtime,
        fee: { ...f.fee, expiresAt: new Date(Date.now() + 5000).toISOString() },
      });
      const input = await f.authorized();
      if (phase === "enter") await f.store.reserve("alice", input);
      let audited = false,
        changed = false;
      f.afterQuery((statement, result) => {
        if (statement.includes("INSERT INTO mcp_operation_audit"))
          audited = true;
        if (
          !audited ||
          changed ||
          !statement.includes("f.stopped,u.github_login")
        )
          return;
        changed = true;
        if (Array.isArray(result))
          for (const row of result)
            if (row && typeof row === "object" && "now" in row)
              Reflect.set(row, "now", new Date(Date.now() + 10000));
      });
      expect(
        await rejectionOf(
          phase === "reserve"
            ? f.store.reserve("alice", input)
            : f.store.enter("alice", input.id, 1),
        ),
      ).toMatchObject({ id: "mcp_fee_unavailable" });
      expect(changed).toBe(true);
      f.afterQuery(undefined);
      const [row] = await f.db.execute<{ count: number }>(
        sql`SELECT count(*)::integer AS count FROM mcp_operation WHERE attempts=1`,
      );
      expect(row.count).toBe(0);
    });
  test("account export exposes only owned sanitized metadata and connection deletion leaves anonymous liability", async () => {
    const f = get(),
      input = await f.authorized();
    await f.store.reserve("alice", input);
    await f.store.enter("alice", input.id, 1);
    const { exportOwnedAccount } = await import(
      "../lib/actions/account/account"
    );
    const exported = await exportOwnedAccount("alice");
    expect(exported.mcpOperations).toEqual([
      await f.store.status("alice", input.id),
    ]);
    expect((await exportOwnedAccount("bob")).mcpOperations).toEqual([]);
    const serialized = JSON.stringify(exported.mcpOperations);
    expect(serialized).not.toContain("actor");
    expect(serialized).not.toContain("digest");
    expect(serialized).not.toContain("secret");
    expect(serialized).not.toContain("request");
    await f.db.execute(
      sql`DELETE FROM mcp_connection WHERE id=${input.connection.id}`,
    );
    expect(await rejectionOf(f.store.status("alice", input.id))).toMatchObject({
      id: "not_found",
    });
    const [row] = await f.db.execute<{ state: string; amount: string }>(
      sql`SELECT state,reserved_microdollars::text AS amount FROM mcp_operation WHERE id=${input.id}`,
    );
    expect(row).toEqual({ state: "entered", amount: "10000" });
  });
});
