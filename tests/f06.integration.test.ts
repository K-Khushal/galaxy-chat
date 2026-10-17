import {
  afterAll,
  beforeAll,
  beforeEach,
  expect,
  mock,
  setDefaultTimeout,
  test,
} from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import type { LanguageModelUsage, UIMessageChunk } from "ai";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../lib/db/schema";

mock.module("server-only", () => ({}));
const { CreditStore, actorFor } = await import("../lib/credits/store");
const {
  DAILY_MICRODOLLARS,
  resolveFundingConfig,
  LIMITS,
  worstCaseMicrodollars,
} = await import("../lib/credits/config");
const {
  startFundedStream,
  openRouterProvider,
  boundContext,
  receiptMicrodollars,
  knownReceipt,
} = await import("../lib/credits/service");
const { creditStatus } = await import("../lib/credits/status");
const { guestHandlers } = await import("../lib/credits/guest-handlers");
const { guestId, signedGuest, guestCookie, guestNetwork } = await import(
  "../lib/credits/guest"
);
const { boundedJson } = await import("../lib/credits/http");
setDefaultTimeout(30_000);
const secret = "f06-actor-stable-local-secret-32-chars";
const price = {
  id: "fixture-2026",
  model: "fixture/basic",
  provider: "fixture",
  expiresAt: "2030-01-01T00:00:00Z",
  inputMicrodollarsPerMillion: 1_000_000,
  outputMicrodollarsPerMillion: 2_000_000,
  basicTextOnly: true,
  reasoning: "none",
  allInPrice: true,
};
const env = {
  FUNDED_INFERENCE: "1",
  FUNDED_KILL_SWITCH: "0",
  FUNDED_PROVIDER_LIMITS_VERIFIED: "1",
  OPENROUTER_API_KEY: "local-fixture-never-sent",
  CREDIT_ACTOR_SECRET: secret,
  PLATFORM_INFRA_MICRODOLLARS: "0",
  PLATFORM_PROVIDER_FEES_MICRODOLLARS: "0",
  PLATFORM_SAFETY_RESERVE_MICRODOLLARS: "1000000",
  FUNDED_MONTHLY_MICRODOLLARS: "1000000",
  FUNDED_BASIC_PRICE_JSON: JSON.stringify(price),
};
const guestEnv = {
  ...env,
  GUEST_COOKIE_SECRET: "guest-signature-test-secret-at-least-32",
  GUEST_TURNSTILE_SECRET: "local-bot-fixture-never-sent",
  GUEST_TRUSTED_PROXY: "cloudflare",
  GUEST_ORIGIN_IS_PROXY_ONLY: "1",
  BETTER_AUTH_URL: "https://galaxy.example",
};
let database: PGlite;
let socket: PGLiteSocketServer;
let client: ReturnType<typeof postgres>;
let store: InstanceType<typeof CreditStore>;
let db: ReturnType<typeof drizzle<typeof schema>>;
const actor = (id = crypto.randomUUID(), kind: "user" | "guest" = "user") =>
  actorFor(kind, id, secret);
const config = () => resolveFundingConfig(env);
const digest = "a".repeat(64);
function reserve(
  who = actor(),
  microdollars = 100_000,
  overrides: Partial<Parameters<typeof store.reserve>[0]> = {},
) {
  return store.reserve({
    actor: who,
    microdollars,
    config: config(),
    digest,
    idempotencyKey: crypto.randomUUID(),
    ...overrides,
  });
}
function usage(cost: unknown = 0.000003): LanguageModelUsage {
  return {
    inputTokens: 10,
    outputTokens: 2,
    inputTokenDetails: {
      noCacheTokens: 10,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    },
    outputTokenDetails: { textTokens: 2, reasoningTokens: 0 },
    totalTokens: 12,
    raw:
      typeof cost === "number"
        ? { prompt_tokens: 10, completion_tokens: 2, cost }
        : { prompt_tokens: 10, completion_tokens: 2 },
  };
}
function provider(
  options: {
    called?: () => void;
    uncertain?: boolean;
    failConsume?: boolean;
    report?: LanguageModelUsage;
    delay?: Promise<void>;
    completed?: () => void;
  } = {},
): import("../lib/credits/service").FundedProvider {
  return (_config, _turns, callbacks) => {
    options.called?.();
    return {
      stream: new ReadableStream<UIMessageChunk>({
        start(controller) {
          controller.enqueue({ type: "start", messageId: crypto.randomUUID() });
          controller.enqueue({ type: "text-start", id: "text-1" });
          controller.enqueue({
            type: "text-delta",
            id: "text-1",
            delta: "fixture answer",
          });
          controller.enqueue({ type: "text-end", id: "text-1" });
          controller.enqueue({ type: "finish", finishReason: "stop" });
          controller.close();
        },
      }),
      consume: async () => {
        await options.delay;
        if (options.uncertain) callbacks.uncertain();
        if (options.failConsume)
          throw new Error("disconnect after provider entry");
        await callbacks.complete(options.report ?? usage());
        options.completed?.();
      },
    };
  };
}
beforeAll(async () => {
  database = await PGlite.create();
  for (const name of readdirSync("drizzle")
    .filter((name) => name.endsWith(".sql"))
    .sort())
    await database.exec(readFileSync(`drizzle/${name}`, "utf8"));
  socket = new PGLiteSocketServer({
    db: database,
    host: "127.0.0.1",
    port: 0,
    maxConnections: 4,
  });
  await socket.start();
  client = postgres(
    `postgres://postgres:postgres@${socket.getServerConn()}/postgres`,
    { max: 4, prepare: false },
  );
  db = drizzle(client, { schema });
  store = new CreditStore(db);
});
beforeEach(async () => {
  await database.exec(
    "TRUNCATE credit_ledger, guest_usage, credit_reservation, guest_rate; UPDATE funding_control SET stopped = false",
  );
});
afterAll(async () => {
  await client?.end({ timeout: 1 });
  await socket?.stop();
  await database?.close();
});

test("explicit integer funding subtracts all commitments from the ten dollar ceiling", () => {
  expect(config().monthlyMicrodollars).toBe(1_000_000);
  for (const invalid of [
    { FUNDED_INFERENCE: "0" },
    { FUNDED_KILL_SWITCH: "1" },
    { FUNDED_KILL_SWITCH: undefined },
    { FUNDED_MONTHLY_MICRODOLLARS: "10000000" },
    { PLATFORM_INFRA_MICRODOLLARS: undefined },
    { PLATFORM_PROVIDER_FEES_MICRODOLLARS: "NaN" },
    { FUNDED_BASIC_PRICE_JSON: "{}" },
    { FUNDED_PROVIDER_LIMITS_VERIFIED: "0" },
    {
      FUNDED_BASIC_PRICE_JSON: JSON.stringify({
        ...price,
        reasoning: "enabled",
      }),
    },
    {
      FUNDED_BASIC_PRICE_JSON: JSON.stringify({
        ...price,
        expiresAt: "2020-01-01T00:00:00Z",
      }),
    },
  ])
    expect(() => resolveFundingConfig({ ...env, ...invalid })).toThrow();
  expect(receiptMicrodollars("0.0000011")).toBe(2);
  expect(receiptMicrodollars(1e-7)).toBe(1);
  expect(receiptMicrodollars(undefined)).toBeUndefined();
  expect(receiptMicrodollars(-1)).toBeUndefined();
  expect(knownReceipt(usage("unknown"))).toBeUndefined();
});

test("concurrent actors cannot exceed the shared cap; the immutable snapshot records the reservation", async () => {
  const capped = {
    ...config(),
    monthlyMicrodollars: 300_000,
    globalConcurrency: 10,
  };
  const results = await Promise.allSettled(
    Array.from({ length: 8 }, () =>
      reserve(actor(), 200_000, { config: capped }),
    ),
  );
  expect(
    results.filter((result) => result.status === "fulfilled"),
  ).toHaveLength(1);
  const totals = await store.status(actor());
  expect(totals.monthly).toBe(200_000);
  const snapshots = await database.query<{ price_snapshot: unknown }>(
    "SELECT price_snapshot FROM credit_reservation",
  );
  expect(snapshots.rows[0].price_snapshot).toEqual(price);
  await expect(
    database.exec("UPDATE credit_ledger SET event = 'edited'"),
  ).rejects.toThrow("append only");
  await expect(database.exec("DELETE FROM credit_ledger")).rejects.toThrow(
    "append only",
  );
});

test("actor concurrency and daily cap hold under concurrent requests", async () => {
  const who = actor();
  const attempts = await Promise.allSettled([
    reserve(who, 300_000),
    reserve(who, 300_000),
  ]);
  expect(
    attempts.filter((result) => result.status === "fulfilled"),
  ).toHaveLength(1);
  const first = attempts.find((result) => result.status === "fulfilled");
  if (!first || first.status !== "fulfilled")
    throw new Error("missing reservation");
  await store.enter(first.value.id, who);
  await store.finish(first.value.id, who, {
    kind: "known",
    microdollars: 300_000,
    evidence: "fixture",
    usage: {},
  });
  const second = await reserve(who, 200_000);
  await store.enter(second.id, who);
  await store.finish(second.id, who, {
    kind: "known",
    microdollars: 200_000,
    evidence: "fixture",
    usage: {},
  });
  expect((await store.status(who)).daily).toBe(DAILY_MICRODOLLARS);
  await expect(reserve(who, 1)).rejects.toMatchObject({
    id: "daily_exhausted",
  });
});

test("idempotency and provider claims never repeat; another actor cannot settle a reservation", async () => {
  const who = actor();
  const idempotencyKey = crypto.randomUUID();
  const results = await Promise.allSettled([
    reserve(who, 20_000, { idempotencyKey }),
    reserve(who, 20_000, { idempotencyKey }),
  ]);
  expect(
    results.filter((result) => result.status === "fulfilled"),
  ).toHaveLength(1);
  const result = results.find((item) => item.status === "fulfilled");
  if (!result || result.status !== "fulfilled")
    throw new Error("missing reservation");
  const row = result.value;
  await expect(
    reserve(who, 20_000, { idempotencyKey, digest: "b".repeat(64) }),
  ).rejects.toMatchObject({ id: "idempotency_conflict" });
  const claims = await Promise.allSettled([
    store.enter(row.id, who),
    store.enter(row.id, who),
  ]);
  expect(claims.filter((item) => item.status === "fulfilled")).toHaveLength(1);
  await expect(
    store.finish(row.id, actor(), { kind: "before_entry" }),
  ).rejects.toMatchObject({ id: "not_found" });
  await store.finish(row.id, who, {
    kind: "known",
    microdollars: 15,
    evidence: "receipt",
    usage: {},
  });
  await store.finish(row.id, who, {
    kind: "known",
    microdollars: 15,
    evidence: "receipt",
    usage: {},
  });
  await expect(
    store.finish(row.id, who, {
      kind: "known",
      microdollars: 16,
      evidence: "other receipt",
      usage: {},
    }),
  ).rejects.toMatchObject({ id: "settlement_conflict" });
  const events = await database.query(
    "SELECT * FROM credit_ledger WHERE event = 'settled'",
  );
  expect(events.rows).toHaveLength(1);
  expect((await store.status(who)).daily).toBe(15);
});

test("UTC rollovers reset known spend, carry unresolved holds, then reconcile without double counting", async () => {
  const who = actor();
  const old = new Date("2026-10-31T23:59:59Z");
  const next = new Date("2026-11-01T00:00:01Z");
  const held = await reserve(who, 200_000, { now: old });
  await store.enter(held.id, who);
  await store.finish(held.id, who, { kind: "unknown" });
  expect(await store.status(who, next)).toMatchObject({
    daily: 200_000,
    monthly: 200_000,
    actorActive: 1,
  });
  await expect(reserve(who, 100_000, { now: next })).rejects.toMatchObject({
    id: "funding_busy",
  });
  await store.finish(held.id, who, {
    kind: "known",
    microdollars: 50_000,
    evidence: "operator-provider-receipt",
    usage: {},
  });
  expect(await store.status(who, next)).toMatchObject({
    daily: 0,
    monthly: 0,
    actorActive: 0,
  });
  expect(await store.status(who, old)).toMatchObject({
    daily: 50_000,
    monthly: 50_000,
  });
  const fresh = await reserve(who, 100_000, { now: next });
  await store.enter(fresh.id, who);
  await store.finish(fresh.id, who, {
    kind: "known",
    microdollars: 20_000,
    evidence: "receipt",
    usage: {},
  });
  expect(await store.status(who, next)).toMatchObject({
    daily: 20_000,
    monthly: 20_000,
  });
  expect(
    await store.status(who, new Date("2026-11-02T00:00:00Z")),
  ).toMatchObject({ daily: 0, monthly: 20_000 });
});

test("pre-entry failure releases safely; post-entry failure and retries retain the hold", async () => {
  const who = actor();
  let calls = 0;
  const key = crypto.randomUUID();
  const base = {
    env,
    actor: who,
    idempotencyKey: key,
    turns: [{ role: "user" as const, content: "hello" }],
    store,
  };
  await expect(
    startFundedStream({
      ...base,
      beforeProvider: async () => {
        throw new Error("database write failed");
      },
      provider: provider({
        called: () => {
          calls += 1;
        },
      }),
    }),
  ).rejects.toThrow("database write failed");
  expect(calls).toBe(0);
  expect((await store.status(who)).daily).toBe(0);
  await expect(
    startFundedStream({
      ...base,
      idempotencyKey: crypto.randomUUID(),
      provider: () => {
        calls += 1;
        throw new Error("provider entered then failed");
      },
    }),
  ).rejects.toThrow("provider entered");
  expect(calls).toBe(1);
  expect((await store.status(who)).daily).toBe(
    worstCaseMicrodollars(config().price),
  );
  await expect(
    startFundedStream({
      ...base,
      provider: provider({
        called: () => {
          calls += 1;
        },
      }),
    }),
  ).rejects.toMatchObject({ id: "request_already_processed" });
  expect(calls).toBe(1);
});

test("unknown usage and abort/error after entry retain conservative holds; a cancellation cannot release them", async () => {
  for (const options of [
    { uncertain: true, report: usage("missing") },
    { failConsume: true },
    { report: usage("missing") },
  ]) {
    const who = actor();
    const result = await startFundedStream({
      env,
      actor: who,
      store,
      idempotencyKey: crypto.randomUUID(),
      turns: [{ role: "user", content: "hello" }],
      provider: provider(options),
    });
    await result.stream.cancel();
    await result.completion;
    expect((await store.status(who)).daily).toBe(
      worstCaseMicrodollars(config().price),
    );
    await store.finish(result.reservationId, who, { kind: "before_entry" });
    expect((await store.status(who)).daily).toBe(
      worstCaseMicrodollars(config().price),
    );
    // Resolve only from an explicit provider receipt, never a cancellation.
    await store.finish(result.reservationId, who, {
      kind: "known",
      microdollars: 5,
      evidence: "reconciled-receipt",
      usage: {},
    });
  }
});

test("disconnect with a final known receipt settles actual cost while duplicate retry never calls provider twice", async () => {
  const who = actor();
  let unblock: () => void = () => {};
  const delay = new Promise<void>((resolve) => {
    unblock = resolve;
  });
  let calls = 0;
  const options = {
    env,
    actor: who,
    store,
    idempotencyKey: crypto.randomUUID(),
    turns: [{ role: "user" as const, content: "hello" }],
    provider: provider({
      delay,
      called: () => {
        calls += 1;
      },
    }),
  };
  const result = await startFundedStream(options);
  await result.stream.cancel();
  await expect(startFundedStream(options)).rejects.toMatchObject({
    id: "request_already_processed",
  });
  unblock();
  await result.completion;
  expect((await store.status(who)).daily).toBe(3);
  expect(calls).toBe(1);
});

test("kill switch, expired/unknown pricing and unallowlisted models cannot invoke any provider", async () => {
  let calls = 0;
  const base = {
    actor: actor(),
    store,
    idempotencyKey: crypto.randomUUID(),
    turns: [{ role: "user" as const, content: "hi" }],
    provider: provider({
      called: () => {
        calls += 1;
      },
    }),
  };
  for (const changed of [
    { FUNDED_INFERENCE: "0" },
    { FUNDED_KILL_SWITCH: "1" },
    { FUNDED_BASIC_PRICE_JSON: "{}" },
  ])
    await expect(
      startFundedStream({ ...base, env: { ...env, ...changed } }),
    ).rejects.toThrow();
  await expect(
    startFundedStream({ ...base, env, model: "expensive/advanced" }),
  ).rejects.toMatchObject({ id: "model_not_funded" });
  await database.exec("UPDATE funding_control SET stopped = true");
  await expect(startFundedStream({ ...base, env })).rejects.toMatchObject({
    id: "funded_inference_disabled",
  });
  expect(calls).toBe(0);
  expect((await creditStatus(env, actor(), store)).state).toBe("disabled");
});

test("provider bound violations retain observed costs and stop all further funding", async () => {
  const who = actor();
  const row = await reserve(who, 10);
  await store.enter(row.id, who);
  expect(
    await store.finish(row.id, who, {
      kind: "known",
      microdollars: 11,
      evidence: "violated-bound",
      usage: {},
    }),
  ).toBe("settled");
  expect(await store.status(who)).toMatchObject({ daily: 11, stopped: true });
  await expect(reserve(actor(), 1)).rejects.toMatchObject({
    id: "funded_inference_disabled",
  });
});

test("credit state hides shared/admin balances and never promises availability from daily funds alone", async () => {
  const who = actor();
  const row = await reserve(actor(), 1_000, {
    config: { ...config(), monthlyMicrodollars: 1_000 },
  });
  const limitedEnv = { ...env, FUNDED_MONTHLY_MICRODOLLARS: "1000" };
  const view = await creditStatus(limitedEnv, who, store);
  expect(view).toMatchObject({
    state: "shared_exhausted",
    configured: true,
    remainingMicrodollars: 500_000,
    allowanceMicrodollars: 500_000,
    creditMicrodollars: 100_000,
  });
  expect(JSON.stringify(view)).not.toContain("monthly");
  expect(JSON.stringify(view)).not.toContain("local-fixture");
  await store.finish(row.id, actor(), { kind: "before_entry" }).catch(() => {});
  expect(
    await creditStatus({ ...env, FUNDED_INFERENCE: "0" }, who, store),
  ).toMatchObject({
    state: "disabled",
    configured: false,
    remainingMicrodollars: 0,
  });
});

test("context/request bounds reject oversized input and preserve only recent plain text", async () => {
  const turns = Array.from({ length: 30 }, (_, i) => ({
    role: "user" as const,
    content: `message-${i}`,
  }));
  expect(boundContext(turns)).toHaveLength(LIMITS.messages);
  expect(boundContext(turns)[0].content).toBe("message-18");
  expect(() =>
    boundContext([{ role: "user", content: "a".repeat(20_000) }]),
  ).toThrow();
  expect(() =>
    boundContext([{ role: "user", content: "😀".repeat(1_000) }], true),
  ).toThrow();
  await expect(
    boundedJson(
      new Request("https://galaxy.example", {
        method: "POST",
        body: "x".repeat(100),
      }),
      10,
    ),
  ).rejects.toMatchObject({ status: 413 });
});

function guestRequest(
  cookie: string,
  text = "hello",
  extra: Record<string, unknown> = {},
  ip = "192.0.2.1",
) {
  return new Request("https://galaxy.example/api/guest", {
    method: "POST",
    headers: {
      cookie,
      origin: "https://galaxy.example",
      "cf-connecting-ip": ip,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      requestId: crypto.randomUUID(),
      text,
      botToken: "fixture-proof",
      ...extra,
    }),
  });
}
const cookieFor = () =>
  guestCookie(signedGuest(guestEnv.GUEST_COOKIE_SECRET)).split(";")[0];

test("signed guest identity is durable and isolated; exactly one basic generation, no auth session or stored chat", async () => {
  let calls = 0;
  let finished: () => void = () => {};
  const completed = new Promise<void>((resolve) => {
    finished = resolve;
  });
  const handlers = guestHandlers({
    env: guestEnv,
    store,
    provider: provider({
      completed: () => finished(),
      called: () => {
        calls += 1;
      },
    }),
    verifyBot: async () => {},
  });
  const first = await handlers.GET(
    new Request("https://galaxy.example/api/guest"),
  );
  const cookie = first.headers.get("set-cookie")?.split(";")[0];
  if (!cookie) throw new Error("no guest cookie");
  expect(await first.json()).toMatchObject({
    state: "available",
    remainingGenerations: 1,
  });
  expect(first.headers.get("set-cookie")).toContain(
    "HttpOnly; Secure; SameSite=Strict",
  );
  const answer = await handlers.POST(guestRequest(cookie));
  expect(answer.status).toBe(200);
  expect(await answer.text()).toContain("fixture answer");
  await completed;
  const second = await handlers.POST(guestRequest(cookie));
  expect(second.status).toBe(429);
  expect(await second.json()).toEqual({ error: { id: "guest_limit_reached" } });
  const state = await handlers.GET(
    new Request("https://galaxy.example/api/guest", { headers: { cookie } }),
  );
  expect(await state.json()).toMatchObject({
    state: "used",
    remainingGenerations: 0,
  });
  expect(calls).toBe(1);
  expect((await database.query("SELECT * FROM chat")).rows).toHaveLength(0);
  expect((await database.query("SELECT * FROM session")).rows).toHaveLength(0);
  expect((await database.query("SELECT * FROM guest_usage")).rows).toHaveLength(
    1,
  );
});

test("guest requests deny tampered cookies, foreign origins, files/tools/models, and bot failures", async () => {
  let calls = 0;
  const handlers = guestHandlers({
    env: guestEnv,
    store,
    provider: provider({
      called: () => {
        calls += 1;
      },
    }),
    verifyBot: async () => {
      throw new Error("bot rejected");
    },
  });
  const cookie = cookieFor();
  for (const extra of [
    { model: "advanced/model" },
    { tools: [] },
    { files: [] },
  ])
    expect(
      (await handlers.POST(guestRequest(cookie, "hi", extra))).status,
    ).toBe(400);
  expect(
    (await handlers.POST(guestRequest(`${cookie.slice(0, -1)}x`))).status,
  ).toBe(403);
  const foreign = guestRequest(cookie);
  foreign.headers.set("origin", "https://other.example");
  expect((await handlers.POST(foreign)).status).toBe(403);
  expect((await handlers.POST(guestRequest(cookie))).status).toBe(403);
  expect(calls).toBe(0);
  expect(guestId(new Headers({ cookie }), "different-secret")).toBeUndefined();
  const disabled = guestHandlers({ env, store });
  expect(
    await (
      await disabled.GET(new Request("https://galaxy.example/api/guest"))
    ).json(),
  ).toMatchObject({ state: "disabled", remainingGenerations: 0 });
});

test("guest network attempt limits survive cookie resets and concurrent requests", async () => {
  const handlers = guestHandlers({
    env: guestEnv,
    store,
    provider: provider(),
    verifyBot: async () => {
      throw new Error("bot rejected");
    },
  });
  for (let i = 0; i < 3; i += 1) await handlers.POST(guestRequest(cookieFor()));
  const denied = await handlers.POST(guestRequest(cookieFor()));
  expect(denied.status).toBe(429);
  expect(await denied.json()).toEqual({ error: { id: "guest_rate_limited" } });
  const network = guestNetwork(
    new Headers({ "cf-connecting-ip": "192.0.2.2" }),
    guestEnv.GUEST_COOKIE_SECRET,
  );
  const attempts = await Promise.allSettled(
    Array.from({ length: 8 }, () => store.guestAttempt(network.key)),
  );
  expect(attempts.filter((item) => item.status === "fulfilled")).toHaveLength(
    3,
  );
});

test("real installed SDK wire path disables retries/fallback/search/reasoning and settles a local SSE receipt", async () => {
  let calls = 0;
  let sent: unknown;
  const fixtureFetch: typeof fetch = Object.assign(
    async (_input: unknown, init?: RequestInit) => {
      calls += 1;
      sent = JSON.parse(String(init?.body));
      const chunks = [
        {
          id: "fixture-response",
          object: "chat.completion.chunk",
          created: 1,
          model: price.model,
          choices: [
            {
              index: 0,
              delta: { role: "assistant", content: "hello" },
              finish_reason: null,
            },
          ],
        },
        {
          id: "fixture-response",
          object: "chat.completion.chunk",
          created: 1,
          model: price.model,
          choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
          usage: {
            prompt_tokens: 10,
            completion_tokens: 2,
            total_tokens: 12,
            completion_tokens_details: { reasoning_tokens: 0 },
            cost: 0.000003,
          },
        },
      ];
      return new Response(
        chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("") +
          "data: [DONE]\n\n",
        { headers: { "content-type": "text/event-stream" } },
      );
    },
    { preconnect: fetch.preconnect },
  );
  const who = actor();
  const result = await startFundedStream({
    env,
    actor: who,
    store,
    idempotencyKey: crypto.randomUUID(),
    turns: [{ role: "user", content: "hi" }],
    provider: openRouterProvider(env, fixtureFetch),
  });
  const reader = result.stream.getReader();
  while (!(await reader.read()).done) {}
  await result.completion;
  expect(calls).toBe(1);
  expect(sent).toMatchObject({
    model: price.model,
    max_tokens: 512,
    reasoning: { enabled: false, effort: "none" },
    provider: {
      only: [price.provider],
      allow_fallbacks: false,
      require_parameters: true,
      max_price: { prompt: 1, completion: 2, request: 0 },
    },
  });
  expect(sent).not.toHaveProperty("tools");
  expect(sent).not.toHaveProperty("plugins");
  expect((await store.status(who)).daily).toBe(3);
});

test("restarting the service preserves crash holds and only releases a durable pre-entry reservation", async () => {
  const who = actor();
  const date = new Date("2026-10-31T23:59:59Z");
  const next = new Date("2026-11-01T00:00:01Z");
  const reserved = await reserve(who, 100_000, { now: date });
  const restarted = new CreditStore(db);
  expect(await restarted.status(who, next)).toMatchObject({
    daily: 100_000,
    monthly: 100_000,
    actorActive: 1,
  });
  await restarted.finish(reserved.id, who, { kind: "before_entry" });
  await expect(store.enter(reserved.id, who)).rejects.toMatchObject({
    id: "request_already_processed",
  });
  expect((await restarted.status(who, next)).daily).toBe(0);
  const entered = await reserve(who, 100_000, { now: date });
  await store.enter(entered.id, who);
  expect((await restarted.operatorPending()).length).toBe(1);
  await restarted.finish(entered.id, who, { kind: "before_entry" });
  expect((await restarted.status(who, next)).daily).toBe(100_000);
});

test("observed incurred costs cannot be released by cancellation or a smaller later settlement", async () => {
  const who = actor();
  const row = await reserve(who, 20_000);
  await store.enter(row.id, who);
  await store.finish(row.id, who, {
    kind: "unknown",
    incurredMicrodollars: 5_000,
    evidence: "partial-provider-receipt",
  });
  await store.finish(row.id, who, { kind: "before_entry" });
  expect((await store.status(who)).daily).toBe(20_000);
  await expect(
    store.finish(row.id, who, {
      kind: "known",
      microdollars: 4_999,
      evidence: "smaller-receipt",
      usage: {},
    }),
  ).rejects.toMatchObject({ id: "settlement_below_incurred" });
  expect((await store.status(who)).daily).toBe(20_000);
  await store.finish(row.id, who, {
    kind: "known",
    microdollars: 5_000,
    evidence: "final-provider-receipt",
    usage: {},
  });
  expect((await store.status(who)).daily).toBe(5_000);
});

test("unexpected reasoning or token counts stop funding and retain at least the observed bill", async () => {
  const who = actor();
  const reported = usage(0.1);
  reported.outputTokens = 600;
  reported.raw = { prompt_tokens: 10, completion_tokens: 600, cost: 0.1 };
  const result = await startFundedStream({
    env,
    actor: who,
    store,
    idempotencyKey: crypto.randomUUID(),
    turns: [{ role: "user", content: "hello" }],
    provider: provider({ report: reported }),
  });
  await result.stream.cancel();
  await result.completion;
  expect(await store.status(who)).toMatchObject({
    daily: 100_000,
    stopped: true,
  });
  const rows = await database.query<{ incurred_microdollars: number }>(
    "SELECT incurred_microdollars FROM credit_reservation",
  );
  expect(rows.rows[0].incurred_microdollars).toBe(100_000);
});

test("concurrent guest submissions invoke one provider and rate-limit keys normalize IPv6 networks", async () => {
  let calls = 0;
  let finished: () => void = () => {};
  const completed = new Promise<void>((resolve) => {
    finished = resolve;
  });
  const handlers = guestHandlers({
    env: guestEnv,
    store,
    provider: provider({
      completed: () => finished(),
      called: () => {
        calls += 1;
      },
    }),
    verifyBot: async () => {},
  });
  const cookie = cookieFor();
  const results = await Promise.all([
    handlers.POST(guestRequest(cookie)),
    handlers.POST(guestRequest(cookie)),
  ]);
  expect(results.map((result) => result.status).sort()).toEqual([200, 429]);
  await Promise.all(results.map((result) => result.text()));
  await completed;
  expect(calls).toBe(1);
  const key = (ip: string) =>
    guestNetwork(
      new Headers({ "cf-connecting-ip": ip }),
      guestEnv.GUEST_COOKIE_SECRET,
    ).key;
  expect(key("2001:db8::1")).toBe(key("2001:0db8:0:0:abcd::2"));
  expect(key("2001:db8::1")).not.toBe(key("2001:db8:1::1"));
});

test("the installed SDK performs no retry on a local provider failure and keeps its reservation", async () => {
  let calls = 0;
  const fixtureFetch: typeof fetch = Object.assign(
    async () => {
      calls += 1;
      return Response.json(
        { error: { message: "fixture unavailable" } },
        { status: 503 },
      );
    },
    { preconnect: fetch.preconnect },
  );
  const who = actor();
  const result = await startFundedStream({
    env,
    actor: who,
    store,
    idempotencyKey: crypto.randomUUID(),
    turns: [{ role: "user", content: "hello" }],
    provider: openRouterProvider(env, fixtureFetch),
  });
  const reader = result.stream.getReader();
  while (!(await reader.read()).done) {}
  await result.completion;
  expect(calls).toBe(1);
  expect((await store.status(who)).daily).toBe(
    worstCaseMicrodollars(config().price),
  );
});

test("content-filter completions with final SDK receipts settle exact spend without exhausting concurrency", async () => {
  let calls = 0;
  const fixtureFetch: typeof fetch = Object.assign(
    async () => {
      calls += 1;
      const chunk = {
        id: `moderated-${calls}`,
        object: "chat.completion.chunk",
        created: 1,
        model: price.model,
        choices: [{ index: 0, delta: {}, finish_reason: "content_filter" }],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 0,
          total_tokens: 10,
          completion_tokens_details: { reasoning_tokens: 0 },
          cost: 0.00001,
        },
      };
      return new Response(
        `data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`,
        { headers: { "content-type": "text/event-stream" } },
      );
    },
    { preconnect: fetch.preconnect },
  );
  const who = actor();
  for (let index = 0; index < 2; index += 1) {
    const result = await startFundedStream({
      env,
      actor: who,
      store,
      idempotencyKey: crypto.randomUUID(),
      turns: [{ role: "user", content: "hello" }],
      provider: openRouterProvider(env, fixtureFetch),
    });
    const reader = result.stream.getReader();
    while (!(await reader.read()).done) {}
    await result.completion;
  }
  expect(calls).toBe(2);
  expect(await store.status(who)).toMatchObject({
    daily: 20,
    actorActive: 0,
    globalActive: 0,
    stopped: false,
  });
  const rows = await database.query<{ state: string }>(
    "SELECT state FROM credit_reservation",
  );
  expect(rows.rows.map((row) => row.state)).toEqual(["settled", "settled"]);
});
