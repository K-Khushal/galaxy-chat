import { afterEach, beforeAll, expect, test } from "bun:test";
import { updateChatRoute } from "../lib/api/chats";
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
test("ranked title and Message search is owner scoped on 1k Chats", async () => {
  const h = await createHarness();
  await h.addUser("alice");
  await h.addUser("mallory");
  await h.pg.exec(`INSERT INTO chat(id,user_id,model,title) SELECT 'chat-'||n,'alice','openai/gpt-4.1-mini','Ordinary Chat '||n FROM generate_series(1,1000) n;
    UPDATE chat SET title='Astronomy observatory' WHERE id='chat-1';
    INSERT INTO chat(id,user_id,model,title) VALUES ('secret','mallory','openai/gpt-4.1-mini','Astronomy observatory');
    INSERT INTO message(id,chat_id,role,status,parts) VALUES ('m','chat-2','user','complete','[{"type":"text","text":"Astronomy observatory"}]');`);
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
