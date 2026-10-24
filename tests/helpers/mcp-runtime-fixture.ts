import { mock } from "bun:test";
import { generateKeyPairSync } from "node:crypto";
import { sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import type { DatabaseTransaction } from "@/lib/db/client";
import {
  certificates,
  offlineDial,
  upstream,
} from "../../services/mcp-egress/tests/helpers";
import { betaFixture, privateKey } from "./beta-fixture";

mock.module("server-only", () => ({}));
const { createReviewedBudgetPlan, registerReviewedBudgetPlan } = await import(
  "./platform-budget-fixture"
);
const { resolvePlatformBudgetConfig } = await import("@/lib/funding/config");
const { operationDigest } = await import("@/lib/mcp/operation-contract");
const { appProfile, resolveRuntimeConfig } = await import(
  "@/lib/mcp/runtime-config"
);
const { computeProfileDigest } = await import("@/lib/mcp/registry-contract");
const { createMcpRuntime } = await import("@/lib/mcp/runtime");
const { ToolStore } = await import("@/lib/tools/store");
const { ByokStore } = await import("@/lib/byok/store");
const { resolveToolModel, toolEstimate } = await import("@/lib/tools/config");
const { toolRunRequest } = await import("@/lib/tools/contract");
const { resourceDigest } = await import("@/lib/byok/config");
const { createBroker } = await import("../../services/mcp-egress/src/broker");
const { parseProfiles } = await import("../../services/mcp-egress/src/profile");
const { MemoryReplayStore } = await import(
  "../../services/mcp-egress/src/replay-store"
);
const cert = certificates();
process.on("exit", () => cert.close());
export async function mcpRuntimeFixture() {
  const expiresAt = "2030-01-01T00:00:00.000Z",
    tool = {
      name: "read_note",
      description:
        "Synthetic offline reviewed metadata; no server or cost proof",
      inputSchema: {
        type: "object",
        properties: { message: { type: "string", maxLength: 128 } },
        required: ["message"],
        additionalProperties: false,
      },
      outputSchema: null,
      readOnly: true as const,
    };
  const base = {
    revision: "synthetic-v1",
    endpoint: "https://broker.example/mcp",
    contentType: "application/json" as const,
    responseTypes: ["application/json"] as ["application/json"],
    maxRequestBytes: 4096,
    maxResponseBytes: 4096,
    timeoutMs: 5000,
    connectMs: 1000,
    firstByteMs: 1000,
    resource: "https://resource.example/mcp",
    issuer: "https://issuer.example/",
    credential: "none" as const,
    protocolVersion: "2025-11-25" as const,
    toolName: tool.name,
  };
  const profiles = {
    initialize: {
      ...base,
      profileId: "runtime-init",
      purpose: "mcp.initialize" as const,
    },
    call: { ...base, profileId: "runtime-call", purpose: "mcp.call" as const },
  };
  const f = await betaFixture({
    skipPlanRegistration: true,
    environment: {
      MCP_CLIENT_ENABLED: "1",
      MCP_CLIENT_PROFILES_JSON: JSON.stringify([
        appProfile(profiles.initialize, expiresAt),
        appProfile(profiles.call, expiresAt),
      ]),
    },
  });
  Object.assign(process.env, {
    TOOLS_ENABLED: "1",
    TOOL_APPROVAL_SECRET: "synthetic-runtime-tool-approval-secret-at-least-32",
    TOOL_MODELS_JSON: JSON.stringify([
      {
        id: "SYNTHETIC-OFFLINE",
        adapter: "openrouter",
        model: "fixture/tools",
        provider: "fixture",
        verified: true,
        tools: true,
        reasoning: false,
        providerBudgetVerified: true,
        expiresAt,
        inputMicrodollarsPerMillion: 1000,
        outputMicrodollarsPerMillion: 1000,
      },
    ]),
    MCP_CLIENT_BROKER_URL: "https://broker.example/v1/egress",
    MCP_CLIENT_HMAC_KEY: Buffer.alloc(32, 1).toString("base64"),
    MCP_CLIENT_ENVELOPE_KEY: Buffer.alloc(32, 2).toString("base64"),
  });
  const plan = createReviewedBudgetPlan(
    { aMcp: 100000, bSelected: 10000000 },
    process.env,
  );
  Object.assign(process.env, {
    PLATFORM_BUDGET_PLAN_JSON: JSON.stringify(plan),
  });
  await registerReviewedBudgetPlan(f.db, plan, process.env);
  const configured = resolvePlatformBudgetConfig(process.env, new Date());
  if (!configured) throw new Error("fixture_plan_missing");
  const planIdentity = {
    month: plan.month,
    revision: plan.revision,
    digest: configured.digest,
    capacityDigest: configured.capacityDigest,
  };
  const capacity = {
    ownerActive: 1 as const,
    globalActive: 2 as const,
    ownerDailyRequests: 10 as const,
    globalDailyRequests: 50 as const,
    ownerRecords: 100 as const,
    globalRecords: 1000 as const,
    requestBytes: 4096,
    responseBytes: 4096,
    cpuMs: 1000,
    wallMs: 5000,
    attempts: 1 as const,
    sharedCapacityDigest: configured.capacityDigest,
  };
  const fee = {
    id: "SYNTHETIC-NOT-A-PRICE",
    revision: "offline-v1",
    basis: "reviewed" as const,
    reviewedAt: new Date(Date.now() - 60000).toISOString(),
    expiresAt,
    proofReference: "offline-synthetic-NOT-COST-PROOF",
    proofDigest: "a".repeat(64),
    upperBoundMicrodollars: 1000,
    allInPlatformCost: true as const,
    coverage: {
      broker: true as const,
      transport: true as const,
      cpu: true as const,
      database: true as const,
      storage: true as const,
      queues: true as const,
      upstream: true as const,
      accountCharges: true as const,
    },
    capacity,
    capacityDigest: operationDigest(capacity),
  };
  const keys = generateKeyPairSync("ed25519"),
    manifest = {
      id: "synthetic-runtime",
      revision: "offline-v1",
      reviewedAt: new Date(Date.now() - 60000).toISOString(),
      expiresAt,
      proofReference: "synthetic-NOT-SERVER-PROOF",
      proofDigest: "b".repeat(64),
      brokerEndpoint: "https://broker.example/v1/egress",
      evidenceKeyVersion: "v1",
      evidencePublicKey: keys.publicKey
        .export({ format: "der", type: "spki" })
        .toString("base64"),
      synchronous: true as const,
      stateless: true as const,
      credentials: "none" as const,
      profiles,
      tool,
      fees: {
        initialize: { ...fee, id: "SYNTHETIC-INIT" },
        initialized: { ...fee, id: "SYNTHETIC-NOTIFY" },
        call: { ...fee, id: "SYNTHETIC-CALL" },
      },
    };
  const rawConfig = {
    manifest,
    activeActorKey: "v1",
    actorKeys: { v1: "synthetic-runtime-resource-key-at-least-32" },
  };
  Object.assign(process.env, {
    MCP_RUNTIME_ENABLED: "1",
    MCP_RUNTIME_CONFIG_JSON: JSON.stringify(rawConfig),
  });
  let config = resolveRuntimeConfig(process.env, new Date());
  const connections = {
    initialize: { id: crypto.randomUUID(), revision: crypto.randomUUID() },
    call: { id: crypto.randomUUID(), revision: crypto.randomUUID() },
  };
  await f.db.execute(
    sql`INSERT INTO account(id,user_id,provider_id,account_id)VALUES(${crypto.randomUUID()},'alice','github','10001'),(${crypto.randomUUID()},'bob','github','10002')`,
  );
  for (const kind of ["initialize", "call"] as const) {
    const p = profiles[kind],
      c = connections[kind];
    await f.db.execute(
      sql`INSERT INTO mcp_connection(id,user_id,profile_id,profile_revision,purpose,profile_digest,label,state,revision)VALUES(${c.id},'alice',${p.profileId},${p.revision},${p.purpose},${computeProfileDigest(appProfile(p, expiresAt))},'Offline runtime','configured',${c.revision})`,
    );
  }
  let behavior = "success",
    sends = 0;
  const messages: Record<string, unknown>[] = [];
  const up = await upstream(cert, (req, res) => {
    let body = "";
    req.on("data", (c) => {
      body += c;
    });
    req.on("end", () => {
      sends++;
      const message = JSON.parse(body);
      messages.push(message);
      if (behavior === "hang") return;
      if (behavior === "session")
        res.setHeader("mcp-session-id", "unsupported");
      if (message.method === "notifications/initialized") {
        res.writeHead(behavior === "notify204" ? 204 : 202);
        res.end();
        return;
      }
      res.writeHead(200, {
        "content-type":
          behavior === "sse" ? "text/event-stream" : "application/json",
      });
      if (behavior === "malformed") {
        res.end("not-json");
        return;
      }
      res.end(
        JSON.stringify(
          behavior === "ping"
            ? { jsonrpc: "2.0", id: "server-request", method: "ping" }
            : {
                jsonrpc: "2.0",
                id: behavior === "wrong-id" ? "wrong" : message.id,
                result:
                  message.method === "initialize"
                    ? {
                        protocolVersion: "2025-11-25",
                        capabilities: { tools: {} },
                        serverInfo: { name: "synthetic", version: "1" },
                      }
                    : behavior === "task"
                      ? { task: { taskId: "unsupported" } }
                      : {
                          content: [
                            {
                              type: "text",
                              text: "Synthetic result; never a remote proof",
                            },
                          ],
                        },
              },
        ),
      );
    });
  });
  const dial = offlineDial(up.port, cert.ca);
  const makeBroker = () =>
    createBroker(
      {
        bind: "127.0.0.1",
        port: 0,
        production: false,
        hmacKey: Buffer.alloc(32, 1),
        envelopeKey: Buffer.alloc(32, 2),
        profiles: parseProfiles(
          Object.values(profiles)
            .map((p) => ({
              ...p,
              protocolVersion: undefined,
              toolName: undefined,
              runtime: {
                manifestDigest: config.digest,
                profileDigest: operationDigest(p),
                protocolVersion: p.protocolVersion,
                toolName: p.toolName,
              },
            }))
            .map(({ protocolVersion: _a, toolName: _b, ...p }) => p),
        ),
        secrets: {},
        concurrency: 2,
        maxConnections: 8,
        evidence: {
          keyVersion: "v1",
          privateKey: keys.privateKey
            .export({ format: "pem", type: "pkcs8" })
            .toString(),
        },
      },
      new MemoryReplayStore(),
      dial.dependencies,
    );
  let broker = makeBroker();
  let requests = 0;
  let onSend: (() => void) | undefined;
  const binding = {
    fetch: async (_url: RequestInfo | URL, init?: RequestInit) => {
      requests++;
      onSend?.();
      if (behavior === "transport-failure")
        throw new Error("synthetic offline crash before send");
      const result = await broker(
        JSON.parse(String(init?.body)),
        new Headers(init?.headers).get("x-mcp-signature"),
        init?.signal ?? new AbortController().signal,
      );
      if (
        behavior === "tamper" &&
        result.attestation &&
        typeof result.attestation === "object"
      )
        Reflect.set(result.attestation, "signature", `${"A".repeat(86)}==`);
      return Response.json(result);
    },
  };
  let hook:
    | ((
        statement: string,
        result: unknown,
        tx: DatabaseTransaction,
      ) => void | Promise<void>)
    | undefined;
  const dialect = new PgDialect();
  const db = new Proxy(f.db, {
    get(target, key, receiver) {
      if (key === "transaction")
        return <T>(
          run: (tx: DatabaseTransaction) => Promise<T>,
          options?: Parameters<typeof f.db.transaction>[1],
        ) =>
          target.transaction(
            (tx) =>
              run(
                new Proxy(tx, {
                  get(t, k, r) {
                    if (k === "execute")
                      return async (
                        query: Parameters<DatabaseTransaction["execute"]>[0],
                      ) => {
                        const result = await t.execute(query);
                        await hook?.(
                          typeof query === "string"
                            ? query
                            : dialect.sqlToQuery(query.getSQL()).sql,
                          result,
                          t,
                        );
                        return result;
                      };
                    return Reflect.get(t, k, r);
                  },
                }),
              ),
            options,
          );
      return Reflect.get(target, key, receiver);
    },
  });
  const runtime = createMcpRuntime({ db, binding });
  const tools = new ToolStore(db),
    byok = new ByokStore(db);
  async function run(owner = "alice") {
    await byok.save(owner, "openrouter", privateKey, process.env, null);
    const selected = resolveToolModel(
        process.env,
        "SYNTHETIC-OFFLINE",
        "openrouter",
      ),
      estimate = toolEstimate(selected),
      request = toolRunRequest.parse({
        id: crypto.randomUUID(),
        prompt: "Synthetic local production path, no provider call",
        funding: "openrouter",
        model: selected.id,
        estimateMicrodollars: estimate,
        ceilingMicrodollars: estimate,
        providerBudgetAcknowledged: true,
        revisions: [],
      });
    await tools.create(owner, request);
    await byok.reserve({
      id: request.id,
      userId: owner,
      provider: "openrouter",
      kind: "chat",
      resourceUnits: 3,
      digest: resourceDigest(
        JSON.stringify({ request, selected }),
        process.env,
      ),
      env: process.env,
    });
    await byok.enter(request.id, owner, process.env);
    await tools.step({
      id: request.id,
      userId: owner,
      env: process.env,
      step: 0,
      inputBytes: 100,
      outputTokens: 170,
      revisions: [],
    });
    const callId = crypto.randomUUID();
    await tools.event(owner, request.id, {
      id: callId,
      name: `mcp:${tool.name}`,
      state: "queued",
    });
    return { id: request.id, callId };
  }
  async function adopt() {
    return runtime.adoptRuntimeManifest("alice", {
      id: crypto.randomUUID(),
      manifestDigest: config.digest,
      initializeConnection: connections.initialize,
      callConnection: connections.call,
    });
  }
  async function prepare() {
    const adoption = await adopt(),
      r = await run();
    return runtime.prepareRuntimeExecution("alice", {
      id: crypto.randomUUID(),
      runId: r.id,
      toolCallId: r.callId,
      adoptionId: adoption.id,
      arguments: { message: "synthetic" },
    });
  }
  return {
    ...f,
    db,
    runtime,
    tools,
    rawConfig,
    get config() {
      return config;
    },
    manifest,
    planIdentity,
    connections,
    adopt,
    run,
    prepare,
    keys,
    binding,
    get sends() {
      return sends;
    },
    get requests() {
      return requests;
    },
    messages,
    expireFeesAt(expiration: string) {
      for (const fee of Object.values(manifest.fees))
        fee.expiresAt = expiration;
      process.env.MCP_RUNTIME_CONFIG_JSON = JSON.stringify(rawConfig);
      config = resolveRuntimeConfig(process.env, new Date());
      broker = makeBroker();
    },
    beforeBroker(fn: () => void) {
      onSend = fn;
    },
    setBehavior(v: string) {
      behavior = v;
    },
    afterQuery(fn: typeof hook) {
      hook = fn;
    },
    close: async () => {
      await up.close();
      await f.close();
    },
  };
}
