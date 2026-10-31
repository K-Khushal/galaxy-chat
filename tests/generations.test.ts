import { afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import {
  createChatRoute,
  getChatRoute,
  resumeStreamRoute,
  sendMessageRoute,
  stopRoute,
} from "../lib/api/chats";
import { getCredits } from "../lib/credits";
import { message } from "../lib/db/schema";
import { acquireGeneration } from "../lib/generation/locks";
import {
  call,
  createHarness,
  type Harness,
  PGLITE_SETUP_TIMEOUT_MS,
  PLATFORM_KEY,
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

afterEach(async () => {
  await h.settle();
});

const words = (count: number) =>
  Array.from({ length: count }, (_, index) => `w${index} `);

async function newChat(user = "alice", model?: string) {
  const response = await call(h, createChatRoute, {
    user,
    body: model ? { model } : {},
  });
  expect(response.status).toBe(201);
  return ((await response.json()) as { chat: { id: string } }).chat.id;
}

function send(
  chatId: string,
  text: string,
  parentId: string | null = null,
  extra: Record<string, unknown> = {},
) {
  return call(h, sendMessageRoute, {
    user: "alice",
    id: chatId,
    body: {
      trigger: "submit-message",
      parentId,
      parts: [{ type: "text", text }],
      ...extra,
    },
  });
}

async function view(chatId: string, user = "alice") {
  const response = await call(h, getChatRoute, { user, id: chatId });
  return (await response.json()) as {
    chat: { title: string | null; model: string; activeLeafMessageId: string };
    messages: {
      id: string;
      role: string;
      status: string;
      parts: { type: string; text?: string }[];
      payment: string | null;
      usage: { outputTokens?: number; cost?: number } | null;
      error: string | null;
      versions: { ids: string[]; index: number };
    }[];
    generation: { messageId: string } | null;
  };
}

const replyText = (m: { parts: { type: string; text?: string }[] }) =>
  m.parts.map((part) => (part.type === "text" ? part.text : "")).join("");

async function readUntil(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  predicate: (text: string) => boolean,
) {
  const decoder = new TextDecoder();
  let text = "";
  while (!predicate(text)) {
    const { done, value } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }
  return text;
}

test("send streams the Reply and persists both Messages", async () => {
  const chatId = await newChat();
  const response = await send(chatId, "Hi");
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toContain("text/event-stream");
  const chunks = parseSse(await response.text());
  expect(chunks[0]?.type).toBe("start");
  expect(textOf(chunks)).toBe("Hello there!");
  await h.settle();

  const { messages, generation, chat } = await view(chatId);
  expect(generation).toBeNull();
  expect(messages.map((m) => m.role)).toEqual(["user", "assistant"]);
  const reply = messages[1];
  expect(reply?.id).toBe(chunks[0]?.messageId as string);
  expect(reply?.status).toBe("complete");
  expect(replyText(reply ?? { parts: [] })).toBe("Hello there!");
  expect(reply?.payment).toBe("credits");
  expect(reply?.usage).toMatchObject({ outputTokens: 34, cost: 0.00042 });
  expect(chat.activeLeafMessageId).toBe(reply?.id as string);
});

test("Credit Replies use the Platform key, a token cap and low reasoning", async () => {
  const chatId = await newChat();
  await (await send(chatId, "Hi")).text();
  await h.settle();
  const reply = h.state.calls[0];
  expect(reply).toMatchObject({
    modelId: "openai/gpt-6-luna",
    apiKey: PLATFORM_KEY,
    reasoningEffort: "low",
    maxOutputTokens: 4096,
  });
});

test("the first Reply names the Chat on the cheapest model without spending Credits", async () => {
  const chatId = await newChat();
  await (await send(chatId, "Tell me a joke")).text();
  await h.settle();
  expect((await view(chatId)).chat.title).toBe("A friendly greeting");
  const titleCall = h.state.calls.find(
    (c) => c.modelId === "google/gemini-2.5-flash-lite",
  );
  expect(titleCall?.apiKey).toBe(PLATFORM_KEY);
  expect(await getCredits(h.db, "alice")).toBe(9);
});

test("a client disconnect mid-Generation does not stop it; the Reply completes and is saved", async () => {
  h.state.script = { words: words(30), delayMs: 5 };
  const chatId = await newChat();
  const response = await send(chatId, "Long answer please");
  const reader = response.body?.getReader();
  if (!reader) throw new Error("no body");
  await readUntil(reader, (text) => text.includes("w2 "));
  await reader.cancel();

  await h.settle();
  const reply = (await view(chatId)).messages[1];
  expect(reply?.status).toBe("complete");
  expect(replyText(reply ?? { parts: [] })).toBe(words(30).join(""));
});

test("a running Reply is checkpointed as Interrupted, never pending", async () => {
  h.state.script = { words: words(40), delayMs: 5 };
  const chatId = await newChat();
  const response = await send(chatId, "Go");
  const reader = response.body?.getReader();
  if (!reader) throw new Error("no body");
  await readUntil(reader, (text) => text.includes("w10 "));
  await sleep(80);

  const { messages, generation } = await view(chatId);
  const reply = messages[1];
  expect(generation?.messageId).toBe(reply?.id as string);
  expect(reply?.status).toBe("interrupted");
  expect(replyText(reply ?? { parts: [] })).toStartWith("w0 w1 ");
  await reader.cancel();
  await h.settle();
  expect((await view(chatId)).messages[1]?.status).toBe("complete");
  // The database itself refuses any other status.
  await expect(
    h.pg.query(`UPDATE message SET status = 'pending'`),
  ).rejects.toThrow();
});

test("resume replays the full output from the start and follows to the end", async () => {
  h.state.script = { words: words(25), delayMs: 5 };
  const chatId = await newChat();
  const response = await send(chatId, "Go");
  const reader = response.body?.getReader();
  if (!reader) throw new Error("no body");
  await readUntil(reader, (text) => text.includes("w5 "));
  await reader.cancel();

  const resumed = await call(h, resumeStreamRoute, {
    user: "alice",
    id: chatId,
  });
  expect(resumed.status).toBe(200);
  const chunks = parseSse(await resumed.text());
  expect(chunks[0]?.type).toBe("start");
  expect(chunks.at(-1)?.type).toBe("finish");
  expect(textOf(chunks)).toBe(words(25).join(""));

  await h.settle();
  const after = await call(h, resumeStreamRoute, { user: "alice", id: chatId });
  expect(after.status).toBe(204);
});

test("Stop ends the Reply as Stopped with its partial text and still charges", async () => {
  h.state.script = { words: words(200), delayMs: 5 };
  const chatId = await newChat();
  const response = await send(chatId, "Go");
  const reader = response.body?.getReader();
  if (!reader) throw new Error("no body");
  await readUntil(reader, (text) => text.includes("w3 "));

  const stop = await call(h, stopRoute, {
    user: "alice",
    id: chatId,
    body: {},
  });
  expect(stop.status).toBe(202);
  const rest = await readUntil(reader, () => false);
  expect(parseSse(rest).some((chunk) => chunk.type === "abort")).toBe(true);
  await h.settle();

  const { messages, generation } = await view(chatId);
  expect(generation).toBeNull();
  const reply = messages[1];
  expect(reply?.status).toBe("stopped");
  const text = replyText(reply ?? { parts: [] });
  expect(text).toStartWith("w0 w1 w2 w3 ");
  expect(text.length).toBeLessThan(words(200).join("").length);
  expect(await getCredits(h.db, "alice")).toBe(9);
});

test("Stop with nothing running is a no-op", async () => {
  const chatId = await newChat();
  const stop = await call(h, stopRoute, {
    user: "alice",
    id: chatId,
    body: {},
  });
  expect(stop.status).toBe(200);
  expect(await stop.json()).toEqual({ stopping: null });
});

test("hitting the time limit leaves the Reply Interrupted, and continue finishes it", async () => {
  const limited = await createHarness({ deadlineMs: 60 });
  h = limited;
  await h.addUser("alice");
  h.state.script = { words: words(100), delayMs: 5 };
  const chatId = await newChat();
  await (await send(chatId, "Go")).text();
  await h.settle();
  const interrupted = (await view(chatId)).messages[1];
  expect(interrupted?.status).toBe("interrupted");
  const partial = replyText(interrupted ?? { parts: [] });
  expect(partial.length).toBeGreaterThan(0);

  h.ctx.timing.deadlineMs = 60_000;
  h.state.script = { words: ["the end."], delayMs: 1 };
  const response = await call(h, sendMessageRoute, {
    user: "alice",
    id: chatId,
    body: { trigger: "continue-message", messageId: interrupted?.id },
  });
  expect(response.status).toBe(200);
  await response.text();
  await h.settle();
  const { messages } = await view(chatId);
  expect(messages).toHaveLength(2);
  expect(messages[1]?.id).toBe(interrupted?.id as string);
  expect(messages[1]?.status).toBe("complete");
  expect(replyText(messages[1] ?? { parts: [] })).toBe(`${partial}the end.`);
});

test("a crashed Generation's lock expires instead of blocking the Chat", async () => {
  const chatId = await newChat();
  // A Generation whose function died: it holds the lock and never releases it.
  const crashed = await acquireGeneration(
    h.redis,
    {
      chatId,
      userId: "alice",
      active: { generationId: "dead", messageId: "dead-reply" },
    },
    h.ctx.timing.lockTtlMs,
  );
  expect(crashed.ok).toBe(true);

  const blocked = await send(chatId, "Hi");
  expect(blocked.status).toBe(409);
  expect(await blocked.json()).toEqual({ error: "generation_in_progress" });
  // Its stream was registered, but its producer is gone: nobody answers the
  // replay request, so there is nothing to resume.
  await h.redis.set("test:rs:sentinel:dead", "1", { EX: 86_400 });
  const resume = await call(h, resumeStreamRoute, {
    user: "alice",
    id: chatId,
  });
  expect(resume.status).toBe(204);

  h.redis.advance(h.ctx.timing.lockTtlMs + 1);
  expect((await view(chatId)).generation).toBeNull();
  const response = await send(chatId, "Hi");
  expect(response.status).toBe(200);
  await response.text();
});

test("one Generation per Chat and three per User", async () => {
  h.state.script = { words: words(100), delayMs: 5 };
  const chats = [
    await newChat(),
    await newChat(),
    await newChat(),
    await newChat(),
  ];
  const running = [];
  for (const chatId of chats.slice(0, 3)) {
    const response = await send(chatId, "Go");
    expect(response.status).toBe(200);
    running.push(response);
  }
  const sameChat = await send(chats[0] as string, "Again");
  expect(sameChat.status).toBe(409);
  const fourth = await send(chats[3] as string, "Go");
  expect(fourth.status).toBe(429);
  expect(await fourth.json()).toEqual({ error: "too_many_generations" });
  // Rejected requests never spend a credit.
  expect(await getCredits(h.db, "alice")).toBe(7);

  for (const chatId of chats.slice(0, 3)) {
    await call(h, stopRoute, { user: "alice", id: chatId, body: {} });
  }
  await Promise.all(running.map((response) => response.text()));
  await h.settle();
  expect((await send(chats[3] as string, "Go")).status).toBe(200);
});

test("a failure before the first token refunds the credit", async () => {
  h.state.script = { words: words(5), delayMs: 1, failAt: 0 };
  const chatId = await newChat();
  const chunks = parseSse(await (await send(chatId, "Hi")).text());
  expect(chunks.some((chunk) => chunk.type === "error")).toBe(true);
  await h.settle();
  const reply = (await view(chatId)).messages[1];
  expect(reply?.status).toBe("failed");
  expect(reply?.error).toBe("generation_failed");
  expect(await getCredits(h.db, "alice")).toBe(10);
  expect((await view(chatId)).chat.title).toBeNull();
});

test("a failure after the first token keeps the text as Interrupted and charges", async () => {
  h.state.script = { words: words(10), delayMs: 1, failAt: 4 };
  const chatId = await newChat();
  await (await send(chatId, "Hi")).text();
  await h.settle();
  const reply = (await view(chatId)).messages[1];
  expect(reply?.status).toBe("interrupted");
  expect(replyText(reply ?? { parts: [] })).toBe("w0 w1 w2 w3 ");
  expect(await getCredits(h.db, "alice")).toBe(9);
});

test("a rejected BYOK key is reported with a clear error", async () => {
  await h.addUser("bob", 0);
  const { saveByokKey } = await import("../lib/byok/store");
  await saveByokKey(h.db, h.ctx.byokEnv, "bob", "sk-or-v1-".padEnd(48, "b"));
  h.state.script = { words: [], delayMs: 1, failAt: 0, failStatus: 401 };
  const chatId = await newChat("bob");
  await (
    await call(h, sendMessageRoute, {
      user: "bob",
      id: chatId,
      body: {
        trigger: "submit-message",
        parentId: null,
        parts: [{ type: "text", text: "Hi" }],
      },
    })
  ).text();
  await h.settle();
  const reply = (await view(chatId, "bob")).messages[1];
  expect(reply?.status).toBe("failed");
  expect(reply?.error).toBe("provider_key_rejected");
});

test("Message rows hold each Message once", async () => {
  const chatId = await newChat();
  await (await send(chatId, "Hi")).text();
  await h.settle();
  const rows = await h.db
    .select()
    .from(message)
    .where(eq(message.chatId, chatId));
  expect(rows).toHaveLength(2);
});
