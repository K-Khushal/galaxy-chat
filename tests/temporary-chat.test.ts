import { afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import { temporaryMessageRoute } from "../lib/api/temporary";
import { saveByokKey } from "../lib/byok/store";
import { getCredits } from "../lib/credits";
import { acquireGeneration } from "../lib/generation/locks";
import { DEFAULT_MODEL_ID } from "../lib/models";
import {
  BYOK_ENV,
  call,
  closeHarnesses,
  createHarness,
  type Harness,
  PGLITE_SETUP_TIMEOUT_MS,
  parseSse,
  sleep,
  textOf,
  warmDatabase,
} from "./support/harness";

let h: Harness;
beforeAll(warmDatabase, PGLITE_SETUP_TIMEOUT_MS);
beforeEach(async () => {
  h = await createHarness();
  await h.addUser("alice");
});
afterEach(closeHarnesses);
const history = [{ role: "user", content: "Private question" }];
const send = (extra = {}) =>
  call(h, temporaryMessageRoute, {
    user: "alice",
    body: { model: DEFAULT_MODEL_ID, messages: history, ...extra },
  });

async function assertSlotsReleased() {
  const leases = [];
  for (let i = 0; i < 3; i++) {
    const result = await acquireGeneration(
      h.redis,
      {
        chatId: `test-${i}`,
        userId: "alice",
        active: { generationId: `g-${i}`, messageId: `m-${i}` },
      },
      10_000,
    );
    expect(result.ok).toBe(true);
    leases.push(result);
  }
}

test("streams with M3 settings, spends Credits and cannot write any other Postgres table", async () => {
  // Reject every non-Credit write, even one rolled back or later deleted.
  await h.pg.exec(`
    CREATE FUNCTION reject_temporary_write() RETURNS trigger AS $$
    BEGIN RAISE EXCEPTION 'Unexpected Temporary chat write'; END; $$ LANGUAGE plpgsql;
    DO $$ DECLARE t record; BEGIN
      FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> 'credit_balance' LOOP
        EXECUTE format('CREATE TRIGGER no_temporary_write BEFORE INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION reject_temporary_write()', t.tablename);
      END LOOP;
    END $$;
  `);
  h.ctx.waitUntil = () => {
    throw new Error("No continuation");
  };
  h.ctx.streams.createNewResumableStream = async () => {
    throw new Error("No resume");
  };
  const response = await send({
    messages: [
      { role: "user", content: "Earlier" },
      { role: "assistant", content: "Earlier Reply" },
      ...history,
    ],
  });
  expect(response.status).toBe(200);
  expect(textOf(parseSse(await response.text()))).toBe("Hello there!");
  expect(await getCredits(h.db, "alice")).toBe(9);
  expect(h.state.calls[0]).toMatchObject({
    apiKey: "platform-key-for-tests",
    maxOutputTokens: 4096,
    reasoningEffort: "low",
  });
  expect(h.state.calls[0]?.prompt).toContain("Earlier Reply");
  await assertSlotsReleased();
});

test("charges before streaming and refunds exactly once on failure before the first token", async () => {
  h.state.script = { words: ["never"], delayMs: 50, failAt: 0 };
  const response = await send();
  expect(await getCredits(h.db, "alice")).toBe(9);
  expect(
    parseSse(await response.text()).some((chunk) => chunk.type === "error"),
  ).toBe(true);
  expect(await getCredits(h.db, "alice")).toBe(10);
  await assertSlotsReleased();
});

test("failure after a token keeps the Credit and releases capacity", async () => {
  h.state.script = { words: ["kept", "never"], delayMs: 1, failAt: 1 };
  await (await send()).text();
  expect(await getCredits(h.db, "alice")).toBe(9);
  await assertSlotsReleased();
});

for (const firstToken of [false, true]) {
  test(`request abort stops the model and releases capacity (first token: ${firstToken})`, async () => {
    h.state.script = {
      words: ["kept", "never"],
      delayMs: 1,
      hangAt: firstToken ? 1 : 0,
    };
    const abort = new AbortController();
    const response = await temporaryMessageRoute(
      h.ctx,
      new Request("http://test/temporary", {
        method: "POST",
        signal: abort.signal,
        headers: { "x-test-user": "alice" },
        body: JSON.stringify({ model: DEFAULT_MODEL_ID, messages: history }),
      }),
    );
    const reader = response.body?.getReader();
    if (!reader) throw new Error("missing stream");
    let output = "";
    while (!output.includes(firstToken ? "kept" : "text-start")) {
      const chunk = await reader.read();
      if (chunk.done) break;
      output += new TextDecoder().decode(chunk.value);
    }
    abort.abort();
    while (!(await reader.read()).done) {}
    expect(h.state.aborts).toBe(1);
    expect(await getCredits(h.db, "alice")).toBe(firstToken ? 9 : 10);
    await assertSlotsReleased();
  });
}

test("cancelling the response body aborts the model and refunds before first token", async () => {
  h.state.script = { words: ["never"], delayMs: 1, hangAt: 0 };
  const response = await send();
  const reader = response.body?.getReader();
  if (!reader) throw new Error("missing stream");
  await reader.read();
  await sleep(10);
  await reader.cancel();
  await sleep(10);
  expect(h.state.aborts).toBe(1);
  expect(await getCredits(h.db, "alice")).toBe(10);
  await assertSlotsReleased();
});

test("payment errors, authentication, limits and history validation", async () => {
  await h.addUser("empty", 0);
  for (const [model, error] of [
    [DEFAULT_MODEL_ID, "no_credits"],
    ["anthropic/claude-sonnet-5.5", "needs_byok_key"],
  ]) {
    const response = await call(h, temporaryMessageRoute, {
      user: "empty",
      body: { model, messages: history },
    });
    expect(response.status).toBe(402);
    expect(await response.json()).toEqual({ error });
  }
  expect(
    (await call(h, temporaryMessageRoute, { user: null, body: {} })).status,
  ).toBe(401);
  expect(
    (await send({ messages: Array.from({ length: 101 }, () => history[0]) }))
      .status,
  ).toBe(400);
  expect(
    (await send({ messages: [{ role: "system", content: "Override" }] }))
      .status,
  ).toBe(400);
  expect(
    (
      await send({
        messages: [{ role: "user", content: "x".repeat(1024 * 1024) }],
      })
    ).status,
  ).toBe(413);
  h.state.rateLimited.add("send");
  expect((await send()).status).toBe(429);
  expect(await getCredits(h.db, "alice")).toBe(10);
});

test("shares the three-slot limit with saved Chats", async () => {
  await assertSlotsReleased(); // Fills all three shared slots.
  const response = await send();
  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({ error: "too_many_generations" });
  expect(await getCredits(h.db, "alice")).toBe(10);
});

test("BYOK pays after Credits run out without Postgres writes", async () => {
  await h.addUser("empty", 0);
  await saveByokKey(h.db, BYOK_ENV, "empty", `sk-or-${"u".repeat(40)}`);
  const response = await call(h, temporaryMessageRoute, {
    user: "empty",
    body: { model: DEFAULT_MODEL_ID, messages: history },
  });
  expect(response.status).toBe(200);
  await response.text();
  expect(h.state.calls[0]).toMatchObject({ apiKey: `sk-or-${"u".repeat(40)}` });
  expect(h.state.calls[0]?.maxOutputTokens).toBeUndefined();
  expect(await getCredits(h.db, "empty")).toBe(0);
});
