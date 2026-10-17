import { onTestFinished } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { setImmediate } from "node:timers/promises";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { makeSignature } from "better-auth/crypto";
import type { PostRequestBody } from "../../lib/schema/chat/chat";
export const secret = "f08-local-nonfunctional-secret-at-least-32-characters";
export const privateKey = "f08-nonfunctional-user-provider-key-never-sent-1111";
export const price = {
  id: "f08-fixture",
  model: "fixture/basic",
  provider: "fixture",
  expiresAt: "2030-01-01T00:00:00Z",
  inputMicrodollarsPerMillion: 6_000_000,
  outputMicrodollarsPerMillion: 3_312_500,
  basicTextOnly: true,
  reasoning: "none",
  allInPrice: true,
};
export const env = {
  BETTER_AUTH_SECRET: secret,
  BETTER_AUTH_URL: "https://galaxy.example",
  GITHUB_CLIENT_ID: "f08-fixture",
  GITHUB_CLIENT_SECRET: "f08-fixture",
  GITHUB_INVITE_LOGINS: "alice,bob",
  FUNDED_ADAPTER: "openrouter",
  FUNDED_INFERENCE: "1",
  FUNDED_KILL_SWITCH: "0",
  FUNDED_PROVIDER_LIMITS_VERIFIED: "1",
  OPENROUTER_API_KEY: "f08-platform-key-never-sent",
  CREDIT_ACTOR_SECRET: secret,
  PLATFORM_INFRA_MICRODOLLARS: "0",
  PLATFORM_PROVIDER_FEES_MICRODOLLARS: "0",
  PLATFORM_SAFETY_RESERVE_MICRODOLLARS: "1000000",
  FUNDED_MONTHLY_MICRODOLLARS: "1000000",
  FUNDED_BASIC_PRICE_JSON: JSON.stringify(price),
  GUEST_COOKIE_SECRET: secret,
  GUEST_TURNSTILE_SECRET: "f08-bot-secret-never-sent",
  GUEST_TURNSTILE_SITE_KEY: "local-fixture-site-key",
  GUEST_TRUSTED_PROXY: "cloudflare",
  GUEST_ORIGIN_IS_PROXY_ONLY: "1",
  BYOK_ENABLED: "1",
  BYOK_RESOURCE_SECRET: secret,
  BYOK_ENCRYPTION_KEYS_JSON: JSON.stringify({
    v1: Buffer.alloc(32, 8).toString("base64"),
  }),
  BYOK_ACTIVE_KEY_VERSION: "v1",
  BYOK_MODELS_JSON: JSON.stringify([
    {
      id: "f08-private",
      name: "Local private fixture",
      adapter: "openrouter",
      model: "fixture/private",
      provider: "fixture",
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
    },
  ]),
};
export function chatBody(
  overrides: Partial<PostRequestBody> = {},
): PostRequestBody {
  const id = crypto.randomUUID();
  return {
    id,
    branchId: id,
    requestId: crypto.randomUUID(),
    action: "send",
    message: {
      id: crypto.randomUUID(),
      role: "user",
      parts: [{ type: "text", text: "Local beta acceptance prompt" }],
    },
    funding: "platform",
    model: price.model,
    webSearch: false,
    visibility: "private",
    ...overrides,
  };
}
export async function betaFixture() {
  const { closeDb, requireDb } = await import("../../lib/db/client");
  const { getAuth, resetAuthCache } = await import("../../lib/auth/server");
  const previous = { ...process.env };
  const originalFetch = globalThis.fetch;
  await closeDb();
  resetAuthCache();
  const database = await PGlite.create();
  let socket: PGLiteSocketServer | undefined;
  let closing: Promise<void> | undefined;
  const close = () => {
    if (closing) return closing;
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
        if (!(key in previous)) delete process.env[key];
      Object.assign(process.env, previous);
    })();
    return closing;
  };
  onTestFinished(close);
  try {
    for (const file of readdirSync("drizzle")
      .filter((name) => name.endsWith(".sql"))
      .sort())
      await database.exec(readFileSync(`drizzle/${file}`, "utf8"));
    socket = new PGLiteSocketServer({
      db: database,
      host: "127.0.0.1",
      port: 0,
      maxConnections: 1,
    });
    await socket.start();
    Object.assign(process.env, env, {
      DATABASE_URL: `postgres://postgres:postgres@${socket.getServerConn()}/postgres`,
    });
    const db = requireDb();
    // Every query after socket start shares the application's postgres.js max:1 queue.
    await db.$client
      .unsafe(
        `INSERT INTO "user"(id,name,email,email_verified,github_login) VALUES ('alice','Alice','alice@example.invalid',true,'alice'),('bob','Bob','bob@example.invalid',true,'bob'),('outsider','Outside','outside@example.invalid',true,'outsider')`,
      )
      .simple();
    await db.$client
      .unsafe(
        `INSERT INTO session(id,token,user_id,expires_at) VALUES ('alice-session','alice-token','alice',now()+interval '1 day'),('bob-session','bob-token','bob',now()+interval '1 day'),('outsider-session','outsider-token','outsider',now()+interval '1 day')`,
      )
      .simple();
    const auth = getAuth();
    if (!auth) throw new Error("fixture_auth_unavailable");
    const context = await auth.$context;
    const headers = async (user = "alice") =>
      new Headers({
        origin: env.BETTER_AUTH_URL,
        "content-type": "application/json",
        cookie: `${context.authCookies.sessionToken.name}=${user}-token.${await makeSignature(`${user}-token`, secret)}`,
      });
    const seen: { url: string; authorization: string | null; body: unknown }[] =
      [];
    let cost = 0.1;
    let failure = false;
    let slow = false;
    globalThis.fetch = Object.assign(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        seen.push({
          url: String(input),
          authorization: new Headers(init?.headers).get("authorization"),
          body: init?.body ? JSON.parse(String(init.body)) : undefined,
        });
        if (failure)
          return Response.json(
            {
              error: { message: `${privateKey} secret diagnostic`, code: 500 },
            },
            { status: 500 },
          );
        const start = {
          id: "f08-response",
          object: "chat.completion.chunk",
          created: 1,
          model: price.model,
          choices: [
            {
              index: 0,
              delta: {
                role: "assistant",
                content: "Local beta fixture answer",
              },
              finish_reason: null,
            },
          ],
        };
        const end = {
          ...start,
          choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
          usage: {
            prompt_tokens: 10,
            completion_tokens: 3,
            total_tokens: 13,
            completion_tokens_details: { reasoning_tokens: 0 },
            cost,
          },
        };
        if (slow) {
          let closed = false;
          return new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                controller.enqueue(
                  new TextEncoder().encode(
                    `data: ${JSON.stringify(start)}\n\n`,
                  ),
                );
                init?.signal?.addEventListener(
                  "abort",
                  () => {
                    if (!closed) {
                      closed = true;
                      controller.close();
                    }
                  },
                  { once: true },
                );
              },
              cancel() {
                closed = true;
              },
            }),
            { headers: { "content-type": "text/event-stream" } },
          );
        }
        return new Response(
          `data: ${JSON.stringify(start)}\n\ndata: ${JSON.stringify(end)}\n\ndata: [DONE]\n\n`,
          { headers: { "content-type": "text/event-stream" } },
        );
      },
      { preconnect: originalFetch.preconnect },
    );
    return {
      database,
      db,
      headers,
      seen,
      close,
      cost: (value: number) => {
        cost = value;
      },
      fail: () => {
        failure = true;
      },
      slow: () => {
        slow = true;
      },
      request: async (path: string, body?: unknown, user = "alice") =>
        new Request(`${env.BETTER_AUTH_URL}${path}`, {
          method: body ? "POST" : "GET",
          headers: await headers(user),
          ...(body ? { body: JSON.stringify(body) } : {}),
        }),
    };
  } catch (error) {
    await close();
    throw error;
  }
}
