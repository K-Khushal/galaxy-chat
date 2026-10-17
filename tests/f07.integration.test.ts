import { expect, mock, onTestFinished, spyOn, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { setImmediate } from "node:timers/promises";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { makeSignature } from "better-auth/crypto";
import { sql } from "drizzle-orm";
import type { ByokProvider, ByokView } from "../lib/byok/contract";
import type { PostRequestBody } from "../lib/schema/chat/chat";
import { rejectionOf } from "./helpers/rejection";

mock.module("server-only", () => ({}));
const { closeDb, requireDb } = await import("../lib/db/client");
const { getAuth, resetAuthCache } = await import("../lib/auth/server");
const settings = await import("../app/api/providers/route");
const { POST: chatPost } = await import("../app/(chat)/api/chat/route");
const { GET: exportGet } = await import(
  "../app/(chat)/api/account/export/route"
);
const { DELETE: accountDelete } = await import(
  "../app/(chat)/api/account/route"
);
const { readBranches } = await import("../lib/actions/chat/branches");
const { ByokStore } = await import("../lib/byok/store");
const { sealKey, openKey, keyring } = await import("../lib/byok/crypto");
const { configuredModels, byokCatalog, resourceActor } = await import(
  "../lib/byok/config"
);
const { startByokStream } = await import("../lib/byok/service");
const secret = "f07-session-fixture-secret-minimum-32-chars";
const userKey = "f07-nonfunctional-user-key-never-sent-1111";
const gatewayKey = "f07-nonfunctional-gateway-key-never-sent-2222";
const platformKey = "platform-key-must-never-be-used-for-byok";
const ring = {
  v1: Buffer.alloc(32, 1).toString("base64"),
  v2: Buffer.alloc(32, 2).toString("base64"),
};
const model = (adapter: ByokProvider, extras = {}) => ({
  id: `fixture-${adapter}`,
  name: `Fixture ${adapter}`,
  adapter,
  model: "fixture/text",
  provider: "fixture-host",
  verified: true,
  expiresAt: "2030-01-01T00:00:00Z",
  capabilities: {
    text: true,
    reasoning: false,
    sources: false,
    files: false,
    tools: false,
    search: false,
  },
  ...extras,
});
const env = {
  BYOK_ENABLED: "1",
  BYOK_RESOURCE_SECRET: "f07-resource-fixture-secret-at-least-32-chars",
  BYOK_ENCRYPTION_KEYS_JSON: JSON.stringify(ring),
  BYOK_ACTIVE_KEY_VERSION: "v1",
  BYOK_MODELS_JSON: JSON.stringify([model("openrouter"), model("gateway")]),
};
type Seen = {
  url: string;
  method: string;
  auth: string | null;
  body: Record<string, unknown> | undefined;
};
async function fixture() {
  const before = { ...process.env };
  const originalFetch = globalThis.fetch;
  await closeDb();
  resetAuthCache();
  const database = await PGlite.create();
  let socket: PGLiteSocketServer | undefined;
  let closing: Promise<void> | undefined;
  let retired = false;
  function assertLive() {
    if (retired) throw new Error("fixture_retired");
  }
  const close = () => {
    if (closing) return closing;
    retired = true;
    closing = (async () => {
      globalThis.fetch = originalFetch;
      await closeDb();
      resetAuthCache();
      await setImmediate();
      await socket?.stop();
      await setImmediate();
      await database.runExclusive(async () => {});
      await database.close();
      for (const key of Object.keys(process.env))
        if (!(key in before)) delete process.env[key];
      Object.assign(process.env, before);
    })();
    return closing;
  };
  onTestFinished(close);
  try {
    for (const name of readdirSync("drizzle")
      .filter((n) => n.endsWith(".sql"))
      .sort())
      await database.exec(readFileSync(`drizzle/${name}`, "utf8"));
    socket = new PGLiteSocketServer({
      db: database,
      host: "127.0.0.1",
      port: 0,
      maxConnections: 1,
    });
    await socket.start();
    assertLive();
    Object.assign(process.env, env, {
      DATABASE_URL: `postgres://postgres:postgres@${socket.getServerConn()}/postgres`,
      BETTER_AUTH_SECRET: secret,
      BETTER_AUTH_URL: "http://127.0.0.1:3000",
      GITHUB_CLIENT_ID: "f07-fixture",
      GITHUB_CLIENT_SECRET: "f07-fixture",
      GITHUB_INVITE_LOGINS: "alice,bob",
      OPENROUTER_API_KEY: platformKey,
      AI_GATEWAY_API_KEY: platformKey,
      FUNDED_INFERENCE: "0",
      FUNDED_KILL_SWITCH: "1",
    });
    await database.exec(
      `INSERT INTO "user"(id,name,email,email_verified,github_login) VALUES ('alice','Alice','alice@example.invalid',true,'alice'),('bob','Bob','bob@example.invalid',true,'bob'); INSERT INTO session(id,token,user_id,expires_at) VALUES ('alice-session','alice-token','alice',now()+interval '1 day'),('bob-session','bob-token','bob',now()+interval '1 day');`,
    );
    const auth = getAuth();
    if (!auth) throw new Error("fixture auth unavailable");
    const context = await auth.$context;
    assertLive();
    async function headers(user = "alice") {
      return new Headers({
        origin: "http://127.0.0.1:3000",
        "content-type": "application/json",
        cookie: `${context.authCookies.sessionToken.name}=${user}-token.${await makeSignature(`${user}-token`, secret)}`,
      });
    }
    const seen: Seen[] = [];
    let respond: (
      call: Seen,
      init?: RequestInit,
    ) => Response | Promise<Response> = () => {
      throw new Error("unexpected fixture provider request");
    };
    globalThis.fetch = Object.assign(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const call = {
          url: String(input),
          method: init?.method ?? "GET",
          auth: new Headers(init?.headers).get("authorization"),
          body: init?.body ? JSON.parse(String(init.body)) : undefined,
        };
        seen.push(call);
        return respond(call, init);
      },
      { preconnect: originalFetch.preconnect },
    );
    const db = requireDb();
    const store = new ByokStore(db);
    // PGlite has one backend session, including its direct API. After handlers
    // start, every fixture query must share postgres.js's max:1 queue; a direct
    // engine query can replace a socket transaction's unnamed statement.
    const testDatabase = {
      async query<T extends Record<string, unknown> = Record<string, unknown>>(
        text: string,
        parameters: (string | number | boolean | null)[] = [],
      ) {
        assertLive();
        return {
          rows: Array.from(await db.$client.unsafe<T[]>(text, parameters)),
        };
      },
      async exec(text: string) {
        assertLive();
        await db.$client.unsafe(text).simple();
      },
    };

    async function request(
      path: string,
      method = "GET",
      value?: unknown,
      user = "alice",
    ) {
      assertLive();
      const requestHeaders = await headers(user);
      assertLive();
      return new Request(`http://127.0.0.1:3000${path}`, {
        method,
        headers: requestHeaders,
        ...(value === undefined ? {} : { body: JSON.stringify(value) }),
      });
    }
    async function list(user = "alice") {
      return (await (
        await settings.GET(
          await request("/api/providers", "GET", undefined, user),
        )
      ).json()) as ByokView;
    }
    async function save(
      provider: ByokProvider,
      key = provider === "gateway" ? gatewayKey : userKey,
      user = "alice",
      revision: string | null = null,
    ) {
      const response = await settings.PUT(
        await request(
          "/api/providers",
          "PUT",
          { provider, key, revision },
          user,
        ),
      );
      expect(response.status).toBe(200);
      const credential = ((await response.json()) as ByokView).credentials.find(
        (c) => c.provider === provider,
      );
      if (!credential) throw new Error("fixture credential missing");
      return credential;
    }
    async function chat(value: PostRequestBody, signal?: AbortSignal) {
      const req = await request("/api/chat", "POST", value);
      assertLive();
      return chatPost(new Request(req, { signal }));
    }
    async function operations() {
      assertLive();
      return Array.from(
        await db.execute<{ id: string; state: string }>(
          sql`SELECT id,state FROM byok_operation ORDER BY created_at`,
        ),
      );
    }
    async function untilDone(id: string) {
      for (let i = 0; i < 100; i++) {
        const op = (await operations()).find((o) => o.id === id);
        if (op && !["reserved", "entered"].includes(op.state)) return op;
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      throw new Error("fixture drain did not finish");
    }
    return {
      database: testDatabase,
      close,
      store,
      headers,
      request,
      list,
      save,
      chat,
      operations,
      untilDone,
      seen,
      respond: (fn: typeof respond) => {
        respond = fn;
      },
    };
  } catch (error) {
    await close();
    throw error;
  }
}
function body(overrides: Partial<PostRequestBody> = {}): PostRequestBody {
  const id = crypto.randomUUID();
  return {
    id,
    branchId: id,
    requestId: crypto.randomUUID(),
    action: "send",
    funding: "openrouter",
    model: "fixture-openrouter",
    webSearch: false,
    visibility: "private",
    message: {
      id: crypto.randomUUID(),
      role: "user",
      parts: [{ type: "text", text: "fixture question" }],
    },
    ...overrides,
  };
}
function openrouterSse(
  mode: "success" | "incomplete" | "slow" = "success",
  onRelease?: (finish: () => void) => void,
  signal?: AbortSignal,
) {
  const start = {
    id: "fixture-response",
    object: "chat.completion.chunk",
    created: 1,
    model: "fixture/text",
    choices: [
      {
        index: 0,
        delta: { role: "assistant", content: "fixture answer" },
        finish_reason: null,
      },
    ],
  };
  const end = {
    ...start,
    choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
    usage: { prompt_tokens: 8, completion_tokens: 2, total_tokens: 10 },
  };
  const encode = (v: unknown) =>
    new TextEncoder().encode(`data: ${JSON.stringify(v)}\n\n`);
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encode(start));
        const finish = () => {
          controller.enqueue(encode(end));
          controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
          controller.close();
        };
        if (mode === "slow") {
          onRelease?.(finish);
          signal?.addEventListener(
            "abort",
            () => controller.error(new DOMException("aborted", "AbortError")),
            { once: true },
          );
        } else if (mode === "incomplete") controller.close();
        else finish();
      },
    }),
    { headers: { "content-type": "text/event-stream" } },
  );
}
function gatewaySse(parts: unknown[] = [], warnings: unknown[] = []) {
  return new Response(
    [
      { type: "stream-start", warnings },
      ...parts,
      { type: "text-start", id: "text" },
      { type: "text-delta", id: "text", delta: "gateway fixture" },
      { type: "text-end", id: "text" },
      {
        type: "finish",
        finishReason: { unified: "stop", raw: "stop" },
        usage: {
          inputTokens: { total: 8, noCache: 8, cacheRead: 0, cacheWrite: 0 },
          outputTokens: { total: 2, text: 2, reasoning: 0 },
        },
      },
    ]
      .map((c) => `data: ${JSON.stringify(c)}\n\n`)
      .join(""),
    { headers: { "content-type": "text/event-stream" } },
  );
}

test("F07 AEAD binds owner, provider, revision and version; rotation and malformed secrets fail closed", () => {
  const binding = {
    userId: "alice",
    provider: "openrouter" as const,
    revision: crypto.randomUUID(),
  };
  const sealed = sealKey(userKey, binding, env);
  expect(openKey(sealed, binding, env)).toBe(userKey);
  expect(sealed.ciphertext).not.toContain(userKey);
  for (const altered of [
    { ...binding, userId: "bob" },
    { ...binding, provider: "gateway" as const },
    { ...binding, revision: crypto.randomUUID() },
  ])
    expect(() => openKey(sealed, altered, env)).toThrow("byok_key_unavailable");
  expect(() => openKey({ ...sealed, keyVersion: "v2" }, binding, env)).toThrow(
    "byok_key_unavailable",
  );
  expect(() =>
    openKey(
      {
        ...sealed,
        ciphertext: sealed.ciphertext.replace(
          /^./,
          sealed.ciphertext[0] === "A" ? "B" : "A",
        ),
      },
      binding,
      env,
    ),
  ).toThrow("byok_key_unavailable");
  expect(() =>
    openKey({ ...sealed, nonce: "malformed" }, binding, env),
  ).toThrow("byok_key_unavailable");
  const next = { ...env, BYOK_ACTIVE_KEY_VERSION: "v2" };
  expect(openKey(sealed, binding, next)).toBe(userKey);
  const rotated = sealKey(openKey(sealed, binding, next), binding, next);
  expect(rotated.keyVersion).toBe("v2");
  const retired = {
    ...next,
    BYOK_ENCRYPTION_KEYS_JSON: JSON.stringify({ v2: ring.v2 }),
  };
  expect(() => openKey(sealed, binding, retired)).toThrow(
    "byok_key_unavailable",
  );
  expect(openKey(rotated, binding, retired)).toBe(userKey);
  for (const invalid of [
    "",
    JSON.stringify({ v1: "short" }),
    JSON.stringify({ v1: Buffer.alloc(31).toString("base64") }),
  ])
    expect(() =>
      keyring({ ...env, BYOK_ENCRYPTION_KEYS_JSON: invalid }),
    ).toThrow("byok_encryption_unavailable");
  expect(() => sealKey("short", binding, env)).toThrow("invalid_provider_key");
  expect(() => sealKey(`${userKey}\n`, binding, env)).toThrow(
    "invalid_provider_key",
  );
});
test("F07 catalog accepts only explicit unexpired reviewed capabilities and known provider routes", () => {
  expect(byokCatalog({})).toEqual([]);
  expect(configuredModels(env)).toHaveLength(2);
  for (const invalid of [
    model("openrouter", { verified: false }),
    model("openrouter", { expiresAt: "2020-01-01T00:00:00Z" }),
    model("openrouter", {
      capabilities: { ...model("openrouter").capabilities, tools: true },
    }),
    model("openrouter", { providerOptions: { anything: true } }),
  ])
    expect(
      configuredModels({ ...env, BYOK_MODELS_JSON: JSON.stringify([invalid]) }),
    ).toEqual([]);
  expect(
    configuredModels({
      ...env,
      BYOK_MODELS_JSON: JSON.stringify([model("gateway"), model("gateway")]),
    }),
  ).toEqual([]);
});

test("F07 signed-session settings enforce ownership, origin, bounded replacement/deletion and safe export/cascade", async () => {
  const f = await fixture();
  try {
    expect(
      (await settings.GET(new Request("http://127.0.0.1:3000/api/providers")))
        .status,
    ).toBe(401);
    const wrong = await f.request("/api/providers", "PUT", {
      provider: "openrouter",
      key: userKey,
      revision: null,
    });
    wrong.headers.set("origin", "https://foreign.invalid");
    expect((await settings.PUT(wrong)).status).toBe(403);
    expect(
      (
        await settings.PUT(
          await f.request("/api/providers", "PUT", {
            provider: "openrouter",
            key: userKey,
            revision: null,
            userId: "bob",
          }),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await settings.PUT(
          await f.request("/api/providers", "PUT", {
            provider: "openrouter",
            key: "x".repeat(513),
            revision: null,
          }),
        )
      ).status,
    ).toBe(400);
    const saved = await f.save("openrouter");
    await f.save("gateway", gatewayKey, "bob");
    expect(saved.maskedKey).toBe("••••1111");
    expect(saved.testState).toBe("untested");
    const response = await settings.GET(
      await f.request("/api/providers?userId=bob"),
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
    const visible = await response.text();
    expect(visible).not.toContain(userKey);
    expect(visible).not.toContain(gatewayKey);
    expect(visible).not.toContain("ciphertext");
    expect(visible).not.toContain("nonce");
    expect(visible).not.toContain('gateway","maskedKey');
    expect(
      (
        await settings.DELETE(
          await f.request(
            "/api/providers",
            "DELETE",
            { provider: "openrouter", revision: saved.revision },
            "bob",
          ),
        )
      ).status,
    ).toBe(409);
    const next = await f.save(
      "openrouter",
      `${userKey}new9`,
      "alice",
      saved.revision,
    );
    expect(next.revision).not.toBe(saved.revision);
    expect(next.maskedKey).toBe("••••new9");
    expect(
      (
        await settings.PUT(
          await f.request("/api/providers", "PUT", {
            provider: "openrouter",
            key: userKey,
            revision: saved.revision,
          }),
        )
      ).status,
    ).toBe(409);
    const exported = await exportGet(await f.request("/api/account/export"));
    const exportedText = await exported.text();
    for (const forbidden of [
      userKey,
      gatewayKey,
      "ciphertext",
      "nonce",
      "key_version",
    ])
      expect(exportedText).not.toContain(forbidden);
    expect(exportedText).toContain("••••new9");
    expect(exportedText).not.toContain("••••2222");
    const raw = (
      await f.database.query<{ ciphertext: string }>(
        "SELECT ciphertext FROM provider_credential WHERE user_id='alice'",
      )
    ).rows[0];
    expect(raw.ciphertext).not.toContain(userKey);
    const opId = crypto.randomUUID();
    await f.store.reserve({
      id: opId,
      userId: "alice",
      provider: "openrouter",
      kind: "test",
      digest: "a".repeat(64),
      env: process.env,
    });
    expect(
      (await accountDelete(await f.request("/api/account", "DELETE"))).status,
    ).toBe(200);
    expect(
      (
        await f.database.query(
          "SELECT * FROM provider_credential WHERE user_id='alice'",
        )
      ).rows,
    ).toHaveLength(0);
    expect(await f.operations()).toHaveLength(1);
    expect((await f.operations())[0].state).toBe("reserved");
    await f.store.finish(opId, "alice", "before_entry");
    expect((await f.list("bob")).credentials).toHaveLength(1);
    const bob = (await f.list("bob")).credentials[0];
    expect(
      (
        await settings.DELETE(
          await f.request(
            "/api/providers",
            "DELETE",
            { provider: "gateway", revision: bob.revision },
            "bob",
          ),
        )
      ).status,
    ).toBe(200);
    expect((await f.list("bob")).credentials).toHaveLength(0);
    expect(f.seen).toHaveLength(0);
  } finally {
    await f.close();
  }
});

test("F07 Test key uses authenticated metadata GETs only and redacts rejected/unavailable responses", async () => {
  const f = await fixture();
  try {
    let open = await f.save("openrouter");
    const gateway = await f.save("gateway");
    f.respond((call) =>
      call.url === "https://openrouter.ai/api/v1/key"
        ? Response.json({ data: { is_free_tier: false, label: userKey } })
        : call.url === "https://ai-gateway.vercel.sh/v1/credits"
          ? Response.json({ balance: "1.50", total_used: "0.25" })
          : (() => {
              throw new Error("not metadata");
            })(),
    );
    for (const saved of [open, gateway]) {
      const response = await settings.POST(
        await f.request("/api/providers", "POST", {
          provider: saved.provider,
          revision: saved.revision,
        }),
      );
      expect(response.status).toBe(200);
      expect(
        ((await response.json()) as ByokView).credentials.find(
          (c) => c.provider === saved.provider,
        )?.testState,
      ).toBe("valid");
    }
    expect(f.seen.map((c) => [c.url, c.method, c.auth, c.body])).toEqual([
      [
        "https://openrouter.ai/api/v1/key",
        "GET",
        `Bearer ${userKey}`,
        undefined,
      ],
      [
        "https://ai-gateway.vercel.sh/v1/credits",
        "GET",
        `Bearer ${gatewayKey}`,
        undefined,
      ],
    ]);
    f.respond(() =>
      Response.json(
        { error: { message: `invalid ${userKey}` } },
        { status: 401 },
      ),
    );
    const rejected = await settings.POST(
      await f.request("/api/providers", "POST", {
        provider: "openrouter",
        revision: open.revision,
      }),
    );
    const redacted = await rejected.text();
    expect(redacted).not.toContain(userKey);
    expect(
      JSON.parse(redacted).credentials.find(
        (c: { provider: string }) => c.provider === "openrouter",
      ).testState,
    ).toBe("invalid");
    open = await f.save("openrouter", userKey, "alice", open.revision);
    f.respond(() =>
      Response.json({ data: { is_free_tier: false, is_management_key: true } }),
    );
    await settings.POST(
      await f.request("/api/providers", "POST", {
        provider: "openrouter",
        revision: open.revision,
      }),
    );
    expect(
      (await f.list()).credentials.find((c) => c.provider === "openrouter")
        ?.testState,
    ).toBe("invalid");
    f.respond(() => Response.json({ error: gatewayKey }, { status: 503 }));
    await settings.POST(
      await f.request("/api/providers", "POST", {
        provider: "gateway",
        revision: gateway.revision,
      }),
    );
    expect(
      (await f.list()).credentials.find((c) => c.provider === "gateway")
        ?.testState,
    ).toBe("unavailable");
    expect(
      f.seen.every(
        (c) =>
          c.method === "GET" && !c.body && c.auth !== `Bearer ${platformKey}`,
      ),
    ).toBe(true);
    expect((await f.operations()).every((o) => o.state === "complete")).toBe(
      true,
    );
  } finally {
    await f.close();
  }
});

test("F07 real OpenRouter BYOK chat streams once with explicit isolated key, idempotency and no credit rows", async () => {
  const f = await fixture();
  try {
    await f.save("openrouter");
    await f.save("gateway");
    f.respond(() => openrouterSse());
    const value = body();
    const response = await f.chat(value);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("fixture answer");
    expect((await f.untilDone(value.requestId)).state).toBe("complete");
    expect((await readBranches(value.id, "alice")).runs[0].state).toBe(
      "complete",
    );
    expect((await f.chat(value)).status).toBe(409);
    expect(
      (await f.chat({ ...value, funding: "gateway", model: "fixture-gateway" }))
        .status,
    ).toBe(409);
    expect(f.seen).toHaveLength(1);
    expect(f.seen[0].auth).toBe(`Bearer ${userKey}`);
    expect(f.seen[0].body).toMatchObject({
      model: "fixture/text",
      max_tokens: 512,
      provider: {
        only: ["fixture-host"],
        allow_fallbacks: false,
        require_parameters: true,
      },
      reasoning: { enabled: false, effort: "none" },
    });
    expect(
      (await f.database.query("SELECT * FROM credit_reservation")).rows,
    ).toHaveLength(0);
    expect(
      (await f.database.query("SELECT * FROM credit_ledger")).rows,
    ).toHaveLength(0);
    const exported = await exportGet(await f.request("/api/account/export"));
    expect((await exported.json()).byokOperations).toMatchObject([
      {
        id: value.requestId,
        provider: "openrouter",
        kind: "chat",
        state: "complete",
      },
    ]);
    const { funding: _, ...missing } = body();
    expect(
      (await chatPost(await f.request("/api/chat", "POST", missing))).status,
    ).toBe(400);
    expect(
      (
        await chatPost(
          await f.request("/api/chat", "POST", { ...body(), funding: "byok" }),
        )
      ).status,
    ).toBe(400);
    expect((await f.chat(body({ funding: "platform" }))).status).toBe(503);
    expect((await f.chat(body({ model: "unknown" }))).status).toBe(403);
    expect((await f.chat(body({ webSearch: true }))).status).toBe(403);
    process.env.BYOK_ENABLED = "0";
    expect((await f.chat(body())).status).toBe(503);
    expect(f.seen).toHaveLength(1);
  } finally {
    await f.close();
  }
});

test("F07 Gateway uses only its saved key, bounded SDK wire options and declared supplied reasoning/sources", async () => {
  const f = await fixture();
  try {
    await f.save("gateway");
    await f.save("openrouter");
    process.env.BYOK_MODELS_JSON = JSON.stringify([
      model("gateway", {
        capabilities: {
          ...model("gateway").capabilities,
          reasoning: true,
          sources: true,
        },
      }),
    ]);
    f.respond(() =>
      gatewaySse([
        { type: "reasoning-start", id: "r" },
        { type: "reasoning-delta", id: "r", delta: "fixture reasoning" },
        { type: "reasoning-end", id: "r" },
        {
          type: "source",
          sourceType: "url",
          id: "s",
          url: "https://example.invalid/source",
          title: "Fixture source",
        },
      ]),
    );
    const value = body({ funding: "gateway", model: "fixture-gateway" });
    const response = await f.chat(value);
    expect(response.status).toBe(200);
    const wire = await response.text();
    expect(wire).toContain("gateway fixture");
    expect(wire).toContain("fixture reasoning");
    expect(wire).toContain("https://example.invalid/source");
    await f.untilDone(value.requestId);
    expect(f.seen).toHaveLength(1);
    expect(f.seen[0].auth).toBe(`Bearer ${gatewayKey}`);
    expect(f.seen[0].url).toContain("https://ai-gateway.vercel.sh/");
    expect(f.seen[0].body).toMatchObject({
      maxOutputTokens: 512,
      providerOptions: { gateway: { only: ["fixture-host"] } },
    });
    expect(JSON.stringify(f.seen[0].body)).not.toContain("byok");
    process.env.BYOK_MODELS_JSON = env.BYOK_MODELS_JSON;
    const next = body({ funding: "gateway", model: "fixture-gateway" });
    const filtered = await f.chat(next);
    const filteredWire = await filtered.text();
    expect(filteredWire).not.toContain("fixture reasoning");
    expect(filteredWire).not.toContain("https://example.invalid/source");
    await f.untilDone(next.requestId);
    expect(
      (await f.database.query("SELECT * FROM credit_ledger")).rows,
    ).toHaveLength(0);
  } finally {
    await f.close();
  }
});

test("F07 revoked provider credentials stay redacted and never fall back; replacement restores only the new revision", async () => {
  const f = await fixture();
  try {
    const saved = await f.save("openrouter");
    f.respond(() =>
      Response.json(
        { error: { message: `rejected credential ${userKey}`, code: 401 } },
        { status: 401 },
      ),
    );
    const value = body();
    const response = await f.chat(value);
    expect(response.status).toBe(200);
    const wire = await response.text();
    expect(wire).toContain("byok_key_invalid");
    expect(wire).not.toContain(userKey);
    expect(wire).not.toContain(platformKey);
    await f.untilDone(value.requestId);
    expect((await f.list()).credentials[0].testState).toBe("invalid");
    expect((await f.chat(body())).status).toBe(403);
    expect(f.seen).toHaveLength(1);
    await f.save("openrouter", `${userKey}new9`, "alice", saved.revision);
    f.respond(() => openrouterSse());
    const next = body();
    expect(await (await f.chat(next)).text()).toContain("fixture answer");
    await f.untilDone(next.requestId);
    expect(f.seen[1].auth).toBe(`Bearer ${userKey}new9`);
    expect(
      (await f.database.query("SELECT * FROM credit_ledger")).rows,
    ).toHaveLength(0);
  } finally {
    await f.close();
  }
});

test("F07 durable reservation serializes concurrent calls, replacement/delete races and conservative crash recovery", async () => {
  const f = await fixture();
  try {
    let saved = await f.save("openrouter");
    const reserve = (id = crypto.randomUUID(), userId = "alice") =>
      f.store.reserve({
        id,
        userId,
        provider: "openrouter",
        kind: "chat",
        digest: "a".repeat(64),
        env: process.env,
      });
    const id = crypto.randomUUID();
    const attempts = await Promise.allSettled([reserve(id), reserve(id)]);
    expect(attempts.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(
      await rejectionOf(f.store.enter(id, "bob", process.env)),
    ).toMatchObject({ id: "request_already_processed" });
    saved = await f.save(
      "openrouter",
      `${userKey}new9`,
      "alice",
      saved.revision,
    );
    expect(
      await rejectionOf(f.store.enter(id, "alice", process.env)),
    ).toMatchObject({ id: "byok_key_changed" });
    await f.store.finish(id, "alice", "before_entry");
    expect((await f.operations())[0].state).toBe("released");
    const deleted = crypto.randomUUID();
    await reserve(deleted);
    await f.store.delete("alice", "openrouter", saved.revision);
    expect(
      await rejectionOf(f.store.enter(deleted, "alice", process.env)),
    ).toMatchObject({ id: "byok_key_missing" });
    await f.store.finish(deleted, "alice", "before_entry");
    await f.save("openrouter");
    const crash = crypto.randomUUID();
    await reserve(crash);
    await f.store.enter(crash, "alice", process.env);
    expect((await f.list()).state).toBe("busy");
    expect(await rejectionOf(reserve())).toMatchObject({ id: "byok_busy" });
    await f.store.finish(crash, "alice", "unknown");
    await f.store.finish(crash, "alice", "before_entry");
    expect((await f.operations()).find((o) => o.id === crash)?.state).toBe(
      "held",
    );
    expect((await f.list()).state).toBe("busy");
    // Explicit operator recovery after establishing remote completion; no timeout auto-release.
    await f.store.finish(crash, "alice", "terminal");
    await f.store.finish(crash, "alice", "terminal");
    expect((await f.list()).state).toBe("available");
    expect(f.seen).toHaveLength(0);
  } finally {
    await f.close();
  }
});

test("F07 stored rotation, retired versions, tampering and pre-entry config revocation reject without provider execution", async () => {
  const f = await fixture();
  try {
    await f.save("openrouter");
    process.env.BYOK_ACTIVE_KEY_VERSION = "v2";
    await f.store.rotate("alice", "openrouter", process.env);
    process.env.BYOK_ENCRYPTION_KEYS_JSON = JSON.stringify({ v2: ring.v2 });
    const id = crypto.randomUUID();
    await f.store.reserve({
      id,
      userId: "alice",
      provider: "openrouter",
      kind: "chat",
      digest: "a".repeat(64),
      env: process.env,
    });
    expect(await f.store.enter(id, "alice", process.env)).toBe(userKey);
    await f.store.finish(id, "alice", "terminal");
    await f.database.exec(
      "UPDATE provider_credential SET key_version='v1' WHERE user_id='alice'",
    );
    const retired = await f.chat(body());
    expect(retired.status).toBe(503);
    expect(await retired.text()).not.toContain(userKey);
    await f.database.exec(
      "UPDATE provider_credential SET key_version='v2',ciphertext='tampered' WHERE user_id='alice'",
    );
    const tampered = await f.chat(body());
    expect(tampered.status).toBe(503);
    expect((await f.list()).state).toBe("available");
    await f.store.save(
      "alice",
      "openrouter",
      userKey,
      process.env,
      (await f.list()).credentials[0].revision,
    );
    const revoked = startByokStream({
      userId: "alice",
      provider: "openrouter",
      model: "fixture-openrouter",
      idempotencyKey: crypto.randomUUID(),
      turns: [{ role: "user", content: "fixture" }],
      env: process.env,
      beforeProvider: async () => {
        process.env.BYOK_ENABLED = "0";
      },
    });
    expect(await rejectionOf(revoked)).toMatchObject({
      id: "byok_key_unavailable",
    });
    expect(f.seen).toHaveLength(0);
    expect(
      (await f.operations()).every((o) =>
        ["complete", "released"].includes(o.state),
      ),
    ).toBe(true);
  } finally {
    await f.close();
  }
});

test("F07 BYOK disconnect still persists; cancellation/truncation hold resources and never debit platform money", async () => {
  const f = await fixture();
  try {
    await f.save("openrouter");
    let release = () => {};
    f.respond((_call, init) =>
      openrouterSse(
        "slow",
        (finish) => {
          release = finish;
        },
        init?.signal ?? undefined,
      ),
    );
    const value = body();
    const response = await f.chat(value);
    const reader = response.body?.getReader();
    if (!reader) throw new Error("missing stream");
    let wire = "";
    while (!wire.includes("fixture answer")) {
      const part = await reader.read();
      wire += new TextDecoder().decode(part.value);
    }
    void reader.cancel();
    release();
    await f.untilDone(value.requestId);
    for (
      let i = 0;
      i < 100 &&
      (await readBranches(value.id, "alice")).runs[0].state === "pending";
      i++
    )
      await new Promise((resolve) => setTimeout(resolve, 5));
    expect((await readBranches(value.id, "alice")).messages).toHaveLength(2);
    const stopped = body();
    const controller = new AbortController();
    const stopping = await f.chat(stopped, controller.signal);
    const read = stopping.body?.getReader();
    if (!read) throw new Error("missing stream");
    let partial = "";
    while (!partial.includes("fixture answer")) {
      const part = await read.read();
      partial += new TextDecoder().decode(part.value);
    }
    controller.abort();
    while (!(await read.read()).done) {}
    expect((await f.untilDone(stopped.requestId)).state).toBe("held");
    expect((await readBranches(stopped.id, "alice")).runs[0].state).toBe(
      "stopped",
    );
    expect((await f.chat(body())).status).toBe(429);
    await f.store.finish(stopped.requestId, "alice", "terminal");
    f.respond(() => openrouterSse("incomplete"));
    const truncated = body();
    await (await f.chat(truncated)).text();
    expect((await f.untilDone(truncated.requestId)).state).toBe("held");
    expect((await readBranches(truncated.id, "alice")).runs[0].state).toBe(
      "error",
    );
    expect(
      (await f.database.query("SELECT * FROM credit_reservation")).rows,
    ).toHaveLength(0);
    expect(
      (await f.database.query("SELECT * FROM credit_ledger")).rows,
    ).toHaveLength(0);
  } finally {
    await f.close();
  }
});

test("F07 BYOK resource policy enforces durable hourly/daily/global/lifetime limits and pre-entry abort", async () => {
  const f = await fixture();
  try {
    await f.save("openrouter");
    const controller = new AbortController();
    controller.abort();
    const value = body();
    expect((await f.chat(value, controller.signal)).status).toBe(499);
    expect((await f.operations())[0].state).toBe("released");
    expect(f.seen).toHaveLength(0);
    await f.database.exec(
      `INSERT INTO byok_operation(id,actor_key,provider,credential_revision,kind,digest,state) SELECT 'hour-'||n,'${resourceActor("alice", process.env)}','openrouter','fixture','test','fixture','complete' FROM generate_series(1,30) n;`,
    );
    expect((await f.chat(body())).status).toBe(429);
    expect((await f.list()).state).toBe("limited");
    await f.database.exec("DELETE FROM byok_operation");
    await f.database.exec(
      `INSERT INTO byok_operation(id,actor_key,provider,credential_revision,kind,digest,state,created_at) SELECT 'day-'||n,'${resourceActor("alice", process.env)}','openrouter','fixture','test','fixture','complete',date_trunc('day',now()) FROM generate_series(1,200) n;`,
    );
    expect((await f.list()).state).toBe("limited");
    await f.database.exec("DELETE FROM byok_operation");
    await f.database.exec(
      `INSERT INTO byok_operation(id,actor_key,provider,credential_revision,kind,digest,state) SELECT 'global-'||n,'${resourceActor("bob", process.env)}','gateway','fixture','test','fixture','complete' FROM generate_series(1,5000) n;`,
    );
    expect((await f.list()).state).toBe("limited");
    await f.database.exec("DELETE FROM byok_operation");
    await f.database.exec(
      `INSERT INTO byok_operation(id,actor_key,provider,credential_revision,kind,digest,state,created_at) SELECT 'retained-'||n,'${resourceActor("alice", process.env)}','openrouter','fixture','test','fixture','complete',timestamp '2020-01-01' FROM generate_series(1,10000) n;`,
    );
    expect((await f.list()).state).toBe("limited");
    expect(f.seen).toHaveLength(0);
  } finally {
    await f.close();
  }
});

for (const funding of ["openrouter", "gateway"] as const) {
  test(`F07 ${funding} preserves edit/regenerate/retry branches, ownership and the two message slots`, async () => {
    const f = await fixture();
    try {
      for (const provider of ["openrouter", "gateway"] as const)
        await f.save(provider);
      await f.save("openrouter", `${userKey}bob9`, "bob");
      f.respond((call) =>
        call.url.startsWith("https://openrouter.ai/")
          ? openrouterSse()
          : gatewaySse(),
      );
      async function answer(value: PostRequestBody) {
        const response = await f.chat(value);
        expect(response.status).toBe(200);
        await response.text();
        await f.untilDone(value.requestId);
        return readBranches(
          value.id,
          "alice",
          value.action === "send" ? value.branchId : value.requestId,
        );
      }
      const original = body({ funding, model: `fixture-${funding}` });
      const saved = await answer(original);
      const edit = body({
        funding,
        model: original.model,
        id: original.id,
        branchId: original.id,
        action: "edit",
        anchorId: original.message.id,
        message: {
          id: crypto.randomUUID(),
          role: "user",
          parts: [{ type: "text", text: "edited fixture question" }],
        },
      });
      const edited = await answer(edit);
      expect(edited.messages[0].parts).toEqual(edit.message.parts);
      const regen = body({
        funding,
        model: original.model,
        id: original.id,
        branchId: original.id,
        action: "regenerate",
        anchorId: saved.messages[1].id,
      });
      expect((await answer(regen)).messages[0].parts).toEqual(
        original.message.parts,
      );
      const retry = body({
        funding,
        model: original.model,
        id: original.id,
        branchId: edit.requestId,
        action: "retry",
        anchorId: edited.messages[0].id,
      });
      expect((await answer(retry)).messages[0].parts).toEqual(
        edit.message.parts,
      );
      expect((await readBranches(original.id, "alice")).messages).toEqual(
        saved.messages,
      );
      const other = await chatPost(
        await f.request(
          "/api/chat",
          "POST",
          body({ id: original.id, branchId: original.id }),
          "bob",
        ),
      );
      expect(other.status).toBe(404);
      const snapshot = Array.from({ length: 499 }, (_, index) => ({
        id: crypto.randomUUID(),
        role: index % 2 === 0 ? "user" : "assistant",
        parts: [{ type: "text", text: `fixture ${index}` }],
      }));
      await f.database.query(
        "UPDATE chat_branch SET messages=$1::jsonb WHERE id=$2",
        [JSON.stringify(snapshot), original.id],
      );
      const calls = f.seen.length;
      expect(
        (
          await f.chat(
            body({
              funding,
              model: original.model,
              id: original.id,
              branchId: original.id,
            }),
          )
        ).status,
      ).toBe(400);
      expect(f.seen).toHaveLength(calls);
      const shorter = body({
        funding,
        model: original.model,
        id: original.id,
        branchId: original.id,
        action: "regenerate",
        anchorId: snapshot[498].id,
      });
      expect((await answer(shorter)).messages).toHaveLength(500);
      expect((await readBranches(original.id, "alice")).messages).toHaveLength(
        499,
      );
      expect(
        (await f.database.query("SELECT * FROM credit_ledger")).rows,
      ).toHaveLength(0);
    } finally {
      await f.close();
    }
  });
}

test("F07 a late metadata rejection cannot invalidate a replacement key or another owner's key", async () => {
  const f = await fixture();
  try {
    const saved = await f.save("openrouter");
    await f.save("openrouter", `${userKey}bob9`, "bob");
    let release: (response: Response) => void = () => {};
    let entered: () => void = () => {};
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    f.respond(() => {
      entered();
      return new Promise<Response>((resolve) => {
        release = resolve;
      });
    });
    const pending = settings.POST(
      await f.request("/api/providers", "POST", {
        provider: "openrouter",
        revision: saved.revision,
      }),
    );
    await started;
    const replaced = await f.save(
      "openrouter",
      `${userKey}new9`,
      "alice",
      saved.revision,
    );
    release(Response.json({ error: { message: userKey } }, { status: 401 }));
    const response = await pending;
    expect(response.status).toBe(200);
    expect(await response.text()).not.toContain(userKey);
    const current = (await f.list()).credentials[0];
    expect(current.revision).toBe(replaced.revision);
    expect(current.testState).toBe("untested");
    expect((await f.list("bob")).credentials[0].testState).toBe("untested");
    expect(f.seen).toHaveLength(1);
    expect(f.seen[0].auth).toBe(`Bearer ${userKey}`);
  } finally {
    await f.close();
  }
});

test("F07 database browser roles cannot read or mutate BYOK ciphertext or resource rows", async () => {
  const database = await PGlite.create();
  try {
    await database.exec("CREATE ROLE anon; CREATE ROLE authenticated;");
    for (const file of readdirSync("drizzle")
      .filter((name) => name.endsWith(".sql"))
      .sort())
      await database.exec(readFileSync(`drizzle/${file}`, "utf8"));
    const result = await database.query<{ allowed: boolean }>(
      "SELECT has_table_privilege('anon','provider_credential','SELECT') OR has_table_privilege('authenticated','provider_credential','INSERT') OR has_table_privilege('anon','byok_operation','UPDATE') OR has_table_privilege('authenticated','byok_operation','DELETE') AS allowed",
    );
    expect(result.rows[0].allowed).toBe(false);
    const rls = await database.query<{ relrowsecurity: boolean }>(
      "SELECT relrowsecurity FROM pg_class WHERE relname IN ('provider_credential','byok_operation')",
    );
    expect(rls.rows).toHaveLength(2);
    expect(rls.rows.every((r) => r.relrowsecurity)).toBe(true);
  } finally {
    await database.close();
  }
});

test("F07 SDK warning logs and UI streams discard provider diagnostic messages and metadata", async () => {
  const f = await fixture();
  const warnings = spyOn(process, "emitWarning").mockImplementation(() => {});
  try {
    await f.save("gateway");
    f.respond(() =>
      gatewaySse(
        [
          {
            type: "source",
            sourceType: "url",
            id: "s",
            url: "https://example.invalid",
            title: "fixture",
            providerMetadata: { debug: { key: gatewayKey } },
          },
        ],
        [{ type: "other", message: gatewayKey }],
      ),
    );
    const value = body({ funding: "gateway", model: "fixture-gateway" });
    const response = await f.chat(value);
    const wire = await response.text();
    await f.untilDone(value.requestId);
    expect(wire).toContain("gateway fixture");
    expect(wire).not.toContain(gatewayKey);
    expect(wire).not.toContain("debug");
    expect(warnings).not.toHaveBeenCalled();
  } finally {
    warnings.mockRestore();
    await f.close();
  }
});

for (const outcome of ["entered", "held"] as const) {
  test(`F07 deleting an ${outcome} account preserves anonymous global slots without retaining keys or personal records`, async () => {
    const f = await fixture();
    try {
      await f.save("openrouter");
      await f.save("openrouter", `${userKey}bob9`, "bob");
      let release = () => {};
      f.respond((_call, init) =>
        outcome === "entered"
          ? openrouterSse(
              "slow",
              (finish) => {
                release = finish;
              },
              init?.signal ?? undefined,
            )
          : openrouterSse("incomplete"),
      );
      const value = body();
      const response = await f.chat(value);
      if (outcome === "held") {
        await response.text();
        expect((await f.untilDone(value.requestId)).state).toBe("held");
      } else {
        const rows = await f.operations();
        expect(rows.find((row) => row.id === value.requestId)?.state).toBe(
          "entered",
        );
      }
      for (let n = 0; n < 7; n++)
        await f.database.query(
          "INSERT INTO byok_operation(id,actor_key,provider,credential_revision,kind,digest,state) VALUES($1,$2,'gateway','opaque','chat','opaque','held')",
          [
            crypto.randomUUID(),
            resourceActor(`deleted-fixture-${n}`, process.env),
          ],
        );
      expect((await f.list("bob")).state).toBe("busy");
      const deleted = await accountDelete(
        await f.request("/api/account", "DELETE"),
      );
      expect(deleted.status).toBe(200);
      expect(
        (
          await f.database.query(
            "SELECT * FROM provider_credential WHERE user_id='alice'",
          )
        ).rows,
      ).toHaveLength(0);
      expect(
        (await f.database.query("SELECT * FROM chat WHERE user_id='alice'"))
          .rows,
      ).toHaveLength(0);
      expect(
        (await f.database.query("SELECT * FROM session WHERE user_id='alice'"))
          .rows,
      ).toHaveLength(0);
      const lease = (
        await f.database.query<Record<string, unknown>>(
          "SELECT * FROM byok_operation WHERE id=$1",
          [value.requestId],
        )
      ).rows[0];
      expect(lease.state).toBe(outcome);
      expect(lease.actor_key).toBe(resourceActor("alice", process.env));
      expect(lease).not.toHaveProperty("user_id");
      expect(JSON.stringify(lease)).not.toContain(userKey);
      expect(JSON.stringify(lease)).not.toContain("alice");
      expect(JSON.stringify(lease)).not.toContain("fixture question");
      expect(lease).not.toHaveProperty("ciphertext");
      expect((await f.list("bob")).state).toBe("busy");
      const denied = await chatPost(
        await f.request("/api/chat", "POST", body(), "bob"),
      );
      expect(denied.status).toBe(429);
      expect(f.seen).toHaveLength(1);
      expect(
        await rejectionOf(f.store.enter(value.requestId, "alice", process.env)),
      ).toMatchObject({ id: "request_already_processed" });
      if (outcome === "entered") {
        release();
        await response.text();
        expect((await f.untilDone(value.requestId)).state).toBe("complete");
      } else {
        await f.store.finish(value.requestId, "alice", "terminal");
      }
      expect((await f.list("bob")).state).toBe("available");
      f.respond(() => openrouterSse());
      const bob = body();
      const allowed = await chatPost(
        await f.request("/api/chat", "POST", bob, "bob"),
      );
      expect(allowed.status).toBe(200);
      expect(await allowed.text()).toContain("fixture answer");
      await f.untilDone(bob.requestId);
      expect(f.seen).toHaveLength(2);
      expect(f.seen[1].auth).toBe(`Bearer ${userKey}bob9`);
      const actor = resourceActor("alice", process.env);
      expect(
        resourceActor("alice", {
          ...process.env,
          BYOK_ACTIVE_KEY_VERSION: "v2",
        }),
      ).toBe(actor);
      expect(resourceActor("bob", process.env)).not.toBe(actor);
    } finally {
      await f.close();
    }
  });
}
