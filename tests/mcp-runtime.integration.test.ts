import { expect, test } from "bun:test";
import { sql } from "drizzle-orm";
import { mcpRuntimeFixture } from "./helpers/mcp-runtime-fixture";
import { rejectionOf } from "./helpers/rejection";
import { setupFixtureBeforeEach } from "./helpers/setup-fixture";

const get = setupFixtureBeforeEach(mcpRuntimeFixture);
test("production runtime requires three exact approvals and funds three real broker frames without billing inference", async () => {
  const f = get(),
    execution = await f.prepare();
  await f.runtime.bootstrapMcpPeriod(f.planIdentity);
  expect(
    await rejectionOf(f.runtime.executeRuntime("alice", execution.id)),
  ).toMatchObject({ id: "tool_approval_denied" });
  expect(f.requests).toBe(0);
  for (const frame of execution.frames)
    await f.runtime.decideRuntimeApproval("alice", frame.approvalId, "approve");
  const result = await f.runtime.executeRuntime("alice", execution.id);
  expect(result.state).toBe("completed_unreconciled");
  expect(f.sends).toBe(3);
  expect(f.messages.map((m) => m.method)).toEqual([
    "initialize",
    "notifications/initialized",
    "tools/call",
  ]);
  const rows = await f.db.execute<{
    state: string;
    reserved_microdollars: string;
    incurred_microdollars: string;
  }>(
    sql`SELECT state,reserved_microdollars::text,incurred_microdollars::text FROM mcp_operation ORDER BY created_at`,
  );
  expect(rows).toHaveLength(3);
  for (const r of rows)
    expect(r).toEqual({
      state: "completed_unreconciled",
      reserved_microdollars: "1000",
      incurred_microdollars: "0",
    });
  const [counts] = await f.db.execute<{
    approvals: number;
    consumed: number;
    calls: number;
    evidence: number;
  }>(
    sql`SELECT (SELECT count(*)::integer FROM tool_approval) AS approvals,(SELECT count(*)::integer FROM tool_approval WHERE state='consumed') AS consumed,(SELECT count(*)::integer FROM tool_call) AS calls,(SELECT count(*)::integer FROM mcp_runtime_evidence) AS evidence`,
  );
  expect(counts).toEqual({ approvals: 3, consumed: 3, calls: 3, evidence: 3 });
  const replay = await f.runtime.executeRuntime("alice", execution.id);
  expect(replay).toEqual({
    executionId: execution.id,
    state: "completed_unreconciled",
    result: null,
  });
  expect(f.requests).toBe(3);
});
test("missing configuration fails production admission with no transport or rows", async () => {
  const f = get();
  delete process.env.MCP_RUNTIME_ENABLED;
  expect(await rejectionOf(f.adopt())).toMatchObject({
    id: "mcp_runtime_unconfigured",
  });
  expect(f.requests).toBe(0);
  const [r] = await f.db.execute<{ count: number }>(
    sql`SELECT count(*)::integer AS count FROM mcp_runtime_adoption`,
  );
  expect(r.count).toBe(0);
});

async function approved(f: ReturnType<typeof get>) {
  const e = await f.prepare();
  await f.runtime.bootstrapMcpPeriod(f.planIdentity);
  for (const row of e.frames)
    await f.runtime.decideRuntimeApproval("alice", row.approvalId, "approve");
  return e;
}
for (const behavior of ["notify204", "success"]) {
  test(`bounded synchronous notification ${behavior} makes exactly three funded outbound frames`, async () => {
    const f = get();
    f.setBehavior(behavior);
    const e = await approved(f);
    await f.runtime.executeRuntime("alice", e.id);
    expect(f.requests).toBe(3);
    const [r] = await f.db.execute<{ sum: string; stopped: boolean }>(
      sql`SELECT (SELECT sum(amount_microdollars)::text FROM mcp_operation_commitment) AS sum,(SELECT stopped FROM funding_control WHERE id='platform') AS stopped`,
    );
    expect(r).toEqual({ sum: "3000", stopped: false });
  });
}
for (const behavior of [
  "tamper",
  "wrong-id",
  "malformed",
  "sse",
  "session",
  "ping",
  "task",
]) {
  test(`unsupported ${behavior} holds the entered full reservation, globally stops and never retries`, async () => {
    const f = get(),
      e = await approved(f);
    f.setBehavior(behavior);
    expect(
      await rejectionOf(f.runtime.executeRuntime("alice", e.id)),
    ).toMatchObject({ id: "mcp_runtime_outcome_unknown" });
    const expectedRequests = behavior === "task" ? 3 : 1;
    expect(f.requests).toBe(expectedRequests);
    const [r] = await f.db.execute<{
      state: string;
      amount: string;
      stopped: boolean;
      consumed: number;
    }>(
      sql`SELECT state,reserved_microdollars::text AS amount,(SELECT stopped FROM funding_control WHERE id='platform') AS stopped,(SELECT count(*)::integer FROM tool_approval WHERE state='consumed') AS consumed FROM mcp_operation WHERE state='held'`,
    );
    expect(r).toEqual({
      state: "held",
      amount: "1000",
      stopped: true,
      consumed: expectedRequests,
    });
    expect(
      await rejectionOf(f.runtime.executeRuntime("alice", e.id)),
    ).toMatchObject({ id: "mcp_execution_already_entered" });
    expect(f.requests).toBe(expectedRequests);
  });
}
test("abort after entry retains uncertainty and no retry even when upstream has not completed", async () => {
  const f = get(),
    e = await approved(f);
  f.setBehavior("hang");
  const controller = new AbortController();
  const promise = f.runtime.executeRuntime("alice", e.id, controller.signal);
  f.beforeBroker(() => controller.abort());
  expect(await rejectionOf(promise)).toMatchObject({
    id: "mcp_runtime_outcome_unknown",
  });

  const [row] = await f.db.execute<{ state: string; attempts: number }>(
    sql`SELECT state,attempts FROM mcp_operation`,
  );
  expect(row).toEqual({ state: "held", attempts: 1 });
  expect(f.requests).toBe(1);
});
test("abort before entry changes neither approval nor funding and performs no request", async () => {
  const f = get(),
    e = await approved(f),
    controller = new AbortController();
  controller.abort();
  expect(
    await rejectionOf(
      f.runtime.executeRuntime("alice", e.id, controller.signal),
    ),
  ).toMatchObject({ id: "mcp_cancelled" });
  const [row] = await f.db.execute<{ operations: number; consumed: number }>(
    sql`SELECT (SELECT count(*)::integer FROM mcp_operation) AS operations,(SELECT count(*)::integer FROM tool_approval WHERE state='consumed') AS consumed`,
  );
  expect(row).toEqual({ operations: 0, consumed: 0 });
  expect(f.requests).toBe(0);
});
test("parallel calls cannot consume one approval or dispatch a frame twice", async () => {
  const f = get(),
    e = await approved(f);
  const results = await Promise.allSettled([
    f.runtime.executeRuntime("alice", e.id),
    f.runtime.executeRuntime("alice", e.id),
  ]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(f.requests).toBe(3);
  const [r] = await f.db.execute<{ count: number }>(
    sql`SELECT count(*)::integer AS count FROM mcp_operation`,
  );
  expect(r.count).toBe(3);
});
test("foreign execution and missing execution are indistinguishable and send nothing", async () => {
  const f = get(),
    e = await approved(f);
  for (const id of [e.id, crypto.randomUUID()])
    expect(
      await rejectionOf(f.runtime.executeRuntime("bob", id)),
    ).toMatchObject({ id: "not_found", status: 404 });
  expect(f.requests).toBe(0);
});
test("call connection cannot be substituted for explicit initialize consent", async () => {
  const f = get();
  expect(
    await rejectionOf(
      f.runtime.adoptRuntimeManifest("alice", {
        id: crypto.randomUUID(),
        manifestDigest: f.config.digest,
        initializeConnection: f.connections.call,
        callConnection: f.connections.call,
      }),
    ),
  ).toMatchObject({ id: "mcp_execution_changed" });
  const [r] = await f.db.execute<{ count: number }>(
    sql`SELECT count(*)::integer AS count FROM mcp_runtime_adoption`,
  );
  expect(r.count).toBe(0);
});
test("a fourth existing tool call leaves insufficient budget for setup; no hidden extra call slots", async () => {
  const f = get(),
    a = await f.adopt(),
    run = await f.run();
  for (let i = 0; i < 2; i++)
    await f.tools.event("alice", run.id, {
      id: crypto.randomUUID(),
      name: "existing",
      state: "queued",
    });
  expect(
    await rejectionOf(
      f.runtime.prepareRuntimeExecution("alice", {
        id: crypto.randomUUID(),
        runId: run.id,
        toolCallId: run.callId,
        adoptionId: a.id,
        arguments: { message: "test" },
      }),
    ),
  ).toMatchObject({ id: "tool_call_limit" });
  const [r] = await f.db.execute<{ approvals: number; frames: number }>(
    sql`SELECT (SELECT count(*)::integer FROM tool_approval) AS approvals,(SELECT count(*)::integer FROM mcp_runtime_frame) AS frames`,
  );
  expect(r).toEqual({ approvals: 0, frames: 0 });
});
for (const change of [
  "model",
  "price",
  "invite",
  "manifest",
  "profile",
  "kill",
  "clock",
]) {
  test(`late ${change} drift after actual entry writes rolls back entry and approval consumption`, async () => {
    const f = get(),
      e = await approved(f);
    let written = false,
      changed = false;
    f.afterQuery((statement, result) => {
      if (statement.includes("UPDATE mcp_operation SET state='entered'"))
        written = true;
      if (
        !written ||
        changed ||
        !statement.includes("a.manifest_digest,a.binding")
      )
        return;
      changed = true;
      if (change === "model" || change === "price") {
        const models = JSON.parse(process.env.TOOL_MODELS_JSON ?? "[]");
        models[0][
          change === "model" ? "model" : "inputMicrodollarsPerMillion"
        ] = change === "model" ? "changed/model" : 2000;
        process.env.TOOL_MODELS_JSON = JSON.stringify(models);
      }
      if (change === "invite") process.env.GITHUB_INVITE_LOGINS = "bob";
      if (change === "manifest") {
        const c = JSON.parse(process.env.MCP_RUNTIME_CONFIG_JSON ?? "{}");
        c.manifest.revision = "changed";
        process.env.MCP_RUNTIME_CONFIG_JSON = JSON.stringify(c);
      }
      if (change === "profile") process.env.MCP_CLIENT_ENABLED = "0";
      if (change === "kill") process.env.FUNDED_KILL_SWITCH = "1";
      if (change === "clock" && Array.isArray(result))
        for (const row of result)
          if (row && typeof row === "object" && "now" in row)
            Reflect.set(row, "now", new Date(Date.now() + 60000));
    });
    expect(
      await rejectionOf(f.runtime.executeRuntime("alice", e.id)),
    ).toBeDefined();
    f.afterQuery(undefined);
    expect(changed).toBe(true);
    const [r] = await f.db.execute<{
      operations: number;
      consumed: number;
      entered: number;
    }>(
      sql`SELECT (SELECT count(*)::integer FROM mcp_operation) AS operations,(SELECT count(*)::integer FROM tool_approval WHERE state='consumed') AS consumed,(SELECT count(*)::integer FROM mcp_runtime_frame WHERE state='entered') AS entered`,
    );
    expect(r).toEqual({ operations: 0, consumed: 0, entered: 0 });
    expect(f.requests).toBe(0);
  });
}
test("expired original run cannot reset its 20s deadline during initialization", async () => {
  const f = get(),
    e = await approved(f);
  await f.db.execute(
    sql`UPDATE tool_run SET created_at=clock_timestamp()-interval '1 minute'`,
  );
  expect(
    await rejectionOf(f.runtime.executeRuntime("alice", e.id)),
  ).toMatchObject({ id: "mcp_tool_run_unavailable" });
  expect(f.requests).toBe(0);
});
test("account deletion removes owned execution metadata while retaining full completed liabilities and signed evidence", async () => {
  const f = get(),
    e = await approved(f);
  await f.runtime.executeRuntime("alice", e.id);
  const before = await f.db.execute(
    sql`SELECT id,state,reserved_microdollars,incurred_microdollars FROM mcp_operation ORDER BY id`,
  );
  const { deleteOwnedAccount } = await import("@/lib/actions/account/account");
  await deleteOwnedAccount("alice");
  expect(
    await f.db.execute(
      sql`SELECT id,state,reserved_microdollars,incurred_microdollars FROM mcp_operation ORDER BY id`,
    ),
  ).toEqual(before);
  const [r] = await f.db.execute<{
    frames: number;
    evidence: number;
    commitment: string;
  }>(
    sql`SELECT (SELECT count(*)::integer FROM mcp_runtime_frame) AS frames,(SELECT count(*)::integer FROM mcp_runtime_evidence) AS evidence,(SELECT sum(amount_microdollars)::text FROM mcp_operation_commitment) AS commitment`,
  );
  expect(r).toEqual({ frames: 0, evidence: 3, commitment: "3000" });
});
test("SQL preserves immutable frame bindings, evidence, stable actors and completed financial liabilities", async () => {
  const f = get(),
    e = await approved(f);
  await f.runtime.executeRuntime("alice", e.id);
  for (const statement of [
    "UPDATE mcp_runtime_frame SET body='{}'::jsonb,revision=revision+1",
    "UPDATE mcp_runtime_adoption SET manifest_digest=repeat('0',64)",
    "DELETE FROM mcp_runtime_evidence",
    "DELETE FROM mcp_runtime_principal",
    "DELETE FROM mcp_operation",
    "UPDATE mcp_operation SET state='released',revision=revision+1",
  ]) {
    const error = await rejectionOf(f.db.$client.unsafe(statement).simple());
    expect(error).toMatchObject({ code: "P0001" });
  }
  expect(f.requests).toBe(3);
});
for (const change of ["manifest", "invite", "disabled"]) {
  test(`late ${change} drift after terminal-evidence insert rolls back completion and retains unknown without new admission config`, async () => {
    const f = get(),
      e = await approved(f);
    let changed = false;
    f.afterQuery((statement) => {
      if (changed || !statement.includes("INSERT INTO mcp_runtime_evidence"))
        return;
      changed = true;
      if (change === "manifest") {
        const config = JSON.parse(process.env.MCP_RUNTIME_CONFIG_JSON ?? "{}");
        config.manifest.revision = "late-drift";
        process.env.MCP_RUNTIME_CONFIG_JSON = JSON.stringify(config);
      }
      if (change === "invite") process.env.GITHUB_INVITE_LOGINS = "bob";
      if (change === "disabled") delete process.env.MCP_RUNTIME_ENABLED;
    });
    expect(
      await rejectionOf(f.runtime.executeRuntime("alice", e.id)),
    ).toMatchObject({ id: "mcp_runtime_outcome_unknown" });
    f.afterQuery(undefined);
    expect(changed).toBe(true);
    const [r] = await f.db.execute<{
      state: string;
      evidence: number;
      commitment: string;
      stopped: boolean;
    }>(
      sql`SELECT state,(SELECT count(*)::integer FROM mcp_runtime_evidence) AS evidence,(SELECT sum(amount_microdollars)::text FROM mcp_operation_commitment) AS commitment,(SELECT stopped FROM funding_control WHERE id='platform') AS stopped FROM mcp_operation`,
    );
    expect(r).toEqual({
      state: "held",
      evidence: 0,
      commitment: "1000",
      stopped: true,
    });
    expect((await f.runtime.status("alice", e.id))[0].state).toBe("held");
    expect(f.requests).toBe(1);
  });
}
test("committed entry followed by transport failure is held even with zero upstream requests", async () => {
  const f = get(),
    e = await approved(f);
  f.setBehavior("transport-failure");
  expect(
    await rejectionOf(f.runtime.executeRuntime("alice", e.id)),
  ).toMatchObject({ id: "mcp_runtime_outcome_unknown" });
  expect(f.requests).toBe(1);
  expect(f.sends).toBe(0);
  const [r] = await f.db.execute<{ state: string; attempts: number }>(
    sql`SELECT state,attempts FROM mcp_operation`,
  );
  expect(r).toEqual({ state: "held", attempts: 1 });
});
test("stable financial principal retains prior records after new user id and actor-key rotation", async () => {
  const f = get(),
    e = await approved(f);
  await f.runtime.executeRuntime("alice", e.id);
  const before = await f.db.execute<{ id: string; actor_key: string }>(
    sql`SELECT id,actor_key FROM mcp_operation ORDER BY id`,
  );
  const { deleteOwnedAccount } = await import("@/lib/actions/account/account");
  await deleteOwnedAccount("alice");
  await f.db.execute(
    sql`INSERT INTO "user"(id,name,email,email_verified,github_login) VALUES('alice-rejoined','Rejoined','rejoined@example.invalid',true,'alice')`,
  );
  await f.db.execute(
    sql`INSERT INTO account(id,user_id,provider_id,account_id)VALUES(${crypto.randomUUID()},'alice-rejoined','github','10001')`,
  );
  const raw = JSON.parse(JSON.stringify(f.rawConfig));
  raw.manifest.revision = "rejoined";
  raw.activeActorKey = "v2";
  raw.actorKeys.v2 = "synthetic-rotated-resource-key-at-least-32";
  const { operationDigest } = await import("@/lib/mcp/operation-contract");
  for (const kind of ["initialize", "initialized", "call"]) {
    raw.manifest.fees[kind].capacity.ownerRecords = 3;
    raw.manifest.fees[kind].capacityDigest = operationDigest(
      raw.manifest.fees[kind].capacity,
    );
  }
  process.env.MCP_RUNTIME_CONFIG_JSON = JSON.stringify(raw);
  const { resolveRuntimeConfig, appProfile } = await import(
      "@/lib/mcp/runtime-config"
    ),
    { computeProfileDigest } = await import("@/lib/mcp/registry-contract");
  const c = resolveRuntimeConfig(process.env, new Date()),
    connections = {
      initialize: { id: crypto.randomUUID(), revision: crypto.randomUUID() },
      call: { id: crypto.randomUUID(), revision: crypto.randomUUID() },
    };
  for (const kind of ["initialize", "call"] as const) {
    const p = c.manifest.profiles[kind],
      connection = connections[kind];
    await f.db.execute(
      sql`INSERT INTO mcp_connection(id,user_id,profile_id,profile_revision,purpose,profile_digest,label,state,revision)VALUES(${connection.id},'alice-rejoined',${p.profileId},${p.revision},${p.purpose},${computeProfileDigest(appProfile(p, c.manifest.expiresAt))},'Rejoined','configured',${connection.revision})`,
    );
  }
  const adoption = await f.runtime.adoptRuntimeManifest("alice-rejoined", {
      id: crypto.randomUUID(),
      manifestDigest: c.digest,
      initializeConnection: connections.initialize,
      callConnection: connections.call,
    }),
    run = await f.run("alice-rejoined"),
    next = await f.runtime.prepareRuntimeExecution("alice-rejoined", {
      id: crypto.randomUUID(),
      runId: run.id,
      toolCallId: run.callId,
      adoptionId: adoption.id,
      arguments: { message: "synthetic" },
    });
  for (const frame of next.frames)
    await f.runtime.decideRuntimeApproval(
      "alice-rejoined",
      frame.approvalId,
      "approve",
    );
  expect(
    await rejectionOf(f.runtime.executeRuntime("alice-rejoined", next.id)),
  ).toMatchObject({ id: "mcp_operation_limit" });
  expect(f.requests).toBe(3);
  expect(
    await f.db.execute(sql`SELECT id,actor_key FROM mcp_operation ORDER BY id`),
  ).toEqual(before);
  const principal = await f.db.execute<{
    actor_key: string;
    actor_version: string;
  }>(sql`SELECT actor_key,actor_version FROM mcp_runtime_principal`);
  expect([...principal]).toEqual([
    { actor_key: before[0].actor_key, actor_version: "v1" },
  ]);
});
test("complete reviewed configuration executes the actual production service under NODE_ENV production", async () => {
  const f = get(),
    e = await approved(f);
  const prior = process.env.NODE_ENV;
  try {
    Reflect.set(process.env, "NODE_ENV", "production");
    expect((await f.runtime.executeRuntime("alice", e.id)).state).toBe(
      "completed_unreconciled",
    );
    expect(f.requests).toBe(3);
  } finally {
    if (prior === undefined) Reflect.deleteProperty(process.env, "NODE_ENV");
    else Reflect.set(process.env, "NODE_ENV", prior);
  }
});
test("wire signing-key drift after actual entry writes rolls back rather than using a stale signing closure", async () => {
  const f = get(),
    e = await approved(f);
  let changed = false;
  f.afterQuery((statement) => {
    if (
      !changed &&
      statement.includes("UPDATE mcp_operation SET state='entered'")
    ) {
      changed = true;
      process.env.MCP_CLIENT_HMAC_KEY = Buffer.alloc(32, 9).toString("base64");
    }
  });
  expect(
    await rejectionOf(f.runtime.executeRuntime("alice", e.id)),
  ).toMatchObject({ id: "mcp_runtime_unconfigured" });
  f.afterQuery(undefined);
  const [r] = await f.db.execute<{ operations: number; consumed: number }>(
    sql`SELECT (SELECT count(*)::integer FROM mcp_operation) AS operations,(SELECT count(*)::integer FROM tool_approval WHERE state='consumed') AS consumed`,
  );
  expect(r).toEqual({ operations: 0, consumed: 0 });
  expect(changed).toBe(true);
  expect(f.requests).toBe(0);
});
test("new-month production period bootstrap derives and retains full terminal-transport carry without client source amounts", async () => {
  const f = get(),
    e = await approved(f);
  await f.runtime.executeRuntime("alice", e.id);
  const before = await f.db.execute<{
    id: string;
    state: string;
    reserved_microdollars: string;
    incurred_microdollars: string;
  }>(
    sql`SELECT id,state,reserved_microdollars,incurred_microdollars FROM mcp_operation ORDER BY id`,
  );
  const future = new Date();
  future.setUTCMonth(future.getUTCMonth() + 1, 2);
  const { createReviewedBudgetPlan, registerReviewedBudgetPlan } = await import(
      "./helpers/platform-budget-fixture"
    ),
    { resolvePlatformBudgetConfig } = await import("@/lib/funding/config");
  const plan = createReviewedBudgetPlan(
    {
      month: future.toISOString().slice(0, 7),
      aMcp: 100000,
      bSelected: 10000000,
      lCarried: 3000,
    },
    process.env,
    future,
  );
  process.env.PLATFORM_BUDGET_PLAN_JSON = JSON.stringify(plan);
  f.afterQuery((_sql, result) => {
    if (Array.isArray(result))
      for (const row of result)
        if (row && typeof row === "object" && "now" in row)
          Reflect.set(row, "now", new Date(future));
  });
  await registerReviewedBudgetPlan(f.db, plan, process.env, future);
  const c = resolvePlatformBudgetConfig(process.env, future);
  if (!c) throw new Error("fixture_future_plan_missing");
  const identity = {
    month: plan.month,
    revision: plan.revision,
    digest: c.digest,
    capacityDigest: c.capacityDigest,
  };
  await f.runtime.bootstrapMcpPeriod(identity);
  f.afterQuery(undefined);
  const rows = await f.db.execute<{
    source_id: string;
    amount_microdollars: string;
  }>(
    sql`SELECT source_id,amount_microdollars::text FROM mcp_operation_commitment WHERE month=${plan.month} ORDER BY source_id`,
  );
  expect([...rows]).toEqual(
    before.map((r) => ({ source_id: r.id, amount_microdollars: "1000" })),
  );
  expect(
    await f.db.execute(
      sql`SELECT id,state,reserved_microdollars,incurred_microdollars FROM mcp_operation ORDER BY id`,
    ),
  ).toEqual(before);
  expect(f.requests).toBe(3);
});
test("recovery of a committed entry after worker loss requires no new configuration and cannot redispatch", async () => {
  const f = get(),
    e = await approved(f);
  const { lockFunding } = await import("@/lib/funding/store"),
    { lockByokResources } = await import("@/lib/byok/store"),
    { createProductionMcpOperationStore } = await import(
      "@/lib/mcp/operation-store"
    ),
    { runtimeFrameInTx } = await import("@/lib/mcp/execution-store");
  await f.db.transaction(
    async (tx) => {
      await lockFunding(tx);
      await lockByokResources(tx);
      const frame = await runtimeFrameInTx(tx, "alice", e.frames[0].id),
        store = createProductionMcpOperationStore(f.db, "initialize"),
        r = await store.reserveMcpOperationInTx(tx, "alice", frame.intent);
      await store.enterMcpExecutionInTx(tx, "alice", r.id, r.revision);
    },
    { isolationLevel: "read committed" },
  );
  expect(f.requests).toBe(0);
  delete process.env.MCP_RUNTIME_ENABLED;
  expect(await f.runtime.retainUnknown("alice", e.frames[0].id, 2)).toEqual({
    frameId: e.frames[0].id,
    state: "held",
  });
  expect(
    await rejectionOf(f.runtime.executeRuntime("alice", e.id)),
  ).toMatchObject({ id: "mcp_execution_already_entered" });
  const [r] = await f.db.execute<{
    state: string;
    amount: string;
    stopped: boolean;
  }>(
    sql`SELECT state,reserved_microdollars::text AS amount,(SELECT stopped FROM funding_control WHERE id='platform') AS stopped FROM mcp_operation`,
  );
  expect(r).toEqual({ state: "held", amount: "1000", stopped: true });
  expect(f.requests).toBe(0);
});
test("adoption denies missing and ambiguous trusted GitHub principals without metadata writes", async () => {
  const f = get();
  await f.db.execute(sql`DELETE FROM account WHERE user_id='alice'`);
  expect(await rejectionOf(f.adopt())).toMatchObject({
    id: "mcp_catalog_principal_unavailable",
  });
  await f.db.execute(
    sql`INSERT INTO account(id,user_id,provider_id,account_id)VALUES(${crypto.randomUUID()},'alice','github','10001'),(${crypto.randomUUID()},'alice','github','10003')`,
  );
  expect(await rejectionOf(f.adopt())).toMatchObject({
    id: "mcp_catalog_principal_unavailable",
  });
  const [r] = await f.db.execute<{
    adoptions: number;
    catalogs: number;
    admissions: number;
  }>(
    sql`SELECT (SELECT count(*)::integer FROM mcp_runtime_adoption) AS adoptions,(SELECT count(*)::integer FROM mcp_catalog_revision) AS catalogs,(SELECT count(*)::integer FROM mcp_catalog_admission) AS admissions`,
  );
  expect(r).toEqual({ adoptions: 0, catalogs: 0, admissions: 0 });
  expect(f.requests).toBe(0);
});

test("sanitized owned runtime account metadata remains available without runtime configuration or keys", async () => {
  const f = get(),
    e = await approved(f);
  await f.runtime.executeRuntime("alice", e.id);
  delete process.env.MCP_RUNTIME_ENABLED;
  delete process.env.MCP_RUNTIME_CONFIG_JSON;
  const { exportOwnedAccount } = await import("@/lib/actions/account/account");
  const exported = (await exportOwnedAccount("alice")).mcpRuntime;
  expect(exported.adoptions).toHaveLength(1);
  expect(exported.frames).toHaveLength(3);
  expect(exported.frames.every((frame) => frame.state === "completed")).toBe(
    true,
  );
  expect((await exportOwnedAccount("bob")).mcpRuntime).toEqual({
    adoptions: [],
    frames: [],
  });
  const data = JSON.stringify(exported);
  for (const field of [
    "arguments",
    "evidencePublicKey",
    "actorKeys",
    "body",
    "binding",
    "intent",
    "proofReference",
    "signature",
  ])
    expect(data.includes(field)).toBe(false);
});

for (const limit of ["responseBytes", "wallMs"] as const) {
  test(`a reviewed fee cannot admit less ${limit} capacity than the transport can consume`, async () => {
    const f = get(),
      config = JSON.parse(process.env.MCP_RUNTIME_CONFIG_JSON ?? "{}");
    const { operationDigest } = await import("@/lib/mcp/operation-contract");
    const fee = config.manifest.fees.initialize;
    fee.capacity[limit] = Math.floor(fee.capacity[limit] / 2);
    fee.capacityDigest = operationDigest(fee.capacity);
    process.env.MCP_RUNTIME_CONFIG_JSON = JSON.stringify(config);
    const result = (async () => {
      const { resolveRuntimeConfig } = await import("@/lib/mcp/runtime-config");
      const current = resolveRuntimeConfig(process.env, new Date());
      return f.runtime.adoptRuntimeManifest("alice", {
        id: crypto.randomUUID(),
        manifestDigest: current.digest,
        initializeConnection: f.connections.initialize,
        callConnection: f.connections.call,
      });
    })();
    expect(await rejectionOf(result)).toMatchObject({
      id: "mcp_runtime_unconfigured",
    });
    const [rows] = await f.db.execute<{ count: number }>(
      sql`SELECT count(*)::integer AS count FROM mcp_runtime_adoption`,
    );
    expect(rows.count).toBe(0);
    expect(f.requests).toBe(0);
  });
}

test("rotating the retained principal secret cannot reset runtime admission counters before any financial entry", async () => {
  const f = get(),
    adoption = await f.adopt();
  await f.runtime.revokeAdoption("alice", adoption.id, adoption.revision);
  const before = await f.db.execute(
    sql`SELECT * FROM mcp_catalog_admission ORDER BY id`,
  );
  process.env.BYOK_RESOURCE_SECRET =
    "synthetic-replaced-principal-secret-at-least-32";
  const config = JSON.parse(process.env.MCP_RUNTIME_CONFIG_JSON ?? "{}");
  config.manifest.revision = "after-principal-rotation";
  process.env.MCP_RUNTIME_CONFIG_JSON = JSON.stringify(config);
  const attempt = (async () => {
    const { resolveRuntimeConfig } = await import("@/lib/mcp/runtime-config");
    return f.runtime.adoptRuntimeManifest("alice", {
      id: crypto.randomUUID(),
      manifestDigest: resolveRuntimeConfig(process.env, new Date()).digest,
      initializeConnection: f.connections.initialize,
      callConnection: f.connections.call,
    });
  })();
  expect(await rejectionOf(attempt)).toMatchObject({
    id: "mcp_actor_rotation_unknown",
  });
  expect(
    await f.db.execute(sql`SELECT * FROM mcp_catalog_admission ORDER BY id`),
  ).toEqual(before);
  expect(f.requests).toBe(0);
});

for (const terminal of ["completed", "failed"]) {
  test(`a ${terminal} run at the final DB authority barrier cannot commit runtime entry or dispatch`, async () => {
    const f = get(),
      e = await approved(f);
    let enteredWrite = false,
      afterEntryApprovalReads = 0,
      changed = false;
    f.afterQuery(async (statement, _result, tx) => {
      if (statement.includes("UPDATE mcp_operation SET state='entered'"))
        enteredWrite = true;
      if (
        !enteredWrite ||
        changed ||
        !statement.includes("SELECT a.state,a.expires_at,a.binding,k.state")
      )
        return;
      if (++afterEntryApprovalReads !== 2) return;
      changed = true;
      await tx.execute(
        sql`UPDATE tool_run SET state=${terminal} WHERE id=(SELECT run_id FROM mcp_runtime_execution WHERE id=${e.id})`,
      );
      await tx.execute(
        sql`UPDATE tool_call SET state='failed' WHERE run_id=(SELECT run_id FROM mcp_runtime_execution WHERE id=${e.id}) AND state IN('queued','running')`,
      );
    });
    expect(
      await rejectionOf(f.runtime.executeRuntime("alice", e.id)),
    ).toBeDefined();
    f.afterQuery(undefined);
    expect(changed).toBe(true);
    const [r] = await f.db.execute<{
      operations: number;
      consumed: number;
      entered: number;
    }>(
      sql`SELECT (SELECT count(*)::integer FROM mcp_operation) AS operations,(SELECT count(*)::integer FROM tool_approval WHERE state='consumed') AS consumed,(SELECT count(*)::integer FROM mcp_runtime_frame WHERE state IN('entered','held','completed')) AS entered`,
    );
    expect(r).toEqual({ operations: 0, consumed: 0, entered: 0 });
    expect(f.requests).toBe(0);
  });
}

test("a valid five-second reviewed transport admits all three production frames immediately within immutable bounds", async () => {
  const f = get();
  const e = await approved(f);
  expect((await f.runtime.executeRuntime("alice", e.id)).state).toBe(
    "completed_unreconciled",
  );
  expect(f.requests).toBe(3);
  const [r] = await f.db.execute<{
    bounded: boolean;
    approvals: number;
    commitment: string;
  }>(
    sql`SELECT bool_and(o.deadline<=e.created_at+interval '5 seconds' AND o.deadline<=r.created_at+interval '20 seconds') AS bounded,(SELECT count(*)::integer FROM tool_approval WHERE state='consumed') AS approvals,(SELECT sum(amount_microdollars)::text FROM mcp_operation_commitment) AS commitment FROM mcp_operation o JOIN mcp_runtime_frame f ON f.operation_id=o.id JOIN mcp_runtime_execution e ON e.id=f.execution_id JOIN tool_run r ON r.id=e.run_id`,
  );
  expect(r).toEqual({ bounded: true, approvals: 3, commitment: "3000" });
});

for (const terminal of ["completed", "failed"]) {
  test(`ToolStore.finish commits ${terminal} authority before a later runtime attempt and denies all dispatch`, async () => {
    const f = get(),
      e = await approved(f);
    const [row] = await f.db.execute<{ run_id: string }>(
      sql`SELECT run_id FROM mcp_runtime_execution WHERE id=${e.id}`,
    );
    await f.tools.finish("alice", row.run_id, terminal);
    expect(
      await rejectionOf(f.runtime.executeRuntime("alice", e.id)),
    ).toMatchObject({ id: "mcp_tool_run_unavailable" });
    const [r] = await f.db.execute<{
      state: string;
      failed: number;
      operations: number;
      consumed: number;
    }>(
      sql`SELECT r.state,(SELECT count(*)::integer FROM tool_call WHERE run_id=r.id AND state='failed') AS failed,(SELECT count(*)::integer FROM mcp_operation) AS operations,(SELECT count(*)::integer FROM tool_approval WHERE state='consumed') AS consumed FROM tool_run r WHERE r.id=${row.run_id}`,
    );
    expect(r).toEqual({
      state: terminal,
      failed: 3,
      operations: 0,
      consumed: 0,
    });
    expect(f.requests).toBe(0);
  });
}

test("ToolStore.finish rolls back run and call authority together when its transaction fails", async () => {
  const f = get(),
    e = await approved(f);
  const [row] = await f.db.execute<{ run_id: string }>(
    sql`SELECT run_id FROM mcp_runtime_execution WHERE id=${e.id}`,
  );
  f.afterQuery((statement) => {
    if (statement.includes("UPDATE tool_run SET state="))
      throw new Error("synthetic finish rollback");
  });
  expect(
    await rejectionOf(f.tools.finish("alice", row.run_id, "failed")),
  ).toBeDefined();
  f.afterQuery(undefined);
  const [r] = await f.db.execute<{ state: string; queued: number }>(
    sql`SELECT r.state,(SELECT count(*)::integer FROM tool_call WHERE run_id=r.id AND state='queued') AS queued FROM tool_run r WHERE r.id=${row.run_id}`,
  );
  expect(r).toEqual({ state: "running", queued: 3 });
  expect(f.requests).toBe(0);
});

test("a tighter reviewed fee expiry bounds every immutable frame and cannot be renewed at dispatch", async () => {
  const f = get(),
    expiry = new Date(Date.now() + 1500);
  f.expireFeesAt(expiry.toISOString());
  const e = await approved(f);
  expect(
    e.frames.every((frame) => frame.expiresAt === expiry.toISOString()),
  ).toBe(true);
  await new Promise((resolve) =>
    setTimeout(resolve, Math.max(0, expiry.getTime() - Date.now()) + 20),
  );
  expect(
    await rejectionOf(f.runtime.executeRuntime("alice", e.id)),
  ).toMatchObject({ id: "mcp_runtime_unconfigured" });
  const [r] = await f.db.execute<{ operations: number; consumed: number }>(
    sql`SELECT (SELECT count(*)::integer FROM mcp_operation) AS operations,(SELECT count(*)::integer FROM tool_approval WHERE state='consumed') AS consumed`,
  );
  expect(r).toEqual({ operations: 0, consumed: 0 });
  expect(f.requests).toBe(0);
});

test("a late-prepared run keeps its original twenty-second ceiling instead of gaining a fresh profile window", async () => {
  const f = get(),
    adoption = await f.adopt(),
    run = await f.run();
  await f.db.execute(
    sql`UPDATE tool_run SET created_at=clock_timestamp()-interval '18 seconds' WHERE id=${run.id}`,
  );
  const e = await f.runtime.prepareRuntimeExecution("alice", {
    id: crypto.randomUUID(),
    runId: run.id,
    toolCallId: run.callId,
    adoptionId: adoption.id,
    arguments: { message: "synthetic" },
  });
  await f.runtime.bootstrapMcpPeriod(f.planIdentity);
  for (const frame of e.frames)
    await f.runtime.decideRuntimeApproval("alice", frame.approvalId, "approve");
  expect((await f.runtime.executeRuntime("alice", e.id)).state).toBe(
    "completed_unreconciled",
  );
  const [r] = await f.db.execute<{ bounded: boolean; tight: boolean }>(
    sql`SELECT bool_and(o.deadline<=r.created_at+interval '20 seconds') AS bounded,bool_and(o.deadline<e.created_at+interval '5 seconds') AS tight FROM mcp_operation o JOIN mcp_runtime_frame f ON f.operation_id=o.id JOIN mcp_runtime_execution e ON e.id=f.execution_id JOIN tool_run r ON r.id=e.run_id`,
  );
  expect(r).toEqual({ bounded: true, tight: true });
  expect(f.requests).toBe(3);
});
