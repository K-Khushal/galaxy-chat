import { expect, mock, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { NextRequest } from "next/server";
import {
  betaFixture,
  chatBody,
  env,
  privateKey,
  secret,
} from "./helpers/beta-fixture";
import { rejectionOf } from "./helpers/rejection";

mock.module("server-only", () => ({}));
const { guestHandlers } = await import("../lib/credits/guest-handlers");
const { CreditStore, actorFor } = await import("../lib/credits/store");
const { ByokStore } = await import("../lib/byok/store");
const { openKey } = await import("../lib/byok/crypto");
const { POST: chatPost } = await import("../app/(chat)/api/chat/route");
const { GET: creditsGet } = await import("../app/api/credits/route");
const providers = await import("../app/api/providers/route");
const { GET: historyGet } = await import("../app/(chat)/api/history/route");
const { GET: exportGet } = await import(
  "../app/(chat)/api/account/export/route"
);
const { DELETE: deleteAccount } = await import(
  "../app/(chat)/api/account/route"
);
const { signedGuest } = await import("../lib/credits/guest");
const { createGuestClient } = await import("../lib/guest/client");
const { generateChatTitle } = await import("../lib/ai/title");
const { runFundedModelCall } = await import("../lib/ai/funded");
async function waitFor(run: () => Promise<boolean>) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await run()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("local_terminal_state_not_reached");
}

test("F08 real guest SDK transport consumes one generation and cannot enter private APIs before invited sign-in", async () => {
  const f = await betaFixture();
  let cookie = "";
  let verified = 0;
  const handlers = guestHandlers({
    env,
    store: new CreditStore(f.db),
    verifyBot: async (_config, token) => {
      expect(token).toBe("local-bot-token");
      verified++;
    },
  });
  const client = createGuestClient(async (_input, init) => {
    const headers = new Headers(init?.headers);
    headers.set("origin", env.BETTER_AUTH_URL);
    headers.set("cf-connecting-ip", "192.0.2.8");
    if (cookie) headers.set("cookie", cookie);
    const request = new Request(`${env.BETTER_AUTH_URL}/api/guest`, {
      ...init,
      headers,
    });
    const response =
      init?.method === "POST"
        ? await handlers.POST(request)
        : await handlers.GET(request);
    if (response.headers.has("set-cookie"))
      cookie = response.headers.get("set-cookie")?.split(";")[0] ?? "";
    return response;
  });
  const view = await client.status(new AbortController().signal);
  expect(view).toEqual({
    state: "available",
    remainingGenerations: 1,
    siteKey: env.GUEST_TURNSTILE_SITE_KEY,
  });
  const started = performance.now();
  let firstTextMs = 0;
  let answer = "";
  await client.generate(
    {
      requestId: crypto.randomUUID(),
      text: "Local guest prompt",
      botToken: "local-bot-token",
    },
    new AbortController().signal,
    (text) => {
      if (text && !firstTextMs) firstTextMs = performance.now() - started;
      answer = text;
    },
  );
  const completeMs = performance.now() - started;
  expect(answer).toBe("Local beta fixture answer");
  expect(verified).toBe(1);
  expect(f.seen).toHaveLength(1);
  expect(await client.status(new AbortController().signal)).toEqual({
    state: "used",
    remainingGenerations: 0,
  });
  const publicHeaders = { cookie, origin: env.BETTER_AUTH_URL };
  for (const handler of [creditsGet, providers.GET, exportGet])
    expect(
      (
        await handler(
          new Request(`${env.BETTER_AUTH_URL}/api/private`, {
            headers: publicHeaders,
          }),
        )
      ).status,
    ).toBe(401);
  expect(
    (
      await chatPost(
        new Request(`${env.BETTER_AUTH_URL}/api/chat`, {
          method: "POST",
          headers: publicHeaders,
          body: JSON.stringify(chatBody()),
        }),
      )
    ).status,
  ).toBe(401);
  expect(
    (await creditsGet(await f.request("/api/credits", undefined, "outsider")))
      .status,
  ).toBe(403);
  expect((await creditsGet(await f.request("/api/credits"))).status).toBe(200);
  const history = await historyGet(
    new NextRequest(`${env.BETTER_AUTH_URL}/api/history`, {
      headers: await f.headers(),
    }),
  );
  expect((await history.json()).chats).toHaveLength(0);
  expect(await f.db.$client.unsafe(`SELECT id FROM chat_message`)).toHaveLength(
    0,
  );
  expect(
    await generateChatTitle(await f.headers(), {
      id: crypto.randomUUID(),
      role: "user",
      parts: [{ type: "text", text: "  A local title  " }],
    }),
  ).toBe("A local title");
  expect(
    await rejectionOf(
      runFundedModelCall(env, async () => {
        throw new Error("unreserved callback executed");
      }),
    ),
  ).toMatchObject({ id: "funding_reservation_required" });
  expect(f.seen).toHaveLength(1);
  expect(firstTextMs).toBeGreaterThan(0);
  expect(firstTextMs).toBeLessThan(2000);
  console.info(
    `F08 local synthetic SDK first text: ${firstTextMs.toFixed(2)}ms; complete: ${completeMs.toFixed(2)}ms (no provider latency)`,
  );
});

test("F08 five funded credits deplete, global cap blocks another owner, and BYOK plus owned history/export/delete remain isolated", async () => {
  const f = await betaFixture({
    environment: { FUNDED_MONTHLY_MICRODOLLARS: "500000" },
  });
  const ids: string[] = [];
  for (let index = 0; index < 5; index++) {
    const body = chatBody();
    ids.push(body.id);
    const response = await chatPost(await f.request("/api/chat", body));
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("Local beta fixture answer");
    await waitFor(
      async () =>
        (
          await f.db.$client.unsafe(
            `SELECT state FROM chat_run WHERE id='${body.requestId}'`,
          )
        )[0]?.state === "complete",
    );
  }
  const store = new CreditStore(f.db);
  expect((await store.status(actorFor("user", "alice", secret))).daily).toBe(
    500_000,
  );
  expect(
    (await (await creditsGet(await f.request("/api/credits"))).json()).state,
  ).toBe("daily_exhausted");
  expect(
    (await chatPost(await f.request("/api/chat", chatBody()))).status,
  ).toBe(429);
  expect(f.seen).toHaveLength(5);
  process.env.FUNDED_MONTHLY_MICRODOLLARS = "500000";
  expect(
    (await chatPost(await f.request("/api/chat", chatBody(), "bob"))).status,
  ).toBe(429);
  expect(f.seen).toHaveLength(5);
  const saved = await providers.PUT(
    new Request(`${env.BETTER_AUTH_URL}/api/providers`, {
      method: "PUT",
      headers: await f.headers(),
      body: JSON.stringify({
        provider: "openrouter",
        revision: null,
        key: privateKey,
      }),
    }),
  );
  expect(saved.status).toBe(200);
  const privateBody = chatBody({ funding: "openrouter", model: "f08-private" });
  const privateResponse = await chatPost(
    await f.request("/api/chat", privateBody),
  );
  expect(privateResponse.status).toBe(200);
  await privateResponse.text();
  await waitFor(
    async () =>
      (
        await f.db.$client.unsafe(
          `SELECT state FROM chat_run WHERE id='${privateBody.requestId}'`,
        )
      )[0]?.state === "complete",
  );
  expect(f.seen.at(-1)?.authorization).toBe(`Bearer ${privateKey}`);
  expect((await store.status(actorFor("user", "alice", secret))).daily).toBe(
    500_000,
  );
  expect(
    await f.db.$client.unsafe(`SELECT id FROM credit_reservation`),
  ).toHaveLength(5);
  const aliceHistory = await historyGet(
    new NextRequest(`${env.BETTER_AUTH_URL}/api/history`, {
      headers: await f.headers(),
    }),
  );
  expect((await aliceHistory.json()).chats).toHaveLength(7);
  const bobHistory = await historyGet(
    new NextRequest(`${env.BETTER_AUTH_URL}/api/history`, {
      headers: await f.headers("bob"),
    }),
  );
  expect((await bobHistory.json()).chats).toHaveLength(1);
  const exported = await exportGet(await f.request("/api/account/export"));
  const serialized = await exported.text();
  expect(serialized).toContain("Local beta fixture answer");
  expect(serialized).not.toContain(privateKey);
  expect(serialized).not.toContain("ciphertext");
  expect(serialized).not.toContain("nonce");
  const deleted = await deleteAccount(
    new Request(`${env.BETTER_AUTH_URL}/api/account`, {
      method: "DELETE",
      headers: await f.headers(),
      body: JSON.stringify({ confirmation: "DELETE" }),
    }),
  );
  expect(deleted.status).toBe(200);
  expect(
    await f.db.$client.unsafe(`SELECT id FROM chat WHERE user_id='alice'`),
  ).toHaveLength(0);
  expect(
    await f.db.$client.unsafe(`SELECT user_id FROM provider_credential`),
  ).toHaveLength(0);
  expect(
    await f.db.$client.unsafe(`SELECT id FROM credit_reservation`),
  ).toHaveLength(5);
  expect(
    await f.db.$client.unsafe(`SELECT id FROM "user" WHERE id='bob'`),
  ).toHaveLength(1);
});

test("F08 unavailable widget and provider failures stay closed and redact secrets through the real guest client", async () => {
  const f = await betaFixture();
  const store = new CreditStore(f.db);
  for (const siteKey of [undefined, "", "contains whitespace", "<script>"]) {
    const response = await guestHandlers({
      env: { ...env, GUEST_TURNSTILE_SITE_KEY: siteKey },
      store,
    }).GET(new Request(env.BETTER_AUTH_URL));
    const body = await response.json();
    expect(body.state).toBe("disabled");
    expect(body.remainingGenerations).toBe(0);
    expect(body.siteKey).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain(env.GUEST_TURNSTILE_SECRET);
    let botCalls = 0;
    const post = await guestHandlers({
      env: { ...env, GUEST_TURNSTILE_SITE_KEY: siteKey },
      store,
      verifyBot: async () => {
        botCalls++;
      },
    }).POST(
      new Request(`${env.BETTER_AUTH_URL}/api/guest`, {
        method: "POST",
        headers: {
          origin: env.BETTER_AUTH_URL,
          "content-type": "application/json",
          "cf-connecting-ip": "192.0.2.23",
          cookie: `__Host-galaxy-guest=${signedGuest(secret)}`,
        },
        body: JSON.stringify({
          requestId: crypto.randomUUID(),
          text: "Must not enter provider",
          botToken: "otherwise-valid-fixture-proof",
        }),
      }),
    );
    expect(post.status).toBe(503);
    expect(await post.json()).toEqual({ error: { id: "guest_unconfigured" } });
    expect(botCalls).toBe(0);
    expect(f.seen).toHaveLength(0);
  }
  expect(
    await f.db.$client.unsafe("SELECT id FROM credit_reservation"),
  ).toHaveLength(0);
  f.fail();
  const body = chatBody();
  const response = await chatPost(await f.request("/api/chat", body));
  const wire = await response.text();
  expect(wire).not.toContain(privateKey);
  expect(wire).not.toContain("secret diagnostic");
  expect(wire).toContain("provider_failed");
  await waitFor(
    async () =>
      (
        await f.db.$client.unsafe(
          `SELECT state FROM chat_run WHERE id='${body.requestId}'`,
        )
      )[0]?.state === "error",
  );
  expect(
    (await store.status(actorFor("user", "alice", secret))).actorActive,
  ).toBe(1);
  const heldBefore = await f.db.$client.unsafe(
    "SELECT id,state,charged_microdollars FROM credit_reservation",
  );
  const ledgerBefore = await f.db.$client.unsafe(
    "SELECT id,event,microdollars FROM credit_ledger ORDER BY id",
  );
  const callsBefore = f.seen.length;
  // Local rollback rehearsal: disable both funding paths, without releasing unknown work or dropping data.
  process.env.FUNDED_KILL_SWITCH = "1";
  process.env.FUNDED_INFERENCE = "0";
  process.env.BYOK_ENABLED = "0";
  expect(
    (await chatPost(await f.request("/api/chat", chatBody(), "bob"))).status,
  ).toBe(503);
  expect(
    (
      await chatPost(
        await f.request(
          "/api/chat",
          chatBody({ funding: "openrouter", model: "f08-private" }),
          "bob",
        ),
      )
    ).status,
  ).toBe(503);
  expect(
    (
      await (
        await guestHandlers({ env: process.env, store }).GET(
          new Request(env.BETTER_AUTH_URL),
        )
      ).json()
    ).state,
  ).toBe("disabled");
  expect(f.seen).toHaveLength(callsBefore);
  expect(
    await f.db.$client.unsafe(
      "SELECT id,state,charged_microdollars FROM credit_reservation",
    ),
  ).toEqual(heldBefore);
  expect(
    await f.db.$client.unsafe(
      "SELECT id,event,microdollars FROM credit_ledger ORDER BY id",
    ),
  ).toEqual(ledgerBefore);
});

test("F08 local physical backup restores ownership, encrypted credentials, immutable ledger and constraints", async () => {
  const f = await betaFixture();
  await new ByokStore(f.db).save("alice", "openrouter", privateKey, env, null);
  const body = chatBody();
  const response = await chatPost(await f.request("/api/chat", body));
  await response.text();
  await waitFor(
    async () =>
      (
        await f.db.$client.unsafe(
          `SELECT state FROM chat_run WHERE id='${body.requestId}'`,
        )
      )[0]?.state === "complete",
  );
  const snapshotStarted = performance.now();
  // Drains finish writes before the engine-level physical snapshot. No direct SQL runs alongside the socket.
  await f.db.$client.unsafe("SELECT 1");
  const snapshot = await f.database.dumpDataDir();
  const restored = await PGlite.create({ loadDataDir: snapshot });
  try {
    // This restored engine has no socket/client: direct API owns its one queue.
    const chats = await restored.query<{ user_id: string }>(
      "SELECT user_id FROM chat",
    );
    expect(chats.rows.map((row) => row.user_id)).toEqual(["alice"]);
    expect(
      (await restored.query("SELECT id FROM chat WHERE user_id='bob'")).rows,
    ).toHaveLength(0);
    const credentials = await restored.query<{
      key_version: string;
      nonce: string;
      ciphertext: string;
      revision: string;
    }>(
      "SELECT key_version,nonce,ciphertext,revision FROM provider_credential WHERE user_id='alice'",
    );
    const row = credentials.rows[0];
    expect(row).toBeDefined();
    expect(JSON.stringify(row)).not.toContain(privateKey);
    expect(
      openKey(
        {
          keyVersion: row.key_version,
          nonce: row.nonce,
          ciphertext: row.ciphertext,
        },
        { userId: "alice", provider: "openrouter", revision: row.revision },
        env,
      ),
    ).toBe(privateKey);
    expect(
      (await restored.query("SELECT event FROM credit_ledger")).rows.length,
    ).toBeGreaterThan(0);
    expect(
      (
        await restored.query(
          "SELECT charged_microdollars FROM credit_reservation",
        )
      ).rows[0],
    ).toEqual({ charged_microdollars: 100000 });
    expect(
      await rejectionOf(
        restored.exec("UPDATE credit_ledger SET microdollars=0"),
      ),
    ).toBeDefined();
    expect(
      await rejectionOf(
        restored.exec(
          `INSERT INTO provider_credential SELECT 'missing-user',provider,revision,key_version,nonce,ciphertext,masked_key,test_state,tested_at,updated_at FROM provider_credential LIMIT 1`,
        ),
      ),
    ).toMatchObject({ code: "23503" });
    const roles = await restored.query<{ relrowsecurity: boolean }>(
      "SELECT relrowsecurity FROM pg_class WHERE relname IN ('chat','provider_credential','credit_ledger','platform_budget_plan')",
    );
    expect(roles.rows.every((row) => row.relrowsecurity)).toBe(true);
    const restoredPlan = await restored.query<{ month: string }>(
      "SELECT month FROM platform_budget_plan",
    );
    expect(restoredPlan.rows.length).toBeGreaterThan(0);
    console.info(
      `F08 local physical backup+restore: ${(performance.now() - snapshotStarted).toFixed(2)}ms; snapshot bytes: ${snapshot.size}`,
    );
  } finally {
    await restored.close();
  }
});

test("F08 guest Stop forwards cancellation to the installed SDK and preserves its entered hold", async () => {
  const f = await betaFixture();
  f.slow();
  const handlers = guestHandlers({
    env,
    store: new CreditStore(f.db),
    verifyBot: async () => {},
  });
  const cancellation = new AbortController();
  const response = await handlers.POST(
    new Request(`${env.BETTER_AUTH_URL}/api/guest`, {
      method: "POST",
      signal: cancellation.signal,
      headers: {
        origin: env.BETTER_AUTH_URL,
        "cf-connecting-ip": "192.0.2.17",
        "content-type": "application/json",
        cookie: `__Host-galaxy-guest=${signedGuest(secret)}`,
      },
      body: JSON.stringify({
        requestId: crypto.randomUUID(),
        text: "Local stop fixture",
        botToken: "local-bot",
      }),
    }),
  );
  expect(response.status).toBe(200);
  const reader = response.body?.getReader();
  if (!reader) throw new Error("missing_stream");
  let wire = "";
  try {
    while (!wire.includes("text-delta")) {
      const part = await reader.read();
      if (part.done) throw new Error("no_partial_text");
      wire += new TextDecoder().decode(part.value);
    }
    cancellation.abort();
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      wire += new TextDecoder().decode(part.value);
    }
  } finally {
    reader.releaseLock();
    cancellation.abort();
  }
  await waitFor(
    async () =>
      (await f.db.$client.unsafe("SELECT state FROM credit_reservation"))[0]
        ?.state === "held",
  );
  expect(f.seen).toHaveLength(1);
  expect(wire).toContain("Local beta fixture answer");
  expect(
    (
      await f.db.$client.unsafe<
        { charged_microdollars: number; state: string }[]
      >("SELECT charged_microdollars,state FROM credit_reservation")
    )[0],
  ).toEqual({ charged_microdollars: 100000, state: "held" });
  expect(
    await f.db.$client.unsafe("SELECT actor_key FROM guest_usage"),
  ).toHaveLength(1);
});
