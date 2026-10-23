import { afterAll, beforeAll, beforeEach, expect, mock, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { makeSignature } from "better-auth/crypto";
import type { PostRequestBody } from "../lib/schema/chat/chat";
import { rejectionOf } from "./helpers/rejection";

mock.module("server-only", () => ({}));
const { createReviewedBudgetPlan, registerReviewedBudgetPlan } = await import(
  "./helpers/platform-budget-fixture"
);
const { getDb, closeDb } = await import("../lib/db/client");
const { getAuth, resetAuthCache } = await import("../lib/auth/server");
const { POST } = await import("../app/(chat)/api/chat/route");
const { GET: branchesGet } = await import("../app/(chat)/api/branches/route");
const { GET: creditsGet } = await import("../app/api/credits/route");
const { deleteOwnedAccount, exportOwnedAccount } = await import(
  "../lib/actions/account/account"
);
const { readBranches, prepareRun, finishRun } = await import(
  "../lib/actions/chat/branches"
);
const { gatewayProvider, knownReceipt } = await import(
  "../lib/credits/service"
);
const { resolveFundingConfig } = await import("../lib/credits/config");
const { modelCatalog } = await import("../lib/ai/catalog");
const { CreditStore, actorFor } = await import("../lib/credits/store");
const secret = "f05-local-fixture-secret-at-least-32-chars";
const price = {
  id: "f05-fixture",
  model: "fixture/basic",
  provider: "fixture",
  expiresAt: "2030-01-01T00:00:00Z",
  inputMicrodollarsPerMillion: 1000000,
  outputMicrodollarsPerMillion: 2000000,
  basicTextOnly: true,
  reasoning: "none",
  allInPrice: true,
};
const f05Plan = createReviewedBudgetPlan(
  {
    month: new Date().toISOString().slice(0, 7),
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
  },
);
const funded = {
  FUNDED_ADAPTER: "openrouter",
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
  PLATFORM_BUDGET_ENABLED: "1",
  PLATFORM_BUDGET_PLAN_JSON: JSON.stringify(f05Plan),
};
let database: PGlite;
let socket: PGLiteSocketServer;
let headers: Headers;
let calls = 0;
let sent: Record<string, unknown>[] = [];
let mode: "success" | "error" | "slow" | "incomplete" = "success";
let release: () => void = () => {};
const originalFetch = globalThis.fetch;
const envBefore = { ...process.env };
beforeAll(async () => {
  await closeDb();
  resetAuthCache();
  database = await PGlite.create();
  for (const file of readdirSync("drizzle")
    .filter((f) => f.endsWith(".sql"))
    .sort())
    await database.exec(readFileSync(`drizzle/${file}`, "utf8"));
  socket = new PGLiteSocketServer({
    db: database,
    host: "127.0.0.1",
    port: 0,
    maxConnections: 1,
  });
  await socket.start();
  Object.assign(process.env, funded, {
    DATABASE_URL: `postgres://postgres:postgres@${socket.getServerConn()}/postgres`,
    BETTER_AUTH_SECRET: secret,
    BETTER_AUTH_URL: "http://127.0.0.1:3000",
    GITHUB_CLIENT_ID: "local-fixture",
    GITHUB_CLIENT_SECRET: "local-fixture",
    GITHUB_INVITE_LOGINS: "f05",
  });
  const db = getDb();
  if (!db) throw new Error("fixture_db_failed");
  await registerReviewedBudgetPlan(db, f05Plan, process.env);
  await database.query(
    `INSERT INTO "user"(id,name,email,email_verified,github_login) VALUES ('f05','Fixture','f05@example.invalid',true,'f05'),('other','Other','other@example.invalid',true,'other')`,
  );
  await database.query(
    `INSERT INTO session(id,token,user_id,expires_at) VALUES ('f05-session','f05-token','f05',now()+interval '1 day')`,
  );
  const auth = getAuth();
  if (!auth) throw new Error("fixture_auth_failed");
  const context = await auth.$context;
  headers = new Headers({
    origin: "http://127.0.0.1:3000",
    "content-type": "application/json",
    cookie: `${context.authCookies.sessionToken.name}=f05-token.${await makeSignature("f05-token", secret)}`,
  });
  globalThis.fetch = Object.assign(
    async (_input: unknown, init?: RequestInit) => {
      calls++;
      sent.push(JSON.parse(String(init?.body)));
      if (mode === "error")
        return new Response(
          JSON.stringify({ error: { message: "fixture failure", code: 500 } }),
          { status: 500, headers: { "content-type": "application/json" } },
        );
      const start = {
        id: "fixture-response",
        object: "chat.completion.chunk",
        created: 1,
        model: price.model,
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
        usage: {
          prompt_tokens: 10,
          completion_tokens: 2,
          total_tokens: 12,
          completion_tokens_details: { reasoning_tokens: 0 },
          cost: 0.000003,
        },
      };
      const encode = (value: unknown) =>
        new TextEncoder().encode(`data: ${JSON.stringify(value)}\n\n`);
      const slow = mode === "slow";
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(encode(start));
            const finish = () => {
              controller.enqueue(encode(end));
              controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
              controller.close();
            };
            if (mode === "incomplete") {
              controller.close();
              return;
            }
            if (slow) {
              release = finish;
              init?.signal?.addEventListener(
                "abort",
                () =>
                  controller.error(new DOMException("aborted", "AbortError")),
                { once: true },
              );
            } else finish();
          },
        }),
        { headers: { "content-type": "text/event-stream" } },
      );
    },
    { preconnect: originalFetch.preconnect },
  );
});
beforeEach(async () => {
  calls = 0;
  sent = [];
  mode = "success";
  Object.assign(process.env, funded);
  // Clear local financial fixtures through TRUNCATE, preserving append-only production triggers.
  await database.exec("TRUNCATE credit_ledger, credit_reservation CASCADE");
  await database.exec(
    "UPDATE funding_control SET stopped=false WHERE id='platform'",
  );
});
afterAll(async () => {
  globalThis.fetch = originalFetch;
  await closeDb();
  resetAuthCache();
  await socket?.stop();
  await database?.close();
  for (const key of Object.keys(process.env))
    if (!(key in envBefore)) delete process.env[key];
  Object.assign(process.env, envBefore);
});
function body(overrides: Partial<PostRequestBody> = {}): PostRequestBody {
  const id = crypto.randomUUID();
  return {
    id,
    branchId: id,
    requestId: crypto.randomUUID(),
    action: "send",
    message: {
      id: crypto.randomUUID(),
      role: "user",
      parts: [{ type: "text", text: "fixture question" }],
    },
    funding: "platform",
    model: price.model,
    webSearch: false,
    visibility: "private",
    ...overrides,
  };
}
function req(value: PostRequestBody, signal?: AbortSignal) {
  return new Request("http://127.0.0.1:3000/api/chat", {
    method: "POST",
    headers,
    body: JSON.stringify(value),
    signal,
  });
}
async function answer(value: PostRequestBody) {
  const response = await POST(req(value));
  expect(response.status).toBe(200);
  const wire = await response.text();
  expect(wire).toContain("fixture answer");
  return response;
}
async function settled() {
  const db = getDb();
  if (!db) throw new Error("no fixture db");
  return new CreditStore(db).status(actorFor("user", "f05", secret));
}

test("F05 actual chat handler streams once, saves reload, and rejects exact/changed duplicate requests", async () => {
  const value = body();
  await answer(value);
  const view = await readBranches(value.id, "f05");
  expect(view.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
  expect(view.runs[0].state).toBe("complete");
  const duplicate = await POST(req(value));
  expect(duplicate.status).toBe(409);
  expect(await duplicate.json()).toEqual({
    error: { id: "request_already_recorded" },
  });
  expect(
    (
      await POST(
        req({
          ...value,
          message: {
            ...value.message,
            parts: [{ type: "text", text: "changed" }],
          },
        }),
      )
    ).status,
  ).toBe(409);
  expect(calls).toBe(1);
  expect(sent[0]).toMatchObject({
    model: price.model,
    max_tokens: 512,
    provider: {
      only: [price.provider],
      allow_fallbacks: false,
      require_parameters: true,
    },
  });
  expect((await settled()).daily).toBe(3);
  const credit = await creditsGet(
    new Request("http://127.0.0.1:3000/api/credits", { headers }),
  );
  expect(credit.headers.get("cache-control")).toBe("no-store");
  expect(await credit.json()).toMatchObject({
    state: "available",
    configured: true,
    remainingMicrodollars: 499997,
    models: [
      {
        id: price.model,
        adapter: "openrouter",
        capabilities: {
          text: true,
          files: false,
          tools: false,
          reasoning: false,
        },
      },
    ],
  });
});
test("F05 edit, regenerate, and retry create owned branches and preserve every original", async () => {
  const original = body();
  await answer(original);
  const saved = await readBranches(original.id, "f05");
  const edit = body({
    id: original.id,
    branchId: original.id,
    action: "edit",
    anchorId: original.message.id,
    message: {
      id: crypto.randomUUID(),
      role: "user",
      parts: [{ type: "text", text: "edited question" }],
    },
  });
  await answer(edit);
  const edited = await readBranches(original.id, "f05", edit.requestId);
  expect(edited.messages[0].parts).toEqual(edit.message.parts);
  expect(edited.branches).toHaveLength(2);
  const regenerate = body({
    id: original.id,
    branchId: original.id,
    action: "regenerate",
    anchorId: saved.messages[1].id,
  });
  await answer(regenerate);
  expect(
    (await readBranches(original.id, "f05", regenerate.requestId)).messages[0]
      .parts,
  ).toEqual(original.message.parts);
  const retry = body({
    id: original.id,
    branchId: edit.requestId,
    action: "retry",
    anchorId: edited.messages[0].id,
  });
  await answer(retry);
  expect((await readBranches(original.id, "f05")).messages).toEqual(
    saved.messages,
  );
  expect(
    (await readBranches(original.id, "f05", retry.requestId)).messages[0].parts,
  ).toEqual(edit.message.parts);
  expect(await rejectionOf(readBranches(original.id, "other"))).toMatchObject({
    id: "not_found",
  });
  expect(
    await rejectionOf(
      prepareRun(body({ id: original.id, branchId: original.id }), "other"),
    ),
  ).toMatchObject({ id: "not_found" });
  const forbidden = await branchesGet(
    new Request(
      `http://127.0.0.1:3000/api/branches?chatId=${original.id}&branchId=foreign`,
      { headers },
    ),
  );
  expect(forbidden.status).toBe(404);
  const exported = await exportOwnedAccount("f05");
  expect(
    exported.branches.filter((b) => b.chatId === original.id),
  ).toHaveLength(4);
  expect((await exportOwnedAccount("other")).branches).toHaveLength(0);
});
test("F05 capability and unknown pricing/provider routes reject before messages or provider execution", async () => {
  expect((await POST(req(body({ webSearch: true })))).status).toBe(403);
  expect((await POST(req(body({ model: "unknown/model" })))).status).toBe(403);
  const unknown = body();
  process.env.FUNDED_BASIC_PRICE_JSON = "";
  expect((await POST(req(unknown))).status).toBe(503);
  expect(await rejectionOf(readBranches(unknown.id, "f05"))).toMatchObject({
    id: "not_found",
  });
  process.env.FUNDED_ADAPTER = "gateway";
  expect(modelCatalog(process.env)).toEqual([]);
  expect((await POST(req(body()))).status).toBe(503);
  process.env.FUNDED_ADAPTER = "";
  expect(() => resolveFundingConfig(process.env)).toThrow(
    "provider_unconfigured",
  );
  expect(calls).toBe(0);
});
test("F05 provider error remains error, preserves its hold, and duplicate retry cannot bill twice", async () => {
  mode = "error";
  const value = body();
  const response = await POST(req(value));
  expect(response.status).toBe(200);
  expect(await response.text()).toContain("provider_failed");
  const view = await readBranches(value.id, "f05");
  expect(view.runs[0].state).toBe("error");
  expect(view.messages).toHaveLength(1);
  expect((await settled()).actorActive).toBe(1);
  expect((await POST(req(value))).status).toBe(409);
  expect(calls).toBe(1);
});
test("F05 disconnect drains independently and persists a single completed assistant", async () => {
  mode = "slow";
  const value = body();
  const response = await POST(req(value));
  const reader = response.body?.getReader();
  if (!reader) throw new Error("no SSE");
  let received = "";
  while (!received.includes("fixture answer")) {
    const chunk = await reader.read();
    if (chunk.done) throw new Error("fixture ended before text");
    received += new TextDecoder().decode(chunk.value);
  }
  void reader.cancel();
  release();
  // Persistence has an independent SSE consumer; synchronize using its observable SQL state.
  for (let i = 0; i < 100; i++) {
    if ((await readBranches(value.id, "f05")).runs[0].state !== "pending")
      break;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  const view = await readBranches(value.id, "f05");
  expect(view.runs[0].state).toBe("complete");
  expect(view.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
  expect(calls).toBe(1);
  expect((await settled()).daily).toBe(3);
});
test("F05 stop aborts the provider, keeps partial text, and retains unknown usage", async () => {
  mode = "slow";
  const value = body();
  const controller = new AbortController();
  const response = await POST(req(value, controller.signal));
  const reader = response.body?.getReader();
  if (!reader) throw new Error("no SSE");
  let wire = "";
  while (!wire.includes("fixture answer")) {
    const part = await reader.read();
    if (part.done) break;
    wire += new TextDecoder().decode(part.value);
  }
  controller.abort();
  while (!(await reader.read()).done) {}
  const view = await readBranches(value.id, "f05");
  expect(view.runs[0].state).toBe("stopped");
  expect(view.messages).toHaveLength(2);
  expect(JSON.stringify(view.messages[1])).toContain("fixture answer");
  expect((await settled()).actorActive).toBe(1);
  expect(calls).toBe(1);
});
test("F05 branch claim is atomic, owner-scoped and terminal persistence is idempotent", async () => {
  const value = body();
  const attempts = await Promise.allSettled([
    prepareRun(value, "f05"),
    prepareRun(value, "f05"),
  ]);
  expect(attempts.filter((a) => a.status === "fulfilled")).toHaveLength(1);
  const assistant = {
    id: crypto.randomUUID(),
    role: "assistant" as const,
    parts: [{ type: "text" as const, text: "saved" }],
  };
  await finishRun(value.requestId, "other", "complete", assistant);
  expect((await readBranches(value.id, "f05")).runs[0].state).toBe("pending");
  await finishRun(value.requestId, "f05", "complete", assistant);
  await finishRun(value.requestId, "f05", "complete", assistant);
  expect((await readBranches(value.id, "f05")).messages).toHaveLength(2);
});
test("F05 explicit Gateway adapter maps installed SDK wire options, never accepts Gateway usage as an OpenRouter receipt", async () => {
  let gatewayCalls = 0;
  let gatewayBody: unknown;
  let unknown = 0;
  const fetcher: typeof fetch = Object.assign(
    async (_input: unknown, init?: RequestInit) => {
      gatewayCalls++;
      gatewayBody = JSON.parse(String(init?.body));
      const chunks = [
        { type: "stream-start", warnings: [] },
        { type: "text-start", id: "text" },
        { type: "text-delta", id: "text", delta: "gateway fixture" },
        { type: "text-end", id: "text" },
        {
          type: "finish",
          finishReason: { unified: "stop", raw: "stop" },
          usage: {
            inputTokens: {
              total: 10,
              noCache: 10,
              cacheRead: 0,
              cacheWrite: 0,
            },
            outputTokens: { total: 2, text: 2, reasoning: 0 },
          },
        },
      ];
      return new Response(
        chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join(""),
        { headers: { "content-type": "text/event-stream" } },
      );
    },
    { preconnect: originalFetch.preconnect },
  );
  const result = gatewayProvider(
    { AI_GATEWAY_API_KEY: "local-fixture-never-sent" },
    fetcher,
  )(resolveFundingConfig(funded), [{ role: "user", content: "hi" }], {
    complete: async () => {
      throw new Error("must not settle unverified Gateway receipt");
    },
    uncertain: () => unknown++,
  });
  const read = result.stream.getReader();
  let wire = "";
  while (true) {
    const part = await read.read();
    if (part.done) break;
    wire += JSON.stringify(part.value);
  }
  await result.consume();
  expect(wire).toContain("gateway fixture");
  expect(gatewayCalls).toBe(1);
  expect(unknown).toBeGreaterThan(0);
  expect(gatewayBody).toMatchObject({
    maxOutputTokens: 512,
    providerOptions: { gateway: { only: ["fixture"] } },
  });
  expect(
    knownReceipt({
      inputTokens: 10,
      outputTokens: 2,
      totalTokens: 12,
      inputTokenDetails: {
        noCacheTokens: 10,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      },
      outputTokenDetails: { textTokens: 2, reasoningTokens: 0 },
      raw: { cost: 0.1 },
    }),
  ).toBeUndefined();
});

test("F05 a truncated provider response is an error even when partial text arrived", async () => {
  mode = "incomplete";
  const value = body();
  const response = await POST(req(value));
  expect(response.status).toBe(200);
  await response.text();
  const view = await readBranches(value.id, "f05");
  expect(view.runs[0].state).toBe("error");
  expect((await settled()).actorActive).toBe(1);
  expect(calls).toBe(1);
});
test("F05 abort before provider entry cannot spend or invoke inference", async () => {
  const controller = new AbortController();
  controller.abort();
  const value = body();
  const response = await POST(req(value, controller.signal));
  expect(response.status).toBe(499);
  expect(calls).toBe(0);
  expect((await settled()).daily).toBe(0);
  expect((await readBranches(value.id, "f05")).runs[0].state).toBe("stopped");
});
test("F05 migration snapshots preserve sub-millisecond order and browser roles have no access", async () => {
  const local = await PGlite.create();
  try {
    for (const file of readdirSync("drizzle")
      .filter((f) => f.endsWith(".sql") && f < "0003")
      .sort())
      await local.exec(readFileSync(`drizzle/${file}`, "utf8"));
    await local.exec(`CREATE ROLE anon; CREATE ROLE authenticated;
   INSERT INTO "user"(id,name,email,email_verified) VALUES ('migration-user','Migration','migration@example.invalid',true);
   INSERT INTO chat(id,user_id,title) VALUES ('migration-chat','migration-user','Migration');
   INSERT INTO chat_message(id,chat_id,user_id,role,parts,attachments,created_at) VALUES
   ('z-earlier','migration-chat','migration-user','user','[{"type":"text","text":"first"}]','[]',timestamp '2026-10-01 00:00:00.100001'),
   ('a-later','migration-chat','migration-user','assistant','[{"type":"text","text":"second"}]','[]',timestamp '2026-10-01 00:00:00.100002');`);
    await local.exec(readFileSync("drizzle/0003_chat_branches.sql", "utf8"));
    const result = await local.query<{ messages: Array<{ id: string }> }>(
      "SELECT messages FROM chat_branch WHERE id='migration-chat'",
    );
    expect(result.rows[0].messages.map((message) => message.id)).toEqual([
      "z-earlier",
      "a-later",
    ]);
    const privileges = await local.query<{ allowed: boolean }>(
      "SELECT has_table_privilege('anon','chat_branch','SELECT') OR has_table_privilege('authenticated','chat_run','INSERT') AS allowed",
    );
    expect(privileges.rows[0].allowed).toBe(false);
  } finally {
    await local.close();
  }
});

test("F05 account deletion cascades owned branches and runs while other owners remain", async () => {
  await database.exec(
    `INSERT INTO "user"(id,name,email,email_verified) VALUES ('branch-deleter','Deleter','branch-delete@example.invalid',true)`,
  );
  const owned = body();
  await prepareRun(owned, "branch-deleter");
  await finishRun(owned.requestId, "branch-deleter", "error");
  await deleteOwnedAccount("branch-deleter");
  expect(
    (
      await database.query(
        "SELECT id FROM chat_branch WHERE user_id='branch-deleter'",
      )
    ).rows,
  ).toHaveLength(0);
  expect(
    (
      await database.query(
        "SELECT id FROM chat_run WHERE user_id='branch-deleter'",
      )
    ).rows,
  ).toHaveLength(0);
  expect(
    (await database.query("SELECT id FROM chat_branch WHERE user_id='f05'"))
      .rows.length,
  ).toBeGreaterThan(0);
});

test("F05 a failed 499-message branch reserves both generation slots and forks use their shorter prefix", async () => {
  const initial = body();
  await prepareRun(initial, "f05");
  await finishRun(initial.requestId, "f05", "error");
  const snapshot = Array.from({ length: 499 }, (_, index) => ({
    id: crypto.randomUUID(),
    role: index % 2 === 0 ? "user" : "assistant",
    parts: [{ type: "text", text: `turn ${index}` }],
  }));
  await database.query(
    "UPDATE chat_branch SET messages=$1::jsonb WHERE id=$2",
    [JSON.stringify(snapshot), initial.id],
  );
  const rejected = body({ id: initial.id, branchId: initial.id });
  const denied = await POST(req(rejected));
  expect(denied.status).toBe(400);
  expect(await denied.json()).toEqual({
    error: { id: "conversation_limit_reached" },
  });
  expect(calls).toBe(0);
  const unchanged = await readBranches(initial.id, "f05");
  expect(unchanged.messages).toHaveLength(499);
  expect(unchanged.runs).toHaveLength(1);
  const regenerated = body({
    id: initial.id,
    branchId: initial.id,
    action: "regenerate",
    anchorId: snapshot[498].id,
  });
  await answer(regenerated);
  expect(
    (await readBranches(initial.id, "f05", regenerated.requestId)).messages,
  ).toHaveLength(500);
  const edited = body({
    id: initial.id,
    branchId: initial.id,
    action: "edit",
    anchorId: snapshot[496].id,
  });
  await answer(edited);
  expect(
    (await readBranches(initial.id, "f05", edited.requestId)).messages,
  ).toHaveLength(498);
  expect((await readBranches(initial.id, "f05")).messages).toHaveLength(499);
  expect(calls).toBe(2);
});
