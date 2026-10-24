import { mock } from "bun:test";
import { PgDialect } from "drizzle-orm/pg-core";
import type { EnvSource } from "@/lib/auth/env";
import type { DatabaseTransaction } from "@/lib/db/client";
import { betaFixture } from "./beta-fixture";

mock.module("server-only", () => ({}));
const { createFixtureMcpOperationStore } = await import(
  "@/lib/mcp/operation-store"
);
const { operationDigest } = await import("@/lib/mcp/operation-contract");
const { computeProfileDigest } = await import("@/lib/mcp/registry-contract");
const { parseProfileEntry } = await import("@/lib/mcp/config");
const { resolvePlatformBudgetConfig } = await import("@/lib/funding/config");
const { createReviewedBudgetPlan, registerReviewedBudgetPlan } = await import(
  "./platform-budget-fixture"
);

import type { McpFeeSnapshot } from "@/lib/mcp/fee-config";
import type { OperationIntent } from "@/lib/mcp/operation-contract";
import type { McpOperationRuntime } from "@/lib/mcp/operation-store";

export async function mcpOperationFixture(
  options: {
    aMcp?: number;
    amount?: number;
    capacity?: Partial<McpFeeSnapshot["capacity"]>;
  } = {},
) {
  const profile = parseProfileEntry({
    profileId: "offline-mcp",
    revision: "synthetic-v1",
    purpose: "mcp.call",
    resource: "https://mcp.example.com/mcp",
    issuer: "https://issuer.example.com/",
    credential: "none",
    maxRequestBytes: 1024,
    maxResponseBytes: 4096,
    timeoutMs: 20000,
    expiresAt: "2030-01-01T00:00:00.000Z",
  });
  const fixture = await betaFixture({
    skipPlanRegistration: true,
    environment: {
      MCP_CLIENT_ENABLED: "1",
      MCP_CLIENT_PROFILES_JSON: JSON.stringify([profile]),
    },
  });
  let env: EnvSource = { ...process.env };
  const plan = createReviewedBudgetPlan(
    { aMcp: options.aMcp ?? 100000, bSelected: 10000000 },
    env,
  );
  env = { ...env, PLATFORM_BUDGET_PLAN_JSON: JSON.stringify(plan) };
  await registerReviewedBudgetPlan(fixture.db, plan, env);
  const configured = resolvePlatformBudgetConfig(env, new Date());
  if (!configured) throw new Error("fixture_plan_missing");
  const planIdentity = {
    month: plan.month,
    revision: plan.revision,
    digest: configured.digest,
    capacityDigest: configured.capacityDigest,
  };
  const capacity = {
    ownerActive: 1,
    globalActive: 2,
    ownerDailyRequests: 10,
    globalDailyRequests: 50,
    ownerRecords: 100,
    globalRecords: 1000,
    requestBytes: 1024,
    responseBytes: 4096,
    cpuMs: 1000,
    wallMs: 20000,
    attempts: 1,
    sharedCapacityDigest: configured.capacityDigest,
    ...options.capacity,
  };
  const fee: McpFeeSnapshot = {
    id: "SYNTHETIC-NOT-A-REAL-PRICE",
    revision: "offline-v1",
    basis: "synthetic-offline",
    reviewedAt: new Date(Date.now() - 60000).toISOString(),
    expiresAt: "2030-01-01T00:00:00.000Z",
    proofReference: "offline-accounting-fixture-NOT-COST-PROOF",
    proofDigest: "a".repeat(64),
    upperBoundMicrodollars: options.amount ?? 10000,
    allInPlatformCost: true,
    coverage: {
      broker: true,
      transport: true,
      cpu: true,
      database: true,
      storage: true,
      queues: true,
      upstream: true,
      accountCharges: true,
    },
    capacity: { ...capacity, attempts: 1 },
    capacityDigest: operationDigest({ ...capacity, attempts: 1 }),
  };
  let runtime: McpOperationRuntime = {
    fee,
    activeKeyVersion: "v1",
    actorKeys: { v1: "synthetic-offline-actor-secret-at-least-32-characters" },
  };
  const connections = new Map<string, { id: string; revision: string }>();
  for (const owner of ["alice", "bob", "outsider"]) {
    const id = crypto.randomUUID(),
      revision = crypto.randomUUID();
    connections.set(owner, { id, revision });
    await fixture.db.$client.unsafe(
      "INSERT INTO mcp_connection(id,user_id,profile_id,profile_revision,purpose,profile_digest,label,state,revision) VALUES ($1,$2,$3,$4,$5,$6,'Offline fixture','configured',$7)",
      [
        id,
        owner,
        profile.profileId,
        profile.revision,
        profile.purpose,
        computeProfileDigest(profile),
        revision,
      ],
    );
  }
  let clockOverride: Date | undefined;
  let hook:
    | ((
        statement: string,
        result: unknown,
        tx: DatabaseTransaction,
      ) => void | Promise<void>)
    | undefined;
  const dialect = new PgDialect();
  const observedDb = new Proxy(fixture.db, {
    get(target, key, receiver) {
      if (key === "transaction")
        return <T>(
          run: (tx: DatabaseTransaction) => Promise<T>,
          options?: Parameters<typeof fixture.db.transaction>[1],
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
                        if (clockOverride)
                          for (const row of result)
                            if ("now" in row)
                              Reflect.set(row, "now", new Date(clockOverride));
                        await hook?.(
                          typeof query === "string"
                            ? query
                            : dialect.sqlToQuery(query.getSQL()).sql,
                          result,
                          transaction,
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
  const store = createFixtureMcpOperationStore({
    db: observedDb,
    env: () => env,
    runtime: () => runtime,
  });
  await store.bootstrapPeriod(planIdentity, []);
  function intent(
    owner = "alice",
    overrides: Partial<OperationIntent> = {},
  ): OperationIntent {
    const connection = connections.get(owner);
    if (!connection) throw new Error("fixture_owner_missing");
    return {
      id: crypto.randomUUID(),
      idempotencyKey: crypto.randomUUID(),
      connection,
      profile: {
        id: profile.profileId,
        revision: profile.revision,
        purpose: profile.purpose,
        digest: computeProfileDigest(profile),
      },
      catalog: {
        id: "owned-offline-catalog",
        revision: "v1",
        digest: "b".repeat(64),
      },
      action: { id: "offline-action", revision: "v1", digest: "c".repeat(64) },
      approval: {
        id: crypto.randomUUID(),
        revision: "v1",
        digest: "d".repeat(64),
      },
      requestDigest: "e".repeat(64),
      requestBytes: 10,
      plan: planIdentity,
      feeDigest: operationDigest(runtime.fee),
      authority: {
        id: crypto.randomUUID(),
        revision: "v1",
        digest: "f".repeat(64),
      },
      deadline: new Date(Date.now() + 19000).toISOString(),
      maxAttempts: 1,
      ...overrides,
    };
  }
  async function authorized(
    owner = "alice",
    overrides: Partial<OperationIntent> = {},
  ) {
    const input = intent(owner, overrides);
    await store.issueFixtureAuthority(
      owner,
      input,
      new Date(new Date(input.deadline).getTime() + 60000).toISOString(),
    );
    return input;
  }
  return {
    ...fixture,
    db: observedDb,
    store,
    fee,
    planIdentity,
    connections,
    intent,
    authorized,
    get env() {
      return env;
    },
    get runtime() {
      return runtime;
    },
    setEnv(value: EnvSource) {
      env = value;
    },
    setRuntime(value: McpOperationRuntime) {
      runtime = value;
    },
    afterQuery(value: typeof hook) {
      hook = value;
    },
    setClock(value: Date | undefined) {
      clockOverride = value;
    },
  };
}
