import { afterEach, beforeAll, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import {
  createChatRoute,
  getChatRoute,
  sendMessageRoute,
  switchVersionRoute,
} from "../lib/api/chats";
import { finishReply } from "../lib/chat/store";
import { getCredits } from "../lib/credits";
import { message } from "../lib/db/schema";
import { recoverReplies } from "../lib/generation/recover";
import {
  call,
  createHarness,
  type Harness,
  PGLITE_SETUP_TIMEOUT_MS,
  sleep,
  warmDatabase,
} from "./support/harness";

let h: Harness;

beforeAll(warmDatabase, PGLITE_SETUP_TIMEOUT_MS);

afterEach(async () => {
  await h.settle();
});

/** How many of the next Generations die before their model starts. */
let crashes = 0;

async function setup(timing: Parameters<typeof createHarness>[0] = {}) {
  h = await createHarness(timing);
  await h.addUser("alice");
  crashes = 0;
  const streams = h.ctx.streams;
  h.ctx.streams = {
    ...streams,
    // A crashed function never gets to create the stream.
    createNewResumableStream: (...args) =>
      crashes-- > 0
        ? new Promise(() => {})
        : streams.createNewResumableStream(...args),
  };
}

const words = (count: number) =>
  Array.from({ length: count }, (_, index) => `w${index} `);

async function newChat() {
  const response = await call(h, createChatRoute, { user: "alice", body: {} });
  return ((await response.json()) as { chat: { id: string } }).chat.id;
}

function send(chatId: string, text = "Hi") {
  return call(h, sendMessageRoute, {
    user: "alice",
    id: chatId,
    body: {
      trigger: "submit-message",
      parentId: null,
      parts: [{ type: "text", text }],
    },
  });
}

function getChat(chatId: string) {
  return call(h, getChatRoute, { user: "alice", id: chatId });
}

async function replyRow(chatId: string) {
  const rows = await h.db
    .select()
    .from(message)
    .where(eq(message.chatId, chatId));
  return rows.find((row) => row.role === "assistant") ?? null;
}

const textOfRow = (row: { parts: unknown[] } | null) =>
  ((row?.parts ?? []) as { type: string; text?: string }[])
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("");

async function until(check: () => Promise<boolean>, label: string) {
  for (let tries = 0; tries < 400; tries++) {
    if (await check()) return;
    await sleep(5);
  }
  throw new Error(`timed out waiting for ${label}`);
}

const userSlots = () =>
  h.redis.keys().filter((key) => key.startsWith("galaxy:user:alice:"));

test("a producer whose lease expired cannot overwrite the Generation that took over its Reply", async () => {
  // Renewal is too slow to notice the expiry: only the fence can stop it.
  await setup({ renewMs: 60_000 });
  h.state.script = { words: words(400), delayMs: 5 };
  const chatId = await newChat();
  const old = await send(chatId, "Go");
  const reader = old.body?.getReader();
  if (!reader) throw new Error("no body");
  await until(
    async () => textOfRow(await replyRow(chatId)).includes("w5 "),
    "a checkpoint",
  );
  const reply = await replyRow(chatId);
  if (!reply) throw new Error("no reply");

  // The old producer's lease expires while it is still streaming.
  h.redis.advance(h.ctx.timing.lockTtlMs + 1);
  h.state.script = { words: ["NEW"], delayMs: 1 };
  const continued = await call(h, sendMessageRoute, {
    user: "alice",
    id: chatId,
    body: { trigger: "continue-message", messageId: reply.id },
  });
  expect(continued.status).toBe(200);
  await continued.text();
  await reader.cancel();
  await h.settle();

  const final = await replyRow(chatId);
  const text = textOfRow(final);
  expect(final?.status).toBe("complete");
  expect(text.endsWith("NEW")).toBe(true);
  // Everything before "NEW" is the old producer's output up to the takeover.
  expect(words(400).join("").startsWith(text.slice(0, -3))).toBe(true);
  expect(text.length).toBeLessThan(words(400).join("").length);
  // The old model request was aborted and its User slot given back.
  expect(h.state.aborts).toBe(1);
  expect(userSlots()).toEqual([]);
  // Two Generations each produced tokens: two credits.
  expect(await getCredits(h.db, "alice")).toBe(8);
});

test("a stale Generation's final save changes nothing", async () => {
  await setup();
  const chatId = await newChat();
  await (await send(chatId)).text();
  await h.settle();
  const before = await replyRow(chatId);
  if (!before) throw new Error("no reply");
  const saved = await finishReply(
    h.db,
    { replyId: before.id, generationId: "an-older-generation" },
    {
      parts: [{ type: "text", text: "OLD" }],
      status: "interrupted",
      usage: null,
      error: null,
      firstToken: true,
    },
    "alice",
  );
  expect(saved).toBe(false);
  const after = await replyRow(chatId);
  expect(after?.status).toBe("complete");
  expect(textOfRow(after)).toBe("Hello there!");
  expect(await getCredits(h.db, "alice")).toBe(9);
});

test("a failed lock renewal aborts the model and frees the User's slot", async () => {
  await setup({ renewMs: 20 });
  h.state.script = { words: words(400), delayMs: 5 };
  const chatId = await newChat();
  const response = await send(chatId, "Go");
  const body = response.text();
  await until(
    async () => textOfRow(await replyRow(chatId)).includes("w2 "),
    "a checkpoint",
  );
  h.redis.advance(h.ctx.timing.lockTtlMs + 1);
  await body;
  await h.settle();

  const reply = await replyRow(chatId);
  expect(reply?.status).toBe("interrupted");
  expect(textOfRow(reply)).toStartWith("w0 w1 w2 ");
  expect(textOfRow(reply).length).toBeLessThan(words(400).join("").length);
  expect(h.state.aborts).toBe(1);
  expect(userSlots()).toEqual([]);
  // It had produced tokens, so the credit stays spent.
  expect(await getCredits(h.db, "alice")).toBe(9);
});

/** The function dies after the payment transaction, before the model starts. */
async function crashAfterDebit() {
  crashes++;
  const chatId = await newChat();
  void send(chatId);
  await until(async () => (await replyRow(chatId)) !== null, "the Reply");
  return chatId;
}

test("a crash between the debit and the first token is refunded once, on the next load", async () => {
  await setup();
  const chatId = await crashAfterDebit();
  const charged = await replyRow(chatId);
  expect(charged).toMatchObject({
    payment: "credits",
    status: "interrupted",
    firstTokenAt: null,
    creditRefunded: false,
  });
  expect(await getCredits(h.db, "alice")).toBe(9);

  // While its lock is held the Generation may still be running: no refund.
  await getChat(chatId);
  expect(await getCredits(h.db, "alice")).toBe(9);

  h.redis.advance(h.ctx.timing.lockTtlMs + 1);
  const view = (await (await getChat(chatId)).json()) as {
    messages: { status: string; error: string | null }[];
    generation: unknown;
  };
  expect(view.generation).toBeNull();
  expect(view.messages[1]).toMatchObject({
    status: "failed",
    error: "generation_failed",
  });
  expect(await getCredits(h.db, "alice")).toBe(10);

  await getChat(chatId);
  await call(h, switchVersionRoute, {
    user: "alice",
    id: chatId,
    body: { messageId: charged?.id },
  });
  expect(await getCredits(h.db, "alice")).toBe(10);
  expect((await replyRow(chatId))?.creditRefunded).toBe(true);
});

test("concurrent recoveries never refund twice", async () => {
  await setup();
  await crashAfterDebit();
  await crashAfterDebit();
  expect(await getCredits(h.db, "alice")).toBe(8);
  h.redis.advance(h.ctx.timing.lockTtlMs + 1);

  const counts = await Promise.all([
    recoverReplies(h.ctx, "alice"),
    recoverReplies(h.ctx, "alice"),
    recoverReplies(h.ctx, "alice"),
  ]);
  expect(counts.reduce((sum, count) => sum + count, 0)).toBe(2);
  expect(await recoverReplies(h.ctx, "alice")).toBe(0);
  expect(await getCredits(h.db, "alice")).toBe(10);
});

test("starting a Generation recovers the User's crashed Replies first", async () => {
  await setup();
  const crashed = await crashAfterDebit();
  h.redis.advance(h.ctx.timing.lockTtlMs + 1);
  const other = await newChat();
  await (await send(other)).text();
  await h.settle();
  expect((await replyRow(crashed))?.status).toBe("failed");
  // One refunded, one spent by the new Reply.
  expect(await getCredits(h.db, "alice")).toBe(9);
});

test("a Reply that received its first token is never refunded", async () => {
  await setup({ renewMs: 20 });
  // Two tokens, then the model hangs as if the function had frozen.
  h.state.script = { words: words(5), delayMs: 1, hangAt: 2 };
  const chatId = await newChat();
  const body = (await send(chatId)).text();
  await until(
    async () => (await replyRow(chatId))?.firstTokenAt != null,
    "the first token",
  );
  h.redis.advance(h.ctx.timing.lockTtlMs + 1);
  expect(await recoverReplies(h.ctx, "alice")).toBe(0);
  await body;
  await h.settle();
  expect(await recoverReplies(h.ctx, "alice")).toBe(0);
  const reply = await replyRow(chatId);
  expect(reply?.status).toBe("interrupted");
  expect(reply?.creditRefunded).toBe(false);
  expect(await getCredits(h.db, "alice")).toBe(9);
});

test("request bodies over the limit are rejected before they are parsed", async () => {
  await setup();
  const url = "http://test.local/api";
  const declared = new Request(url, {
    method: "POST",
    headers: {
      "x-test-user": "alice",
      "content-type": "application/json",
      "content-length": String(20 * 1024 * 1024),
    },
    body: "{}",
  });
  const tooBig = await createChatRoute(h.ctx, declared);
  expect(tooBig.status).toBe(413);
  expect(await tooBig.json()).toEqual({ error: "payload_too_large" });

  // No content-length: the stream is cut off once it passes the cap.
  let pulled = 0;
  const endless = new ReadableStream<Uint8Array>({
    pull(controller) {
      pulled++;
      controller.enqueue(new Uint8Array(4096).fill(32));
    },
  });
  const streamed = new Request(url, {
    method: "POST",
    headers: { "x-test-user": "alice", "content-type": "application/json" },
    body: endless,
    duplex: "half",
  } as RequestInit);
  const cut = await createChatRoute(h.ctx, streamed);
  expect(cut.status).toBe(413);
  expect(pulled).toBeLessThan(20);

  const unknown = await call(h, createChatRoute, {
    user: "alice",
    body: { model: "openai/gpt-6-luna", extra: true },
  });
  expect(unknown.status).toBe(400);
});
