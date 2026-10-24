import { expect, mock, spyOn, test } from "bun:test";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import type { DatabaseTransaction } from "../lib/db/client";
import { rejectionOf as rawRejection } from "./helpers/rejection";
import { createSandboxGatewayFixture } from "./helpers/sandbox-gateway-fixture";
import { setupFixtureBeforeEach } from "./helpers/setup-fixture";

// The gateway client must reach the local scripted endpoint over real HTTP even
// though the beta fixture replaces globalThis.fetch for provider mocks.
const realFetch = globalThis.fetch;

mock.module("server-only", () => ({}));

const { mutateArtifact, readArtifact } = await import(
  "../lib/artifacts/service"
);
const { betaFixture } = await import("./helpers/beta-fixture");
const { JobStore, registerJobActionHandler } = await import(
  "../lib/jobs/store"
);
const { localFixtureWorker } = await import("../lib/jobs/worker");
const { SANDBOX_ACTION_REVISION } = await import("../lib/sandbox/contract");
const {
  SANDBOX_PROVIDER_CATALOG,
  resolveSandboxRuntimeFromEnv,
  sandboxProviderDecision,
} = await import("../lib/sandbox/config");
const { createSandboxGatewayClient } = await import(
  "../lib/sandbox/gateway-client"
);
const { createSandboxCoordinator } = await import("../lib/sandbox/coordinator");
const { resolvePlatformBudgetConfig } = await import("../lib/funding/config");
const { PlatformBudgetStore } = await import("../lib/funding/store");

type SandboxLease = import("../lib/sandbox/contract").SandboxLease;

async function rejectionOf(
  operation: PromiseLike<unknown>,
): Promise<{ id?: string; message?: string }> {
  return (await rawRejection(operation)) as { id?: string; message?: string };
}

const feeSnapshot = {
  id: "sandbox-fee-fixture",
  revision: "fee-v1",
  basis: "synthetic-offline" as const,
  reviewedAt: new Date(Date.now() - 3_600_000).toISOString(),
  expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
  proofReference: "offline-fixture-fee-proof",
  proofDigest: "e".repeat(64),
  upperBoundMicrodollars: 500_000,
  allInPlatformCost: true,
  coverage: {
    startup: true,
    compute: true,
    disk: true,
    egress: true,
    logging: true,
    orphanRetention: true,
    cleanup: true,
    providerFees: true,
  },
  capacity: {
    ownerActive: 1 as const,
    globalActive: 2 as const,
    ownerRecords: 100,
    globalRecords: 1000,
    leaseMs: 20_000 as const,
  },
};

let currentCheckpoint: ((lease: SandboxLease) => Promise<void>) | null = null;
registerJobActionHandler(SANDBOX_ACTION_REVISION, (lease) => {
  if (!currentCheckpoint) throw new Error("sandbox_checkpoint_unregistered");
  return currentCheckpoint(lease);
});

const get = setupFixtureBeforeEach(async () => {
  const gatewayFixture = createSandboxGatewayFixture();
  const f = await betaFixture({
    environment: {
      GITHUB_INVITE_LOGINS: "alice,bob,carol",
      PLATFORM_INFRA_MICRODOLLARS: "2000000",
      SANDBOX_IMAGE_DIGEST: "b".repeat(64),
      SANDBOX_INTERPRETER_DIGEST: "c".repeat(64),
    },
  });
  await f.db.$client
    .unsafe(
      `INSERT INTO "user"(id,name,email,email_verified,github_login) VALUES ('carol','Carol','carol@example.invalid',true,'carol');
       INSERT INTO account(id,account_id,provider_id,user_id) VALUES
       ('alice-gh','110101','github','alice'),('bob-gh','220202','github','bob'),('carol-gh','110101','github','carol');
       INSERT INTO chat(id,user_id,title) VALUES ('source-chat','alice','Source'),('carol-chat','carol','Carol');
       INSERT INTO chat_message(id,chat_id,user_id,role,parts,attachments) VALUES
       ('source-message','source-chat','alice','assistant','[{"type":"text","text":"Owned python source"}]','[]'),
       ('carol-message','carol-chat','carol','assistant','[{"type":"text","text":"Carol python source"}]','[]')`,
    )
    .simple();
  const source = await mutateArtifact("alice", {
    action: "create",
    chatId: "source-chat",
    messageId: "source-message",
    kind: "markdown",
    title: "Owned python source",
  });
  const carolSource = await mutateArtifact("carol", {
    action: "create",
    chatId: "carol-chat",
    messageId: "carol-message",
    kind: "markdown",
    title: "Carol python source",
  });
  const runtime = {
    providerId: "offline-scripted-v1",
    providerAccount: "gh-fixture-110101",
    providerRegion: "us-fixture-1",
    gateway: {
      baseUrl: gatewayFixture.url,
      key: gatewayFixture.key,
      keyIdentity: createHash("sha256")
        .update(gatewayFixture.key)
        .digest("hex"),
    },
    fee: feeSnapshot,
    activeKeyVersion: "v1",
    actorKeys: { v1: "sandbox-actor-key-v1-0123456789abcdef01" },
    principalSecret: "sandbox-principal-secret-0123456789abcdef",
  };
  const gateway = createSandboxGatewayClient({
    baseUrl: gatewayFixture.url,
    key: gatewayFixture.key,
    keyIdentity: createHash("sha256").update(gatewayFixture.key).digest("hex"),
    fetchImpl: realFetch,
  });
  let afterQuery:
    | ((statement: string, tx: DatabaseTransaction) => Promise<void>)
    | undefined;
  const dialect = new PgDialect();
  const guardedDb = new Proxy(f.db, {
    get(target, property, receiver) {
      if (property === "transaction")
        return <T>(
          run: (tx: DatabaseTransaction) => Promise<T>,
          options?: Parameters<typeof f.db.transaction>[1],
        ) =>
          target.transaction(
            (tx) =>
              run(
                new Proxy(tx, {
                  get(t, key, r) {
                    if (key === "execute")
                      return async (
                        query: Parameters<DatabaseTransaction["execute"]>[0],
                      ) => {
                        const result = await t.execute(query);
                        await afterQuery?.(
                          typeof query === "string"
                            ? query
                            : dialect.sqlToQuery(query.getSQL()).sql,
                          t,
                        );
                        return result;
                      };
                    return Reflect.get(t, key, r);
                  },
                }),
              ),
            options,
          );
      return Reflect.get(target, property, receiver);
    },
  });
  const coordinator = createSandboxCoordinator({
    db: guardedDb,
    runtime: () => runtime,
    env: () => process.env,
    gateway,
  });
  currentCheckpoint = coordinator.checkpoint;
  const jobs = new JobStore(f.db);
  return {
    ...f,
    gatewayFixture,
    runtime,
    gateway,
    coordinator,
    store: coordinator.store,
    afterQuery(fn: typeof afterQuery) {
      afterQuery = fn;
    },
    jobs,
    source: source.id,
    carolSource: carolSource.id,
    close: async () => {
      currentCheckpoint = null;
      await gatewayFixture.close();
      await f.close();
    },
  };
});

function worker(f: ReturnType<typeof get>) {
  return localFixtureWorker(f.jobs);
}

async function ensureReviewedPeriod() {
  const f = get();
  const config = resolvePlatformBudgetConfig(process.env, new Date());
  // Best-effort: once a funding stop is durable, even the operator bootstrap is
  // denied; tests that expect that state assert it explicitly afterwards.
  try {
    await f.store.bootstrapPeriod(
      {
        month: config.plan.month,
        revision: config.plan.revision,
        digest: config.digest,
        capacityDigest: config.capacityDigest,
      },
      500_000,
    );
  } catch {
    // ignored: the period may already exist or funding may be stopped
  }
  return f;
}

async function runToApproval() {
  const f = await ensureReviewedPeriod();
  const id = crypto.randomUUID();
  await f.store.enqueue("alice", {
    id,
    source: { artifactId: f.source, version: 1 },
  });
  await worker(f).deliver(id);
  const row = await f.store.read("alice", id);
  if (!row.checkpoint) throw new Error("missing_checkpoint");
  return {
    ...f,
    id,
    row,
    approval: {
      id,
      checkpoint: row.checkpoint,
      actionRevision: SANDBOX_ACTION_REVISION,
    },
  };
}

async function runToCompletion() {
  const w = await runToApproval();
  await w.store.approve("alice", w.approval);
  await worker(w).deliver(w.id);
  const done = await w.store.read("alice", w.id);
  return { ...w, done };
}

async function operations(f: ReturnType<typeof get>) {
  return f.db.execute<{
    id: string;
    state: string;
    actor_key: string;
    reserved_microdollars: string;
    incurred_microdollars: string;
    attempts: number;
    create_requested_at: Date | null;
    provider_handle: string | null;
    month: string;
  }>(sql`SELECT * FROM sandbox_operation ORDER BY created_at,id`);
}

test("happy path: approval funds a fenced execution that publishes one bounded report from exactly one creation tombstone", async () => {
  const w = await runToCompletion();
  expect(w.done.error ?? "").toBe("");
  expect(w.done.state).toBe("completed");
  expect(w.done.resultArtifactId).toBeTruthy();
  expect(w.gatewayFixture.counters.create).toBe(1);
  expect(w.gatewayFixture.tombstones()).toHaveLength(1);
  if (!w.done.resultArtifactId) throw new Error("missing_result_artifact");
  const report = await readArtifact("alice", w.done.resultArtifactId);
  expect(report.title).toBe("Sandbox execution report");
  expect(report.content).toContain("untrusted data");
  expect(report.content).toContain(w.gatewayFixture.script.result.trim());
  expect(Buffer.byteLength(report.content)).toBeLessThanOrEqual(128 * 1024);
  const ops = await operations(w);
  expect(ops).toHaveLength(1);
  expect(ops[0].state).toBe("completed_unreconciled");
  expect(Number(ops[0].reserved_microdollars)).toBe(500_000);
  // Terminal transport evidence never settles cost; this child has no authentic receipt authority.
  const evidence = await w.db.execute(
    sql`SELECT kind FROM (SELECT evidence->>'kind' AS kind FROM sandbox_operation_evidence WHERE operation_id=${ops[0].id}) kinds`,
  );
  expect(evidence.map((row) => row.kind).sort()).toEqual([
    "create_ok",
    "result",
    "terminate",
  ]);
  const bindingDigest = await w.db.execute<{ binding_digest: string }>(
    sql`SELECT binding_digest FROM sandbox_operation WHERE id=${ops[0].id}`,
  );
  const status = await w.store.status("alice", ops[0].id);
  const receiptId = crypto.randomUUID();
  await w.db.execute(
    sql`INSERT INTO sandbox_receipt(id,operation_id,receipt) VALUES (${receiptId},${ops[0].id},${JSON.stringify(
      {
        id: receiptId,
        operationId: ops[0].id,
        bindingDigest: bindingDigest[0].binding_digest,
        evidenceDigest: "f".repeat(64),
        incurredMicrodollars: 100_000,
        terminal: true,
        revision: "fee-v1",
      },
    )}::jsonb)`,
  );
  const deniedReceipt = await rejectionOf(
    w.store.reconcile(
      ops[0].id,
      bindingDigest[0].binding_digest,
      receiptId,
      status.revision,
    ),
  );
  expect(deniedReceipt.id).toBe("sandbox_receipt_authority_unavailable");
  expect((await operations(w))[0].state).toBe("completed_unreconciled");
  const [control] = await w.db.execute<{ stopped: boolean }>(
    sql`SELECT stopped FROM funding_control WHERE id='platform'`,
  );
  expect(control.stopped).toBe(false);
  // Sanitized export: no handles, identities or fee snapshots.
  const exported = await w.store.exportOperations("alice");
  expect(exported).toHaveLength(1);
  expect(Object.keys(exported[0]).sort()).toEqual([
    "createdAt",
    "id",
    "incurredMicrodollars",
    "reservedMicrodollars",
    "revision",
    "state",
  ]);
});

test("provider boundaries stay honest: cataloged providers deny with precise reasons and the offline adapter is test-only", async () => {
  const cloudflare = sandboxProviderDecision(
    "cloudflare-containers-v1",
  ) as Extract<ReturnType<typeof sandboxProviderDecision>, { kind: "deny" }>;
  expect(cloudflare.reasons).toEqual(
    SANDBOX_PROVIDER_CATALOG["cloudflare-containers-v1"].denyReasons,
  );
  expect(cloudflare.reasons).toContain("sandbox_disk_minimum_exceeded");
  const modal = sandboxProviderDecision("modal-v1") as Extract<
    ReturnType<typeof sandboxProviderDecision>,
    { kind: "deny" }
  >;
  expect(modal.reasons).toContain("sandbox_isolation_unproven");
  expect(
    (
      sandboxProviderDecision("acme-sandboxes-v9") as Extract<
        ReturnType<typeof sandboxProviderDecision>,
        { kind: "deny" }
      >
    ).reasons,
  ).toEqual(["sandbox_provider_unknown"]);
  const productionEnv = {
    ...process.env,
    NODE_ENV: "production",
    SANDBOX_PROVIDER: "offline-scripted-v1",
  };
  expect(
    (
      await rejectionOf(
        Promise.resolve().then(() =>
          resolveSandboxRuntimeFromEnv(productionEnv),
        ),
      )
    ).id,
  ).toBe("sandbox_adapter_offline_only");
  const modalEnv = {
    ...process.env,
    NODE_ENV: "production",
    SANDBOX_PROVIDER: "modal-v1",
  };
  expect(
    (
      await rejectionOf(
        Promise.resolve().then(() => resolveSandboxRuntimeFromEnv(modalEnv)),
      )
    ).id,
  ).toBe("sandbox_isolation_unproven");
  const unknownEnv = {
    ...process.env,
    NODE_ENV: "production",
    SANDBOX_PROVIDER: "nope",
  };
  expect(
    (
      await rejectionOf(
        Promise.resolve().then(() => resolveSandboxRuntimeFromEnv(unknownEnv)),
      )
    ).id,
  ).toBe("sandbox_provider_unknown");
});

test("configuration failures produce zero creation calls and consume no approval or reservation", async () => {
  // Plan drift after approval denies the run durably.
  const w = await runToApproval();
  await w.store.approve("alice", w.approval);
  const previousPlan = process.env.PLATFORM_BUDGET_PLAN_JSON;
  if (!previousPlan) throw new Error("missing_plan");
  process.env.PLATFORM_BUDGET_PLAN_JSON = JSON.stringify({
    ...JSON.parse(previousPlan),
    revision: crypto.randomUUID(),
  });
  // Plan drift terminalizes the run durably instead of surfacing a transport error.
  try {
    await worker(w).deliver(w.id);
  } finally {
    process.env.PLATFORM_BUDGET_PLAN_JSON = previousPlan;
  }
  const done = await w.store.read("alice", w.id);
  expect(done.error).toBe("sandbox_binding_changed");
  expect(w.gatewayFixture.counters.create).toBe(0);
  expect((await operations(w)).length).toBe(0);
  const [job] = await w.db.execute<{ approved_digest: string | null }>(
    sql`SELECT approved_digest FROM durable_job WHERE id=${w.id}`,
  );
  expect(job.approved_digest).toBe(w.row.checkpoint);

  // Invalid policy digests deny every attempt without consuming the approval.
  const w2 = await runToApproval();
  await w2.store.approve("alice", w2.approval);
  const previousDigest = process.env.SANDBOX_IMAGE_DIGEST;
  process.env.SANDBOX_IMAGE_DIGEST = "not-a-digest";
  try {
    expect((await rejectionOf(worker(w2).deliver(w2.id))).id).toBe(
      "sandbox_policy_unconfigured",
    );
  } finally {
    process.env.SANDBOX_IMAGE_DIGEST = previousDigest;
  }
  expect(w2.gatewayFixture.counters.create).toBe(0);
  expect((await operations(w2)).length).toBe(0);
});

test("exact ownership and source identity: another owner's revision is not found and a deleted source fails with zero creation calls", async () => {
  const f = get();
  expect(
    (
      await rejectionOf(
        f.store.enqueue("alice", {
          id: crypto.randomUUID(),
          source: { artifactId: f.carolSource, version: 1 },
        }),
      )
    ).id,
  ).toBe("not_found");

  const w = await runToApproval();
  await w.store.approve("alice", w.approval);
  await mutateArtifact("alice", {
    action: "delete",
    id: w.source,
  });
  await worker(w).deliver(w.id);
  const done = await w.store.read("alice", w.id);
  expect(done.error).toBe("job_source_unavailable");
  expect(w.gatewayFixture.counters.create).toBe(0);
  expect((await operations(w)).length).toBe(0);
});

test("sandbox envelope: ordinaryInfra + committed + incoming stays within k_infra and never borrows acredit or amcp", async () => {
  const f = get();
  const month = new Date().toISOString().slice(0, 7);
  await ensureReviewedPeriod();
  // A current-month uncertain orphan hold of 1.6M plus the reviewed ordinary
  // infra commitment of 0.5M leaves no room for a 0.5M incoming reservation.
  await f.db.execute(
    sql`INSERT INTO sandbox_operation(id,actor_key,actor_version,idempotency_key,binding_digest,identity,fee_snapshot,month,day,state,reserved_microdollars,deadline,attempts,create_requested_at)
    VALUES(${crypto.randomUUID()},${"a".repeat(64)},'v1','orphan-1',${"1".repeat(64)},'{}'::jsonb,'{}'::jsonb,${month},CURRENT_DATE,'held',1600000,now()+interval '1 minute',1,clock_timestamp())`,
  );
  const w = await runToApproval();
  await w.store.approve("alice", w.approval);
  expect((await rejectionOf(worker(w).deliver(w.id))).id).toBe(
    "sandbox_envelope_exhausted",
  );
  expect(w.gatewayFixture.counters.create).toBe(0);
  const ops = await operations(f);
  expect(ops).toHaveLength(1);
  expect(ops[0].state).toBe("held");
});

test("missing prior-month sandbox carry blocks all funded admission until the namespaced carry is bootstrapped, and frozen carry never shrinks", async () => {
  const f = get();
  const previous = new Date();
  previous.setUTCMonth(previous.getUTCMonth() - 1);
  const priorMonth = previous.toISOString().slice(0, 7);
  const priorId = crypto.randomUUID();
  await f.db.execute(
    sql`INSERT INTO sandbox_operation(id,actor_key,actor_version,idempotency_key,binding_digest,identity,fee_snapshot,month,day,state,reserved_microdollars,deadline,attempts,create_requested_at)
    VALUES(${priorId},${"a".repeat(64)},'v1','prior-1',${"2".repeat(64)},'{}'::jsonb,'{}'::jsonb,${priorMonth},CURRENT_DATE,'held',500000,now()+interval '1 minute',1,clock_timestamp())`,
  );
  const config = resolvePlatformBudgetConfig(process.env, new Date());
  const budget = new PlatformBudgetStore(f.db);
  const planIdentity = {
    month: config.plan.month,
    expectedRevision: config.plan.revision,
    expectedDigest: config.digest,
    expectedCapacityDigest: config.capacityDigest,
  };
  expect((await rejectionOf(budget.assertActivePlan(planIdentity))).id).toBe(
    "uncovered_sandbox_exposure",
  );
  await f.coordinator.store.bootstrapPeriod(
    {
      month: config.plan.month,
      revision: config.plan.revision,
      digest: config.digest,
      capacityDigest: config.capacityDigest,
    },
    500_000,
  );
  await budget.assertActivePlan(planIdentity);
  const [commitment] = await f.db.execute<{ amount: string }>(
    sql`SELECT amount_microdollars::text AS amount FROM sandbox_operation_commitment WHERE month=${config.plan.month} AND source_id=${priorId}`,
  );
  expect(Number(commitment.amount)).toBe(500_000);
  const deleted = await rejectionOf(
    f.db.execute(
      sql`DELETE FROM sandbox_operation_commitment WHERE month=${config.plan.month} AND source_id=${priorId}`,
    ),
  );
  expect(
    `${deleted.message} ${(deleted as { cause?: { message?: string } }).cause?.message ?? ""}`,
  ).toContain("retained");
});

test("ambiguous create retains full liability, stops funded admissions and never creates twice", async () => {
  const f = get();
  f.gatewayFixture.script.create = "oversized";
  const w = await runToApproval();
  await w.store.approve("alice", w.approval);
  await worker(w).deliver(w.id);
  const done = await w.store.read("alice", w.id);
  expect(done.error).toBe("sandbox_create_ambiguous");
  const ops = await operations(w);
  expect(ops).toHaveLength(1);
  expect(ops[0].state).toBe("held");
  expect(ops[0].create_requested_at).not.toBeNull();
  expect(w.gatewayFixture.counters.create).toBe(1);
  const [control] = await w.db.execute<{ stopped: boolean }>(
    sql`SELECT stopped FROM funding_control WHERE id='platform'`,
  );
  expect(control.stopped).toBe(true);
  // Uncertainty is never forgiven: the hold stays and no admission is possible.
  expect(ops[0].attempts).toBe(1);

  // A second approval attempt cannot obtain funded admission at all.
  f.gatewayFixture.script.create = "ok";
  const second = await runToApproval();
  await second.store.approve("alice", second.approval);
  expect((await rejectionOf(worker(second).deliver(second.id))).id).toBe(
    "funded_inference_disabled",
  );
  expect(second.gatewayFixture.counters.create).toBe(1);
});

test("HTTP rejection after entry cannot prove no resource or zero cost", async () => {
  const f = get();
  f.gatewayFixture.script.create = "reject";
  const w = await runToApproval();
  await w.store.approve("alice", w.approval);
  await worker(w).deliver(w.id);
  const done = await w.store.read("alice", w.id);
  expect(done.error).toBe("sandbox_create_ambiguous");
  const ops = await operations(w);
  expect(ops[0].state).toBe("held");
  expect(Number(ops[0].incurred_microdollars)).toBe(0);
  expect(w.gatewayFixture.tombstones()).toHaveLength(0);
  const [control] = await w.db.execute<{ stopped: boolean }>(
    sql`SELECT stopped FROM funding_control WHERE id='platform'`,
  );
  expect(control.stopped).toBe(true);
});

test("crash after the durable creation tombstone: recovery publishes with the fresh fence without a second create", async () => {
  const f = get();
  const w = await runToApproval();
  await w.store.approve("alice", w.approval);
  const lease = await f.jobs.claim(w.id);
  if (!lease) throw new Error("no_lease");
  // Park execution exactly on the crash boundary after the create outcome.
  await f.store.dispatch(lease, f.gateway, { stopAfterCreate: true });
  expect(f.gatewayFixture.counters.create).toBe(1);
  // The process "dies": lease expires and a fresh claim recovers the journal.
  await f.db.execute(
    sql`UPDATE durable_job SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE id=${w.id}`,
  );
  const recovered = await f.jobs.claim(w.id);
  if (!recovered) throw new Error("no_recovered_lease");
  expect(recovered.fence).toBeGreaterThan(lease.fence);
  // Attempt 1 proposed, attempt 2 created, attempt 3 recovers and publishes.
  expect(recovered.attempt).toBe(3);
  await f.store.dispatch(recovered, f.gateway);
  const done = await f.store.read("alice", w.id);
  expect(done.state).toBe("completed");
  expect(f.gatewayFixture.counters.create).toBe(1);
  expect(f.gatewayFixture.counters.terminate).toBe(1);
  const ops = await operations(f);
  expect(ops[0].state).toBe("completed_unreconciled");
});

test("cancellation and stale fences cannot publish; duplicate delivery publishes exactly one artifact", async () => {
  // Cancelled while awaiting approval: no funding, no creation.
  const cancelled = await runToApproval();
  await cancelled.jobs.cancel("alice", cancelled.id);
  await worker(cancelled).deliver(cancelled.id);
  expect(cancelled.gatewayFixture.counters.create).toBe(0);
  expect((await operations(cancelled)).length).toBe(0);

  // Stale lease checkpoint can neither propose nor publish.
  const w = await runToCompletion();
  const stale: SandboxLease = {
    id: w.id,
    ownerId: "alice",
    fence: 0,
    attempt: 1,
    checkpoint: 1,
  };
  expect((await rejectionOf(w.store.dispatch(stale, w.gateway))).id).toBe(
    "job_stale_lease",
  );
  const artifacts = await w.db.execute<{ count: number }>(
    sql`SELECT count(*)::integer AS count FROM artifact WHERE user_id='alice'`,
  );
  expect(artifacts[0].count).toBe(2);
  await worker(w).recover();
  expect(
    (
      await w.db.execute<{ count: number }>(
        sql`SELECT count(*)::integer AS count FROM artifact WHERE user_id='alice'`,
      )
    )[0].count,
  ).toBe(2);
});

test("uncertain orphan holds count against owner and global active capacity", async () => {
  const f = get();
  await runToCompletion();
  const ops = await operations(f);
  const aliceKey = ops[0].actor_key;
  // An uncertain orphan (entered, no outcome) counts as active capacity.
  await f.db.execute(
    sql`INSERT INTO sandbox_operation(id,actor_key,actor_version,idempotency_key,binding_digest,identity,fee_snapshot,month,day,state,reserved_microdollars,deadline,attempts,create_requested_at)
    VALUES(${crypto.randomUUID()},${aliceKey},'v1','orphan-1',${"7".repeat(64)},'{}'::jsonb,'{}'::jsonb,${new Date().toISOString().slice(0, 7)},CURRENT_DATE,'entered',500000,now()+interval '1 minute',1,clock_timestamp())`,
  );
  const second = await runToApproval();
  await second.store.approve("alice", second.approval);
  expect((await rejectionOf(worker(second).deliver(second.id))).id).toBe(
    "sandbox_capacity_exhausted",
  );
  expect(second.gatewayFixture.counters.create).toBe(1);
});

test("recreated accounts and rotated actor keys keep the retained principal and its limits", async () => {
  const f = get();
  const w = await runToCompletion();
  const ops = await operations(w);
  const aliceKey = ops[0].actor_key;

  // Carol shares alice's canonical numeric GitHub identity: same retained actor.
  const carolId = crypto.randomUUID();
  await f.store.enqueue("carol", {
    id: carolId,
    source: { artifactId: f.carolSource, version: 1 },
  });
  await worker(f).deliver(carolId);
  const carolRow = await f.store.read("carol", carolId);
  if (!carolRow.checkpoint) throw new Error("missing_checkpoint");
  await f.store.approve("carol", {
    id: carolId,
    checkpoint: carolRow.checkpoint,
    actionRevision: SANDBOX_ACTION_REVISION,
  });
  // Delete the original account: retained financial principal and capacity remain.
  await f.db.execute(sql`DELETE FROM "user" WHERE id='alice'`);
  expect((await rejectionOf(worker(f).deliver(carolId))).id).toBe(
    "sandbox_capacity_exhausted",
  );
  expect(await operations(f)).toHaveLength(1);

  await f.jobs.cancel("carol", carolId);
  // Rotation to a new key version never resets the retained actor key.
  const rotatedRuntime = {
    ...f.runtime,
    activeKeyVersion: "v2",
    actorKeys: {
      v1: "sandbox-actor-key-v1-0123456789abcdef01",
      v2: "sandbox-actor-key-v2-9876543210fedcba99",
    },
  };
  const rotatedCoordinator = createSandboxCoordinator({
    db: f.db,
    runtime: () => rotatedRuntime,
    env: () => process.env,
    gateway: f.gateway,
  });
  const rotatedId = crypto.randomUUID();
  currentCheckpoint = rotatedCoordinator.checkpoint;
  try {
    await rotatedCoordinator.store.enqueue("carol", {
      id: rotatedId,
      source: { artifactId: f.carolSource, version: 1 },
    });
    await worker(f).deliver(rotatedId);
    const rotatedRow = await rotatedCoordinator.store.read("carol", rotatedId);
    if (!rotatedRow.checkpoint) throw new Error("missing_checkpoint");
    await rotatedCoordinator.store.approve("carol", {
      id: rotatedId,
      checkpoint: rotatedRow.checkpoint,
      actionRevision: SANDBOX_ACTION_REVISION,
    });
    expect((await rejectionOf(worker(f).deliver(rotatedId))).id).toBe(
      "sandbox_capacity_exhausted",
    );
  } finally {
    currentCheckpoint = f.coordinator.checkpoint;
  }
  const finalOps = await operations(f);
  expect(finalOps).toHaveLength(1);
  expect(finalOps[0].actor_key).toBe(aliceKey);
  expect(f.gatewayFixture.counters.create).toBe(1);
  const principals = await f.db.execute<{ count: number }>(
    sql`SELECT count(*)::integer AS count FROM sandbox_actor_principal`,
  );
  expect(principals[0].count).toBe(1);
});

test("bounded wire client: oversized and malformed responses and HTTP errors never release liability, and handles are path-safe", async () => {
  const f = get();
  const client = f.gateway;
  f.gatewayFixture.script.create = "oversized";
  expect(
    (
      await client.create({
        protocol: "sandbox-gateway-v1",
        idempotencyKey: crypto.randomUUID(),
        bindingDigest: "1".repeat(64),
        policy: {
          imageDigest: "b".repeat(64),
          interpreterDigest: "c".repeat(64),
          interpreter: "python3",
          entryPath: "/app/main.py",
          vcpuMilli: 1000,
          memoryMiB: 512,
          diskMiB: 128,
          network: "denied",
          packageInstallation: "denied",
          commandMs: 15_000,
          absoluteLifetimeMs: 300_000,
          logsBytes: 4096,
          resultBytes: 4096,
        },
        input: { contentSha256: "9".repeat(64), selectedInputDigests: [] },
      })
    ).kind,
  ).toBe("ambiguous");
  f.gatewayFixture.script.create = "reject";
  const rejected = await client.create({
    protocol: "sandbox-gateway-v1",
    idempotencyKey: crypto.randomUUID(),
    bindingDigest: "1".repeat(64),
    policy: {
      imageDigest: "b".repeat(64),
      interpreterDigest: "c".repeat(64),
      interpreter: "python3",
      entryPath: "/app/main.py",
      vcpuMilli: 1000,
      memoryMiB: 512,
      diskMiB: 128,
      network: "denied",
      packageInstallation: "denied",
      commandMs: 15_000,
      absoluteLifetimeMs: 300_000,
      logsBytes: 4096,
      resultBytes: 4096,
    },
    input: { contentSha256: "9".repeat(64), selectedInputDigests: [] },
  });
  expect(rejected.kind).toBe("rejected");
  // Malformed handles fail locally: no request is ever sent.
  const before = { ...f.gatewayFixture.counters };
  expect((await client.status("../../etc/passwd")).kind).toBe("ambiguous");
  expect((await client.terminate("bad handle")).kind).toBe("ambiguous");
  expect(f.gatewayFixture.counters.create).toBe(before.create);
  expect(f.gatewayFixture.counters.status).toBe(before.status);
  expect(f.gatewayFixture.counters.terminate).toBe(before.terminate);
  // Oversized and malformed status bodies never parse as success.
  f.gatewayFixture.script.status = "oversized";
  const unknownHandle = "aaaaaaaa-1111-4111-8111-111111111111";
  expect((await client.status(unknownHandle)).kind).toBe("rejected");
  f.gatewayFixture.script.status = "malformed";
  const transport = await client.status(unknownHandle);
  expect(transport.kind).toBe("rejected");
});

test("migration 0022 preserves populated 0021 data, keeps financial rows non-cascading and deny-by-default", async () => {
  const standalone = await PGlite.create();
  try {
    const files = readdirSync("drizzle")
      .filter((name) => name.endsWith(".sql"))
      .sort();
    for (const file of files) {
      if (file > "0021_mcp_execution.sql") break;
      await standalone.exec(readFileSync(`drizzle/${file}`, "utf8"));
    }
    await standalone.exec(`
      INSERT INTO "user"(id,name,email,email_verified,github_login)
      VALUES ('u1','User 1','u1@example.invalid',true,'u1');
      INSERT INTO durable_job(id,user_id,source_artifact_id,source_version,state)
      VALUES ('job-1','u1','art-1',1,'queued');
      INSERT INTO credit_reservation(id,actor_key,actor_kind,idempotency_key,request_digest,day,month,reserved_microdollars,charged_microdollars,incurred_microdollars,state,price_snapshot)
      VALUES ('res-1','${"b".repeat(64)}','user','idem-1','${"c".repeat(64)}','2026-10-01','2026-10',50000,50000,0,'held','{"id":"p1"}'::jsonb);
    `);
    await standalone.exec(
      readFileSync("drizzle/0022_sandbox_execution.sql", "utf8"),
    );
    const users = await standalone.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM "user"',
    );
    const jobs = await standalone.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM durable_job",
    );
    const reservations = await standalone.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM credit_reservation",
    );
    expect(users.rows[0].count).toBe("1");
    expect(jobs.rows[0].count).toBe("1");
    expect(reservations.rows[0].count).toBe("1");
    const rls = await standalone.query<{
      tablename: string;
      rowsecurity: boolean;
    }>(
      "SELECT tablename,rowsecurity FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'sandbox_%' ORDER BY tablename",
    );
    expect(rls.rows.length).toBeGreaterThan(8);
    expect(rls.rows.every((row) => row.rowsecurity)).toBe(true);
    await standalone.exec(`
      INSERT INTO sandbox_actor_principal(principal_digest,actor_key,actor_version)
      VALUES ('${"3".repeat(64)}','${"4".repeat(64)}','v1');
      INSERT INTO sandbox_operation(id,actor_key,actor_version,idempotency_key,binding_digest,identity,fee_snapshot,month,day,state,reserved_microdollars,deadline,attempts,create_requested_at)
      VALUES ('${crypto.randomUUID()}','${"4".repeat(64)}','v1','op-1','${"5".repeat(64)}','{}'::jsonb,'{}'::jsonb,'2026-09',CURRENT_DATE,'held',500000,now()+interval '1 minute',1,clock_timestamp());
    `);
    expect(
      (await rejectionOf(standalone.exec("DELETE FROM sandbox_operation")))
        .message,
    ).toContain("retained");
    expect(
      (
        await rejectionOf(
          standalone.exec(
            "UPDATE sandbox_actor_principal SET actor_version='v2'",
          ),
        )
      ).message,
    ).toContain("prohibited");
    // Financial rows never cascade with owner deletion.
    await standalone.exec("DELETE FROM \"user\" WHERE id='u1'");
    const retained = await standalone.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM sandbox_operation",
    );
    expect(retained.rows[0].count).toBe("1");
  } finally {
    await standalone.close();
  }
});

test("review: an entered HTTP rejection retains liability and globally stops admissions", async () => {
  const f = get();
  f.gatewayFixture.script.create = "reject";
  const w = await runToApproval();
  await w.store.approve("alice", w.approval);
  await worker(w).deliver(w.id);
  expect((await operations(w))[0].state).toBe("held");
  const [control] = await w.db.execute<{ stopped: boolean }>(
    sql`SELECT stopped FROM funding_control WHERE id='platform'`,
  );
  expect(control.stopped).toBe(true);
});

test("review: financial owner mapping does not block actual owner deletion", async () => {
  const w = await runToCompletion();
  const op = (await operations(w))[0];
  await w.db.execute(sql`DELETE FROM "user" WHERE id='alice'`);
  const [retained] = await w.db.execute<{ count: number }>(
    sql`SELECT count(*)::integer AS count FROM sandbox_operation WHERE id=${op.id}`,
  );
  expect(retained.count).toBe(1);
  const [mapping] = await w.db.execute<{ count: number }>(
    sql`SELECT count(*)::integer AS count FROM sandbox_operation_owner WHERE operation_id=${op.id}`,
  );
  expect(mapping.count).toBe(0);
});

test("review: financial evidence never retains raw user output or logs", async () => {
  const f = get();
  f.gatewayFixture.script.logs = "private-log-canary";
  f.gatewayFixture.script.result = "private-result-canary";
  const w = await runToCompletion();
  const records = await w.db.execute<{ evidence: unknown }>(
    sql`SELECT evidence FROM sandbox_operation_evidence`,
  );
  expect(JSON.stringify(records)).not.toContain("private-log-canary");
  expect(JSON.stringify(records)).not.toContain("private-result-canary");
});

test("review: completed commands without resource-stop evidence cannot free active capacity", async () => {
  const w = await runToCompletion();
  const second = await runToApproval();
  await second.store.approve("alice", second.approval);
  const error = await rejectionOf(worker(second).deliver(second.id));
  expect(error.id).toBeTruthy();
  expect(w.gatewayFixture.counters.create).toBe(1);
});

test("review: saved test environment cannot enable admission after the real process leaves test mode", async () => {
  const f = get();
  const saved = { ...process.env, NODE_ENV: "test" };
  let afterQuery:
    | ((statement: string, tx: DatabaseTransaction) => Promise<void>)
    | undefined;
  const dialect = new PgDialect();
  const guardedDb = new Proxy(f.db, {
    get(target, property, receiver) {
      if (property === "transaction")
        return <T>(
          run: (tx: DatabaseTransaction) => Promise<T>,
          options?: Parameters<typeof f.db.transaction>[1],
        ) =>
          target.transaction(
            (tx) =>
              run(
                new Proxy(tx, {
                  get(t, key, r) {
                    if (key === "execute")
                      return async (
                        query: Parameters<DatabaseTransaction["execute"]>[0],
                      ) => {
                        const result = await t.execute(query);
                        await afterQuery?.(
                          typeof query === "string"
                            ? query
                            : dialect.sqlToQuery(query.getSQL()).sql,
                          t,
                        );
                        return result;
                      };
                    return Reflect.get(t, key, r);
                  },
                }),
              ),
            options,
          );
      return Reflect.get(target, property, receiver);
    },
  });
  const coordinator = createSandboxCoordinator({
    db: guardedDb,
    runtime: () => f.runtime,
    env: () => saved,
    gateway: f.gateway,
  });
  const before = process.env.NODE_ENV;
  try {
    Reflect.set(process.env, "NODE_ENV", "production");
    const error = await rejectionOf(
      coordinator.store.enqueue("alice", {
        id: crypto.randomUUID(),
        source: { artifactId: f.source, version: 1 },
      }),
    );
    expect(error.id).toBe("sandbox_adapter_offline_only");
  } finally {
    Reflect.set(process.env, "NODE_ENV", before);
  }
});

test("review: raw gateway client cannot send requests after leaving test mode", async () => {
  const f = get();
  const before = process.env.NODE_ENV;
  try {
    Reflect.set(process.env, "NODE_ENV", "production");
    const error = await rejectionOf(f.gateway.status("synthetic-handle"));
    expect(error.id).toBe("sandbox_adapter_offline_only");
    expect(f.gatewayFixture.counters.status).toBe(0);
  } finally {
    Reflect.set(process.env, "NODE_ENV", before);
  }
});

test("review: caller-shaped receipts cannot authenticate zero-cost settlement", async () => {
  const w = await runToCompletion();
  const op = (await operations(w))[0];
  const [identity] = await w.db.execute<{
    binding_digest: string;
    revision: number;
  }>(
    sql`SELECT binding_digest,revision FROM sandbox_operation WHERE id=${op.id}`,
  );
  const id = crypto.randomUUID();
  await w.db.execute(
    sql`INSERT INTO sandbox_receipt(id,operation_id,receipt) VALUES(${id},${op.id},${JSON.stringify({ id, operationId: op.id, bindingDigest: identity.binding_digest, evidenceDigest: "f".repeat(64), incurredMicrodollars: 0, terminal: true, revision: "fake-self-asserted" })}::jsonb)`,
  );
  const error = await rejectionOf(
    w.store.reconcile(op.id, identity.binding_digest, id, identity.revision),
  );
  expect(error.id).toBe("sandbox_receipt_authority_unavailable");
  expect((await operations(w))[0].state).toBe("completed_unreconciled");
});

test("review: final entry rechecks the original lease after the last journal write", async () => {
  const w = await runToApproval();
  await w.store.approve("alice", w.approval);
  let crossed = false;
  w.afterQuery(async (statement, tx) => {
    if (crossed || !statement.includes("INSERT INTO sandbox_operation_audit"))
      return;
    const [op] = await tx.execute<{ state: string }>(
      sql`SELECT state FROM sandbox_operation LIMIT 1`,
    );
    if (op?.state !== "entered") return;
    crossed = true;
    await tx.execute(
      sql`UPDATE durable_job SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE id=${w.id}`,
    );
  });
  expect((await rejectionOf(worker(w).deliver(w.id))).id).toBe(
    "job_stale_lease",
  );
  w.afterQuery(undefined);
  expect(crossed).toBe(true);
  expect(await operations(w)).toHaveLength(0);
  expect(w.gatewayFixture.counters.create).toBe(0);
  const [count] = await w.db.execute<{ n: number }>(
    sql`SELECT count(*)::integer AS n FROM sandbox_operation_commitment`,
  );
  expect(count.n).toBe(0);
});

test("review: final publication policy drift rolls back report, message and result evidence", async () => {
  const w = await runToApproval();
  await w.store.approve("alice", w.approval);
  const previous = process.env.SANDBOX_IMAGE_DIGEST;
  let crossed = false;
  w.afterQuery(async (statement, tx) => {
    if (crossed || !statement.includes("INSERT INTO sandbox_operation_audit"))
      return;
    const [op] = await tx.execute<{ state: string }>(
      sql`SELECT state FROM sandbox_operation LIMIT 1`,
    );
    if (op?.state !== "completed_unreconciled") return;
    crossed = true;
    process.env.SANDBOX_IMAGE_DIGEST = "f".repeat(64);
  });
  try {
    expect((await rejectionOf(worker(w).deliver(w.id))).id).toBe(
      "sandbox_binding_changed",
    );
  } finally {
    w.afterQuery(undefined);
    process.env.SANDBOX_IMAGE_DIGEST = previous;
  }
  expect(crossed).toBe(true);
  const [reports] = await w.db.execute<{ n: number }>(
    sql`SELECT count(*)::integer AS n FROM artifact WHERE user_id='alice'`,
  );
  const [messages] = await w.db.execute<{ n: number }>(
    sql`SELECT count(*)::integer AS n FROM chat_message WHERE user_id='alice'`,
  );
  const [results] = await w.db.execute<{ n: number }>(
    sql`SELECT count(*)::integer AS n FROM sandbox_operation_evidence WHERE evidence->>'kind'='result'`,
  );
  expect(reports.n).toBe(1);
  expect(messages.n).toBe(1);
  expect(results.n).toBe(0);
  expect((await operations(w))[0].state).toBe("held");
  expect(w.gatewayFixture.counters.create).toBe(1);
  expect(w.gatewayFixture.counters.terminate).toBe(1);
});

test("review: owner deletion after create retains an anonymous orphan and cleans the exact observed handle", async () => {
  const w = await runToApproval();
  await w.store.approve("alice", w.approval);
  w.gatewayFixture.hooks.created = async () => {
    await w.db.execute(sql`DELETE FROM "user" WHERE id='alice'`);
  };
  expect((await rejectionOf(worker(w).deliver(w.id))).id).toBe("not_found");
  const ops = await operations(w);
  expect(ops).toHaveLength(1);
  expect(ops[0].state).toBe("held");
  expect(Number(ops[0].reserved_microdollars)).toBe(500_000);
  const [mapping] = await w.db.execute<{ n: number }>(
    sql`SELECT count(*)::integer AS n FROM sandbox_operation_owner`,
  );
  const [control] = await w.db.execute<{ stopped: boolean }>(
    sql`SELECT stopped FROM funding_control WHERE id='platform'`,
  );
  expect(mapping.n).toBe(0);
  expect(control.stopped).toBe(true);
  expect(w.gatewayFixture.counters.create).toBe(1);
  expect(w.gatewayFixture.counters.terminate).toBe(1);
});

test("review: historical released commitments survive three months and block missing carry", async () => {
  const f = get();
  const now = new Date();
  const month = now.toISOString().slice(0, 7);
  const prev = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1),
  )
    .toISOString()
    .slice(0, 7);
  const oldest = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 2, 1),
  )
    .toISOString()
    .slice(0, 7);
  const id = crypto.randomUUID();
  await f.db.execute(sql`INSERT INTO sandbox_operation(id,actor_key,actor_version,idempotency_key,binding_digest,identity,fee_snapshot,month,day,state,reserved_microdollars,deadline)
    VALUES(${id},${"a".repeat(64)},'v1',${id},${"b".repeat(64)},'{}'::jsonb,'{}'::jsonb,${oldest},CURRENT_DATE,'reserved',500000,clock_timestamp()+interval '1 minute')`);
  for (const [period, amount] of [
    [oldest, 500_000],
    [prev, 700_000],
  ] as const) {
    await f.db.execute(
      sql`INSERT INTO sandbox_period(month,plan_identity,sources_digest,ordinary_infra_microdollars) VALUES(${period},'{}'::jsonb,${"f".repeat(64)},500000)`,
    );
    await f.db.execute(
      sql`INSERT INTO sandbox_operation_commitment(month,source_id,amount_microdollars) VALUES(${period},${id},${amount})`,
    );
  }
  await f.db.execute(
    sql`UPDATE sandbox_operation SET state='released',revision=revision+1 WHERE id=${id}`,
  );
  const config = resolvePlatformBudgetConfig(process.env, now);
  const plan = {
    month,
    revision: config.plan.revision,
    digest: config.digest,
    capacityDigest: config.capacityDigest,
  };
  const budget = new PlatformBudgetStore(f.db);
  expect(
    (
      await rejectionOf(
        budget.assertActivePlan({
          month: plan.month,
          expectedRevision: plan.revision,
          expectedDigest: plan.digest,
          expectedCapacityDigest: plan.capacityDigest,
        }),
      )
    ).id,
  ).toBe("uncovered_sandbox_exposure");
  await f.store.bootstrapPeriod(plan, 500_000);
  const [carry] = await f.db.execute<{ amount: string }>(
    sql`SELECT amount_microdollars::text AS amount FROM sandbox_operation_commitment WHERE month=${month} AND source_id=${id}`,
  );
  expect(Number(carry.amount)).toBe(700_000);
  await budget.assertActivePlan({
    month: plan.month,
    expectedRevision: plan.revision,
    expectedDigest: plan.digest,
    expectedCapacityDigest: plan.capacityDigest,
  });
  expect((await rejectionOf(f.store.bootstrapPeriod(plan, 400_000))).id).toBe(
    "sandbox_period_conflict",
  );
});

test("review: gateway identity and credential changes deny before entry", async () => {
  const w = await runToApproval();
  await w.store.approve("alice", w.approval);
  w.runtime.gateway.key = "replacement-key-0123456789abcdef0123456789abcdef";
  expect((await rejectionOf(worker(w).deliver(w.id))).id).toBe(
    "sandbox_gateway_unconfigured",
  );
  expect(w.gatewayFixture.counters.create).toBe(0);
  expect(await operations(w)).toHaveLength(0);
});

test("review: recovery cannot renew the persisted command deadline", async () => {
  const w = await runToApproval();
  await w.store.approve("alice", w.approval);
  const lease = await w.jobs.claim(w.id);
  if (!lease) throw new Error("missing_lease");
  await w.store.dispatch(lease, w.gateway, { stopAfterCreate: true });
  const [op] = await w.db.execute<{ deadline: Date }>(
    sql`SELECT deadline FROM sandbox_operation`,
  );
  await w.db.execute(
    sql`UPDATE durable_job SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE id=${w.id}`,
  );
  const next = await w.jobs.claim(w.id);
  if (!next) throw new Error("missing_recovery");
  const clock = spyOn(Date, "now").mockReturnValue(
    new Date(op.deadline).getTime() + 1,
  );
  try {
    await w.store.dispatch(next, w.gateway);
  } finally {
    clock.mockRestore();
  }
  expect(w.gatewayFixture.counters.create).toBe(1);
  expect(w.gatewayFixture.counters.status).toBe(0);
  expect(w.gatewayFixture.counters.terminate).toBe(1);
  expect((await operations(w))[0].state).toBe("held");
});

test("review: account export includes only sanitized sandbox metadata without runtime configuration", async () => {
  const w = await runToCompletion();
  const { exportOwnedAccount } = await import("../lib/actions/account/account");
  const saved = process.env.NODE_ENV;
  Reflect.set(process.env, "NODE_ENV", "production");
  try {
    const exported = await exportOwnedAccount("alice");
    expect(exported.sandboxOperations).toHaveLength(1);
    expect(Object.keys(exported.sandboxOperations[0]).sort()).toEqual([
      "createdAt",
      "id",
      "incurredMicrodollars",
      "reservedMicrodollars",
      "revision",
      "state",
    ]);
    expect(JSON.stringify(exported.sandboxOperations)).not.toContain(
      w.gatewayFixture.key,
    );
    expect(JSON.stringify(exported.sandboxOperations)).not.toContain(
      (await operations(w))[0].provider_handle ?? "missing",
    );
  } finally {
    Reflect.set(process.env, "NODE_ENV", saved);
  }
});

test("review: missing or production action handlers cannot fall through to the fixture publisher", async () => {
  const w = await runToApproval();
  await w.store.approve("alice", w.approval);
  const lease = await w.jobs.claim(w.id);
  if (!lease) throw new Error("missing_lease");
  const saved = process.env.NODE_ENV;
  Reflect.set(process.env, "NODE_ENV", "production");
  try {
    expect((await rejectionOf(w.jobs.checkpoint(lease))).id).toBe(
      "job_action_unavailable",
    );
    expect(
      (
        await rejectionOf(
          Promise.resolve().then(() =>
            registerJobActionHandler(
              "publish-fixture-report-v1",
              async () => {},
            ),
          ),
        )
      ).id,
    ).toBe("job_action_unavailable");
  } finally {
    Reflect.set(process.env, "NODE_ENV", saved);
  }
  expect(w.gatewayFixture.counters.create).toBe(0);
  expect(await operations(w)).toHaveLength(0);
});

test("review: anonymous retention recovery needs neither deleted owner nor usable runtime", async () => {
  const w = await runToCompletion();
  const op = (await operations(w))[0];
  await w.db.execute(sql`DELETE FROM "user" WHERE id='alice'`);
  const { SandboxStore } = await import("../lib/sandbox/store");
  const store = new SandboxStore(w.db);
  const kept = await store.retainUncertainOperation(op.id);
  expect(kept.state).toBe("held");
  expect(kept.reservedMicrodollars).toBe(500_000);
  expect((await store.retainUncertainOperation(op.id)).revision).toBe(
    kept.revision,
  );
  const [control] = await w.db.execute<{ stopped: boolean }>(
    sql`SELECT stopped FROM funding_control WHERE id='platform'`,
  );
  expect(control.stopped).toBe(true);
  expect(w.gatewayFixture.counters.create).toBe(1);
});

test("review: failed commands retain resource capacity and request exact-handle cleanup", async () => {
  const f = get();
  f.gatewayFixture.script.status = "failed";
  const w = await runToApproval();
  await w.store.approve("alice", w.approval);
  await worker(w).deliver(w.id);
  expect((await operations(w))[0].state).toBe("held");
  expect(w.gatewayFixture.counters.create).toBe(1);
  expect(w.gatewayFixture.counters.terminate).toBe(1);
  const [control] = await w.db.execute<{ stopped: boolean }>(
    sql`SELECT stopped FROM funding_control WHERE id='platform'`,
  );
  expect(control.stopped).toBe(true);
});
