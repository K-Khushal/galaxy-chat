import { afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import { createChatRoute, sendMessageRoute } from "../lib/api/chats";
import {
  deleteAccountRoute,
  exportAccountRoute,
  getSettingsRoute,
  saveSettingsRoute,
} from "../lib/api/settings";
import {
  call,
  closeHarnesses,
  createHarness,
  type Harness,
  PGLITE_SETUP_TIMEOUT_MS,
  warmDatabase,
} from "./support/harness";

let h: Harness;
beforeAll(warmDatabase, PGLITE_SETUP_TIMEOUT_MS);
beforeEach(async () => {
  h = await createHarness();
  await h.addUser("alice");
  await h.addUser("bob");
});
afterEach(closeHarnesses);
async function save(user: string, aboutYou: string) {
  return call(h, saveSettingsRoute, {
    user,
    body: { aboutYou, responseInstructions: "Be concise" },
  });
}
async function chat(user: string) {
  return (await (await call(h, createChatRoute, { user, body: {} })).json())
    .chat.id as string;
}
test("export is owner scoped and never contains keys or sessions", async () => {
  await save("alice", "Alice only");
  await save("bob", "Bob private");
  const alice = await chat("alice");
  const bob = await chat("bob");
  const response = await call(h, exportAccountRoute, { user: "alice" });
  const data = await response.json();
  expect(data.chats.map((row: { id: string }) => row.id)).toEqual([alice]);
  expect(JSON.stringify(data)).not.toContain(bob);
  expect(JSON.stringify(data)).not.toContain("Bob private");
  expect(data.settings.aboutYou).toBe("Alice only");
  expect(data.sessions).toBeUndefined();
});
test("settings reject unauthenticated access and excessive lengths", async () => {
  for (const handler of [
    getSettingsRoute,
    exportAccountRoute,
    deleteAccountRoute,
    saveSettingsRoute,
  ])
    expect((await call(h, handler, { user: null })).status).toBe(401);
  expect((await save("alice", "x".repeat(2001))).status).toBe(400);
  await save("alice", "private");
  const data = await (await call(h, getSettingsRoute, { user: "bob" })).json();
  expect(data.settings.aboutYou).toBe("");
});
test("deletion cascades owned data and preserves grant hashes and other Users", async () => {
  await save("alice", "private");
  const id = await chat("alice");
  await chat("bob");
  await h.pg.query(
    `INSERT INTO message (id, chat_id, role, status) VALUES ('reply', $1, 'assistant', 'complete')`,
    [id],
  );
  await h.pg.query(
    `INSERT INTO session (id, token, user_id, expires_at) VALUES ('s', 'secret', 'alice', now())`,
  );
  await h.pg.query(
    `INSERT INTO account (id, account_id, provider_id, user_id) VALUES ('a', 'external', 'github', 'alice')`,
  );
  await h.pg.query(
    `INSERT INTO byok_key (user_id, provider, revision, key_version, nonce, ciphertext) VALUES ('alice','openrouter','r','v','n','c')`,
  );
  expect(
    (
      await call(h, deleteAccountRoute, {
        user: "alice",
        body: { confirmation: "wrong" },
      })
    ).status,
  ).toBe(400);
  expect(
    (
      await call(h, deleteAccountRoute, {
        user: "alice",
        body: { confirmation: "DELETE" },
      })
    ).status,
  ).toBe(204);
  for (const table of [
    "session",
    "account",
    "byok_key",
    "user_settings",
    "credit_balance",
    "chat",
  ]) {
    const result = await h.pg.query(
      `SELECT * FROM ${table} WHERE user_id = 'alice'`,
    );
    expect(result.rows).toHaveLength(0);
  }
  expect((await h.pg.query(`SELECT * FROM message`)).rows).toHaveLength(0);
  expect(
    (await h.pg.query(`SELECT * FROM credit_grant_identity`)).rows,
  ).toHaveLength(2);
  expect(
    (await h.pg.query(`SELECT * FROM "user" WHERE id = 'bob'`)).rows,
  ).toHaveLength(1);
});
test("Custom instructions reach the mock model as system context", async () => {
  await save("alice", "I study astronomy");
  const id = await chat("alice");
  const response = await call(h, sendMessageRoute, {
    user: "alice",
    id,
    body: {
      trigger: "submit-message",
      parentId: null,
      parts: [{ type: "text", text: "Hello" }],
    },
  });
  expect(response.status).toBe(200);
  await response.text();
  await h.settle();
  expect(JSON.stringify(h.state.calls)).toContain("I study astronomy");
  expect(JSON.stringify(h.state.calls)).toContain("Be concise");
  expect(JSON.stringify(h.state.calls)).toContain("system");
});
