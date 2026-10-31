import { afterEach, beforeAll, expect, test } from "bun:test";
import { listChatsRoute, updateChatRoute } from "../lib/api/chats";
import { searchChatsRoute } from "../lib/api/search";
import {
  call,
  closeHarnesses,
  createHarness,
  PGLITE_SETUP_TIMEOUT_MS,
  warmDatabase,
} from "./support/harness";

beforeAll(warmDatabase, PGLITE_SETUP_TIMEOUT_MS);
afterEach(closeHarnesses);
test("ranked search is owner scoped and under 300ms on 1k Chats × 20 Messages", async () => {
  const h = await createHarness();
  await h.addUser("alice");
  await h.addUser("mallory");
  await h.pg.exec(`INSERT INTO chat(id,user_id,model,title) SELECT 'chat-'||n,'alice','openai/gpt-4.1-mini','Ordinary Chat '||n FROM generate_series(1,1000) n;
    INSERT INTO message(id,chat_id,role,status,parts)
      SELECT 'msg-'||n||'-'||m, 'chat-'||n, 'user', 'complete',
        jsonb_build_array(jsonb_build_object('type','text','text',
          CASE WHEN n < 950 THEN 'Common project planning notes ' ELSE 'Distinct topic ' END
          || md5(n::text || '-' || m::text) || ' discussion number ' || m
          || repeat(' Review requirements implementation decisions testing deployment and documentation for topic ' || (n % 37), 8)))
      FROM generate_series(1,1000) n CROSS JOIN generate_series(1,20) m;
    ANALYZE message;
    UPDATE chat SET title='Astronomy observatory' WHERE id='chat-1';
    INSERT INTO chat(id,user_id,model,title) VALUES ('secret','mallory','openai/gpt-4.1-mini','Astronomy observatory');
    INSERT INTO message(id,chat_id,role,status,parts) VALUES ('m','chat-2','user','complete','[{"type":"text","text":"Astronomy observatory"}]');`);
  const listed = await call(h, listChatsRoute, { user: "alice" });
  expect(((await listed.json()) as { chats: unknown[] }).chats).toHaveLength(
    500,
  );
  const start = performance.now();
  const response = await call(h, searchChatsRoute, {
    user: "alice",
    query: "?q=astronomy",
  });
  const data = (await response.json()) as { chats: { id: string }[] };
  const elapsed = performance.now() - start;
  console.log(`1k Chat search: ${elapsed.toFixed(1)}ms`);
  expect(response.status).toBe(200);
  expect(data.chats.map((c) => c.id)).toEqual(["chat-1", "chat-2"]);
  expect(elapsed).toBeLessThan(300);
  for (const query of ["common", '"project planning"']) {
    const start = performance.now();
    const response = await call(h, searchChatsRoute, {
      user: "alice",
      query: `?q=${encodeURIComponent(query)}`,
    });
    const data = (await response.json()) as { chats: { id: string }[] };
    const elapsed = performance.now() - start;
    console.log(`1k Chats × 20 Messages (${query}): ${elapsed.toFixed(1)}ms`);
    expect(response.status).toBe(200);
    expect(data.chats).toHaveLength(50);
    expect(elapsed).toBeLessThan(300);
  }
  for (const patch of [
    { pinned: true },
    { archived: true },
    { title: "Stolen" },
  ])
    expect(
      (
        await call(h, updateChatRoute, {
          user: "mallory",
          id: "chat-1",
          method: "PATCH",
          body: patch,
        })
      ).status,
    ).toBe(404);
  await call(h, updateChatRoute, {
    user: "alice",
    id: "chat-1",
    method: "PATCH",
    body: { archived: true },
  });
  const archived = await call(h, searchChatsRoute, {
    user: "alice",
    query: "?q=astronomy",
  });
  expect(
    ((await archived.json()) as { chats: { id: string }[] }).chats.map(
      (c) => c.id,
    ),
  ).toEqual(["chat-2"]);
  expect(
    (await call(h, searchChatsRoute, { user: null, query: "?q=astronomy" }))
      .status,
  ).toBe(401);
});

test("Message search vector follows edits and deletes and excludes reasoning", async () => {
  const h = await createHarness();
  await h.addUser("alice");
  await h.pg.exec(`
    INSERT INTO chat(id,user_id,model) VALUES ('chat','alice','openai/gpt-4.1-mini');
    INSERT INTO message(id,chat_id,role,status,parts) VALUES
      ('m','chat','assistant','complete','[{"type":"text","text":"observatory"},{"type":"reasoning","text":"secretword"}]');
  `);
  async function ids(query: string) {
    const response = await call(h, searchChatsRoute, {
      user: "alice",
      query: `?q=${encodeURIComponent(query)}`,
    });
    return ((await response.json()) as { chats: { id: string }[] }).chats.map(
      (c) => c.id,
    );
  }
  expect(await ids("observatory")).toEqual(["chat"]);
  expect(await ids("secretword")).toEqual([]);
  expect(await ids("'; DROP TABLE chat; --")).toEqual([]);
  await h.pg.exec(
    `UPDATE message SET parts='[{"type":"text","text":"telescope"}]' WHERE id='m'`,
  );
  expect(await ids("observatory")).toEqual([]);
  expect(await ids("telescope")).toEqual(["chat"]);
  await h.pg.exec(`DELETE FROM message WHERE id='m'`);
  expect(await ids("telescope")).toEqual([]);
});
