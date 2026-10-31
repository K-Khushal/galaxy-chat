import { afterEach, beforeEach, expect, test } from "bun:test";
import {
  deleteByokRoute,
  getByokRoute,
  saveByokRoute,
  testByokRoute,
} from "../lib/api/byok";
import {
  createChatRoute,
  deleteChatRoute,
  getChatRoute,
  listChatsRoute,
  resumeStreamRoute,
  sendMessageRoute,
  stopRoute,
  switchVersionRoute,
  updateChatRoute,
} from "../lib/api/chats";
import { getCredits } from "../lib/credits";
import {
  call,
  createHarness,
  type Harness,
  PLATFORM_KEY,
} from "./support/harness";

let h: Harness;
const USER_KEY = "sk-or-v1-".padEnd(60, "u");

beforeEach(async () => {
  h = await createHarness();
  await h.addUser("alice");
  await h.addUser("mallory");
});

afterEach(async () => {
  await h.settle();
});

async function newChat(user = "alice", body: Record<string, unknown> = {}) {
  const response = await call(h, createChatRoute, { user, body });
  expect(response.status).toBe(201);
  return ((await response.json()) as { chat: { id: string } }).chat.id;
}

async function start(
  chatId: string,
  body: Record<string, unknown>,
  user = "alice",
) {
  const response = await call(h, sendMessageRoute, { user, id: chatId, body });
  if (response.status === 200) await response.text();
  await h.settle();
  return response;
}

const submit = (text: string, parentId: string | null, extra = {}) => ({
  trigger: "submit-message",
  parentId,
  parts: [{ type: "text", text }],
  ...extra,
});

type View = {
  chat: {
    model: string;
    title: string | null;
    pinned: boolean;
    archived: boolean;
  };
  messages: {
    id: string;
    parentId: string | null;
    role: string;
    payment: string | null;
    parts: { type: string; text?: string }[];
    versions: { ids: string[]; index: number };
  }[];
};

async function view(chatId: string): Promise<View> {
  return (
    await call(h, getChatRoute, { user: "alice", id: chatId })
  ).json() as Promise<View>;
}

const text = (m: View["messages"][number] | undefined) =>
  (m?.parts ?? []).map((part) => part.text ?? "").join("");

test("edit and regenerate create Versions, and the active Version can be switched", async () => {
  const chatId = await newChat();
  await start(chatId, submit("First question", null));
  const first = await view(chatId);
  const [question, answer] = first.messages;

  // Edit: a new User Message under the same parent as the edited one.
  h.state.script = { words: ["Edited answer"], delayMs: 1 };
  await start(chatId, submit("Edited question", null));
  const edited = await view(chatId);
  expect(edited.messages.map(text)).toEqual([
    "Edited question",
    "Edited answer",
  ]);
  expect(edited.messages[0]?.versions).toEqual({
    ids: [question?.id as string, edited.messages[0]?.id as string],
    index: 1,
  });

  // Switch back to the first Version: its own Reply comes back.
  const switched = await call(h, switchVersionRoute, {
    user: "alice",
    id: chatId,
    body: { messageId: question?.id },
  });
  expect(switched.status).toBe(200);
  const back = (await switched.json()) as View;
  expect(back.messages.map(text)).toEqual(["First question", "Hello there!"]);
  expect(back.messages[0]?.versions.index).toBe(0);

  // Regenerate: a new Reply Version under the same User Message. Costs a credit.
  const credits = await getCredits(h.db, "alice");
  h.state.script = { words: ["Another take"], delayMs: 1 };
  await start(chatId, { trigger: "regenerate-message", messageId: answer?.id });
  const regenerated = await view(chatId);
  expect(regenerated.messages.map(text)).toEqual([
    "First question",
    "Another take",
  ]);
  expect(regenerated.messages[1]?.versions).toEqual({
    ids: [answer?.id as string, regenerated.messages[1]?.id as string],
    index: 1,
  });
  expect(await getCredits(h.db, "alice")).toBe(credits - 1);

  // A follow-up continues from the active Reply.
  h.state.script = { words: ["Follow-up answer"], delayMs: 1 };
  await start(chatId, submit("Follow-up", regenerated.messages[1]?.id ?? null));
  expect((await view(chatId)).messages.map(text)).toEqual([
    "First question",
    "Another take",
    "Follow-up",
    "Follow-up answer",
  ]);
  // The model saw the active path only.
  const prompt = h.state.calls.at(-1)?.prompt ?? "";
  for (const seen of ["First question", "Another take", "Follow-up"]) {
    expect(prompt).toContain(seen);
  }
  for (const hidden of ["Edited", "Hello there!"]) {
    expect(prompt).not.toContain(hidden);
  }
});

test("invalid targets are rejected without charging", async () => {
  const chatId = await newChat();
  await start(chatId, submit("Hi", null));
  const [question, answer] = (await view(chatId)).messages;
  const before = await getCredits(h.db, "alice");
  const cases: [Record<string, unknown>, number, string][] = [
    [submit("x", "missing"), 404, "message_not_found"],
    [submit("x", question?.id ?? null), 400, "invalid_parent"],
    [
      submit("x", answer?.id ?? null, { messageId: question?.id }),
      409,
      "message_exists",
    ],
    [
      { trigger: "regenerate-message", messageId: question?.id },
      400,
      "not_a_reply",
    ],
    [
      { trigger: "continue-message", messageId: answer?.id },
      409,
      "not_continuable",
    ],
    [submit("x", null, { model: "not a model" }), 400, "invalid_request"],
    [
      { trigger: "submit-message", parentId: null, parts: [] },
      400,
      "invalid_request",
    ],
  ];
  for (const [body, status, error] of cases) {
    const response = await call(h, sendMessageRoute, {
      user: "alice",
      id: chatId,
      body,
    });
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error });
  }
  expect(await getCredits(h.db, "alice")).toBe(before);
});

test("payment: Credits first on Credit models, then the BYOK key", async () => {
  await h.addUser("carol", 1);
  const chatId = await newChat("carol");
  await start(chatId, submit("one", null), "carol");
  expect(await getCredits(h.db, "carol")).toBe(0);

  const noCredits = await call(h, sendMessageRoute, {
    user: "carol",
    id: chatId,
    body: submit("two", null),
  });
  expect(noCredits.status).toBe(402);
  expect(await noCredits.json()).toEqual({ error: "no_credits" });

  await call(h, saveByokRoute, {
    user: "carol",
    method: "PUT",
    body: { key: USER_KEY },
  });
  const paid = await start(chatId, submit("two", null), "carol");
  expect(paid.status).toBe(200);
  expect(h.state.calls.at(-1)?.apiKey).toBe(USER_KEY);
  // BYOK Replies are not capped like Credit Replies.
  expect(h.state.calls.at(-1)?.maxOutputTokens).toBeUndefined();
  const messages = (
    (await (
      await call(h, getChatRoute, { user: "carol", id: chatId })
    ).json()) as View
  ).messages;
  expect(messages[1]?.payment).toBe("byok");
});

test("payment: other models need a BYOK key and never spend Credits", async () => {
  const chatId = await newChat("alice", {
    model: "anthropic/claude-sonnet-5.5",
  });
  const needsKey = await call(h, sendMessageRoute, {
    user: "alice",
    id: chatId,
    body: submit("Hi", null),
  });
  expect(needsKey.status).toBe(402);
  expect(await needsKey.json()).toEqual({ error: "needs_byok_key" });

  await call(h, saveByokRoute, {
    user: "alice",
    method: "PUT",
    body: { key: USER_KEY },
  });
  await start(chatId, submit("Hi", null));
  expect(h.state.calls.at(-2)).toMatchObject({
    modelId: "anthropic/claude-sonnet-5.5",
    apiKey: USER_KEY,
  });
  expect(await getCredits(h.db, "alice")).toBe(10);

  // A custom model ID works with a BYOK key; the chat remembers the model.
  await start(chatId, submit("Hi", null, { model: "some-lab/new-model:beta" }));
  expect(
    h.state.calls.some((c) => c.modelId === "some-lab/new-model:beta"),
  ).toBe(true);
  expect((await view(chatId)).chat.model).toBe("some-lab/new-model:beta");
  // Title generation used the user's key, not the Platform key.
  expect(h.state.calls.every((c) => c.apiKey !== PLATFORM_KEY)).toBe(true);
});

test("BYOK keys can be saved, tested, replaced and deleted, and never leave the server", async () => {
  const empty = await call(h, getByokRoute, { user: "alice" });
  expect(await empty.json()).toEqual({ key: null });

  const saved = await call(h, saveByokRoute, {
    user: "alice",
    method: "PUT",
    body: { key: USER_KEY },
  });
  expect(saved.status).toBe(200);
  const savedText = await saved.text();
  expect(savedText).not.toContain(USER_KEY);
  expect(JSON.parse(savedText).key.provider).toBe("openrouter");
  const stored = await h.pg.query<{ ciphertext: string }>(
    `SELECT ciphertext FROM byok_key`,
  );
  expect(stored.rows[0]?.ciphertext).not.toContain(USER_KEY);

  const tested = await call(h, testByokRoute, { user: "alice", body: {} });
  expect(await tested.json()).toEqual({ ok: true });

  const replacement = "sk-or-v1-".padEnd(60, "r");
  await call(h, saveByokRoute, {
    user: "alice",
    method: "PUT",
    body: { key: replacement },
  });
  const { loadByokKey } = await import("../lib/byok/store");
  expect(await loadByokKey(h.db, h.ctx.byokEnv, "alice")).toBe(replacement);

  h.state.keyAccepted = false;
  const rejected = await call(h, saveByokRoute, {
    user: "alice",
    method: "PUT",
    body: { key: "sk-or-v1-".padEnd(60, "x") },
  });
  expect(rejected.status).toBe(400);
  expect(await rejected.json()).toEqual({ error: "provider_key_rejected" });
  const malformed = await call(h, saveByokRoute, {
    user: "alice",
    method: "PUT",
    body: { key: "short" },
  });
  expect(await malformed.json()).toEqual({ error: "invalid_provider_key" });
  expect(await loadByokKey(h.db, h.ctx.byokEnv, "alice")).toBe(replacement);

  // Another User sees nothing and cannot test or delete it.
  expect(
    await (await call(h, getByokRoute, { user: "mallory" })).json(),
  ).toEqual({ key: null });
  expect(
    (await call(h, testByokRoute, { user: "mallory", body: {} })).status,
  ).toBe(404);
  await call(h, deleteByokRoute, { user: "mallory", method: "DELETE" });
  expect(await loadByokKey(h.db, h.ctx.byokEnv, "alice")).toBe(replacement);

  const deleted = await call(h, deleteByokRoute, {
    user: "alice",
    method: "DELETE",
  });
  expect(deleted.status).toBe(204);
  expect(await (await call(h, getByokRoute, { user: "alice" })).json()).toEqual(
    { key: null },
  );
});

test("sending messages and saving keys are rate limited", async () => {
  const chatId = await newChat();
  h.state.rateLimited.add("send");
  const send = await call(h, sendMessageRoute, {
    user: "alice",
    id: chatId,
    body: submit("Hi", null),
  });
  expect(send.status).toBe(429);
  expect(await send.json()).toEqual({ error: "rate_limited" });
  expect(await getCredits(h.db, "alice")).toBe(10);

  h.state.rateLimited.add("byok");
  const save = await call(h, saveByokRoute, {
    user: "alice",
    method: "PUT",
    body: { key: USER_KEY },
  });
  expect(save.status).toBe(429);
});

test("Chats can be listed, renamed, pinned, archived and deleted", async () => {
  const first = await newChat();
  const second = await newChat();
  await newChat("mallory");

  const patch = await call(h, updateChatRoute, {
    user: "alice",
    id: first,
    method: "PATCH",
    body: { title: "Pinned one", pinned: true },
  });
  expect(patch.status).toBe(200);
  const listed = (await (
    await call(h, listChatsRoute, { user: "alice" })
  ).json()) as {
    chats: { id: string; title: string | null }[];
  };
  expect(listed.chats.map((c) => c.id)).toEqual([first, second]);

  await call(h, updateChatRoute, {
    user: "alice",
    id: second,
    method: "PATCH",
    body: { archived: true },
  });
  const active = (await (
    await call(h, listChatsRoute, { user: "alice" })
  ).json()) as {
    chats: { id: string }[];
  };
  expect(active.chats.map((c) => c.id)).toEqual([first]);
  const archived = (await (
    await call(h, listChatsRoute, { user: "alice", query: "?archived=true" })
  ).json()) as { chats: { id: string }[] };
  expect(archived.chats.map((c) => c.id)).toEqual([second]);

  const bad = await call(h, updateChatRoute, {
    user: "alice",
    id: first,
    method: "PATCH",
    body: { model: "nope" },
  });
  expect(bad.status).toBe(400);

  await start(first, submit("Hi", null));
  const deleted = await call(h, deleteChatRoute, {
    user: "alice",
    id: first,
    method: "DELETE",
  });
  expect(deleted.status).toBe(204);
  expect(
    (await call(h, getChatRoute, { user: "alice", id: first })).status,
  ).toBe(404);
});

test("every Chat route checks the owner", async () => {
  const chatId = await newChat();
  await start(chatId, submit("Secret", null));
  const reply = (await view(chatId)).messages[1];

  const routes = [
    () => call(h, getChatRoute, { user: "mallory", id: chatId }),
    () =>
      call(h, updateChatRoute, {
        user: "mallory",
        id: chatId,
        method: "PATCH",
        body: { title: "mine" },
      }),
    () =>
      call(h, deleteChatRoute, {
        user: "mallory",
        id: chatId,
        method: "DELETE",
      }),
    () =>
      call(h, sendMessageRoute, {
        user: "mallory",
        id: chatId,
        body: submit("x", null),
      }),
    () =>
      call(h, sendMessageRoute, {
        user: "mallory",
        id: chatId,
        body: { trigger: "regenerate-message", messageId: reply?.id },
      }),
    () => call(h, resumeStreamRoute, { user: "mallory", id: chatId }),
    () => call(h, stopRoute, { user: "mallory", id: chatId, body: {} }),
    () =>
      call(h, switchVersionRoute, {
        user: "mallory",
        id: chatId,
        body: { messageId: reply?.id },
      }),
  ];
  for (const route of routes) {
    const response = await route();
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "chat_not_found" });
  }
  // Unauthenticated requests are refused before anything else.
  for (const handler of [
    getChatRoute,
    sendMessageRoute,
    resumeStreamRoute,
    stopRoute,
  ]) {
    const response = await call(h, handler, {
      user: null,
      id: chatId,
      body: {},
    });
    expect(response.status).toBe(401);
  }
  for (const handler of [listChatsRoute, createChatRoute, getByokRoute]) {
    expect((await call(h, handler, { user: null, body: {} })).status).toBe(401);
  }

  // Nothing changed.
  const after = await view(chatId);
  expect(after.chat.title).toBe("A friendly greeting");
  expect(after.messages).toHaveLength(2);
  expect(await getCredits(h.db, "mallory")).toBe(10);
});
