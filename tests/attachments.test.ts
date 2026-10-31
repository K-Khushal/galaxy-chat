import { afterEach, beforeAll, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import {
  confirmRoute,
  deleteAttachmentRoute,
  presignRoute,
  viewRoute,
} from "../lib/api/attachments";
import {
  createChatRoute,
  deleteChatRoute,
  getChatRoute,
  sendMessageRoute,
} from "../lib/api/chats";
import {
  classifyFile,
  INLINE_TEXT_LIMIT,
  isPdfHeader,
  looksLikeText,
  MAX_FILE_BYTES,
  modelSupport,
  selectFiles,
  sniffImage,
} from "../lib/attachments/rules";
import { r2Storage } from "../lib/attachments/storage";
import {
  deleteChatWithFiles,
  purgeAttachments,
  STALE_AFTER_MS,
} from "../lib/attachments/store";
import { saveByokKey } from "../lib/byok/store";
import { attachment, attachmentTombstone, message } from "../lib/db/schema";
import { findModel } from "../lib/models";
import { RATE_LIMITS } from "../lib/ratelimit";
import { pdf, png, text } from "./support/files";
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
afterEach(closeHarnesses);

async function setup() {
  h = await createHarness();
  await h.addUser("alice");
  await h.addUser("bob");
  // Models that are not Credit models need a BYOK key.
  await saveByokKey(h.db, h.ctx.byokEnv, "alice", "sk-or-v1-".padEnd(48, "a"));
}

type View = { id: string; filename: string; kind: string; size: number };

function presign(
  user: string | null,
  body: { filename: string; contentType: string; size: number },
) {
  return call(h, presignRoute, { user, body });
}

/** Presigns, "uploads" the bytes as the browser would, and confirms. */
async function attach(
  user: string,
  filename: string,
  contentType: string,
  data: Uint8Array,
) {
  const response = await presign(user, {
    filename,
    contentType,
    size: data.length,
  });
  expect(response.status).toBe(201);
  const { attachment: view, upload } = (await response.json()) as {
    attachment: View;
    upload: { headers: Record<string, string> };
  };
  h.storage.upload(
    `u/${user}/${view.id}`,
    data,
    upload.headers["Content-Type"] ?? "",
  );
  const confirmed = await call(h, confirmRoute, {
    user,
    id: view.id,
    method: "POST",
  });
  return { view, confirmed };
}

async function newChat(user = "alice") {
  const response = await call(h, createChatRoute, { user, body: {} });
  return ((await response.json()) as { chat: { id: string } }).chat.id;
}

function send(
  chatId: string,
  attachmentIds: string[],
  options: {
    user?: string;
    text?: string;
    model?: string;
    parentId?: string | null;
  } = {},
) {
  return call(h, sendMessageRoute, {
    user: options.user ?? "alice",
    id: chatId,
    body: {
      trigger: "submit-message",
      parentId: options.parentId ?? null,
      parts:
        options.text === ""
          ? []
          : [{ type: "text", text: options.text ?? "What is this?" }],
      attachmentIds,
      ...(options.model ? { model: options.model } : {}),
    },
  });
}

async function sendAndFinish(...args: Parameters<typeof send>) {
  const response = await send(...args);
  if (response.ok) await response.text();
  await h.settle();
  return response;
}

/** The prompt of the latest Reply request (title requests have none). */
const lastPrompt = () =>
  h.state.calls.filter((call) => call.prompt).at(-1)?.prompt ?? "";

test("presign needs a signed-in user and checks the request", async () => {
  await setup();
  expect(
    (
      await presign(null, {
        filename: "a.png",
        contentType: "image/png",
        size: 10,
      })
    ).status,
  ).toBe(401);
  const bad = [
    { filename: "a.zip", contentType: "application/zip", size: 10 },
    { filename: "a.png", contentType: "image/png", size: MAX_FILE_BYTES + 1 },
    { filename: "a.png", contentType: "image/png", size: 0 },
    { filename: "a.exe", contentType: "application/x-msdownload", size: 10 },
    { filename: "a.svg", contentType: "image/svg+xml", size: 10 },
  ];
  const statuses = await Promise.all(
    bad.map(async (body) => (await presign("alice", body)).status),
  );
  expect(statuses).toEqual([415, 413, 400, 415, 415]);
  expect(await h.db.select().from(attachment)).toHaveLength(0);
});

test("presign signs an immutable owner-scoped key with the type and exact length", async () => {
  await setup();
  const response = await presign("alice", {
    filename: "photo.png",
    contentType: "image/png",
    size: 1234,
  });
  expect(response.status).toBe(201);
  const body = (await response.json()) as {
    attachment: View;
    upload: { url: string; method: string; headers: Record<string, string> };
  };
  expect(body.upload.method).toBe("PUT");
  expect(body.upload.headers).toEqual({
    "Content-Type": "image/png",
    "If-None-Match": "*",
  });
  expect(h.storage.puts).toMatchObject([
    {
      key: `u/alice/${body.attachment.id}`,
      contentType: "image/png",
      contentLength: 1234,
      expiresIn: 300,
    },
  ]);
  const [row] = await h.db.select().from(attachment);
  expect(row).toMatchObject({
    userId: "alice",
    status: "pending",
    chatId: null,
  });
});

test("the real R2 presign binds content type and length and skips optional checksums", async () => {
  const storage = r2Storage({
    R2_ACCOUNT_ID: "acct",
    R2_ACCESS_KEY_ID: "id",
    R2_SECRET_ACCESS_KEY: "secret",
    R2_BUCKET: "bucket",
  });
  const url = new URL(
    await storage.presignPut("u/alice/one", {
      contentType: "image/png",
      contentLength: 99,
      expiresIn: 300,
    }),
  );
  expect(url.origin).toBe("https://acct.r2.cloudflarestorage.com");
  expect(url.pathname).toBe("/bucket/u/alice/one");
  expect(url.searchParams.get("X-Amz-SignedHeaders")).toBe(
    "content-length;content-type;host;if-none-match",
  );
  expect(url.searchParams.get("X-Amz-Expires")).toBe("300");
  expect(
    [...url.searchParams.keys()].some((key) => key.includes("checksum")),
  ).toBe(false);
});

test("presign is rate limited and caps files waiting to be sent", async () => {
  await setup();
  h.state.rateLimited.add("presign");
  expect(
    (
      await presign("alice", {
        filename: "a.png",
        contentType: "image/png",
        size: 5,
      })
    ).status,
  ).toBe(429);
  expect(RATE_LIMITS.presign.limit).toBeGreaterThan(0);
  h.state.rateLimited.clear();
  for (let i = 0; i < 20; i++) {
    expect(
      (
        await presign("alice", {
          filename: `a${i}.txt`,
          contentType: "text/plain",
          size: 5,
        })
      ).status,
    ).toBe(201);
  }
  const over = await presign("alice", {
    filename: "z.txt",
    contentType: "text/plain",
    size: 5,
  });
  expect(over.status).toBe(429);
  expect(await over.json()).toEqual({ error: "attachment_limit" });
  // Another User has their own allowance.
  expect(
    (
      await presign("bob", {
        filename: "z.txt",
        contentType: "text/plain",
        size: 5,
      })
    ).status,
  ).toBe(201);
});

test("only the owner can confirm, open or delete an Attachment", async () => {
  await setup();
  const { view, confirmed } = await attach(
    "alice",
    "a.png",
    "image/png",
    png(),
  );
  expect(confirmed.status).toBe(200);
  for (const handler of [confirmRoute, viewRoute]) {
    const response = await call(h, handler, { user: "bob", id: view.id });
    expect(response.status).toBe(404);
  }
  const removal = await call(h, deleteAttachmentRoute, {
    user: "bob",
    id: view.id,
    method: "DELETE",
  });
  expect(removal.status).toBe(404);
  expect(h.storage.objects.has(`u/alice/${view.id}`)).toBe(true);
  expect((await call(h, viewRoute, { user: null, id: view.id })).status).toBe(
    401,
  );
});

test("confirm refuses an upload that is missing, and is repeatable once ready", async () => {
  await setup();
  const response = await presign("alice", {
    filename: "a.png",
    contentType: "image/png",
    size: 40,
  });
  const { attachment: view } = (await response.json()) as { attachment: View };
  const early = await call(h, confirmRoute, {
    user: "alice",
    id: view.id,
    method: "POST",
  });
  expect(early.status).toBe(409);
  h.storage.upload(`u/alice/${view.id}`, png(32), "image/png");
  for (let i = 0; i < 2; i++) {
    const ok = await call(h, confirmRoute, {
      user: "alice",
      id: view.id,
      method: "POST",
    });
    expect(ok.status).toBe(200);
  }
  const [row] = await h.db.select().from(attachment);
  expect(row?.status).toBe("ready");
});

const rejected: [
  string,
  string,
  string,
  Uint8Array,
  (size: number) => Uint8Array | null,
][] = [
  [
    "an image whose bytes are not an image",
    "a.png",
    "image/png",
    png(),
    () => text("<html>not a png at all, but long enough</html>"),
  ],
  [
    "an image of another type than declared",
    "a.jpg",
    "image/jpeg",
    png(),
    () => png(),
  ],
  [
    "a PDF without the PDF header",
    "a.pdf",
    "application/pdf",
    pdf("x"),
    () => text("MZ executable pretending"),
  ],
  [
    "a text file with binary content",
    "a.txt",
    "text/plain",
    text("hello world hello"),
    (size) =>
      Uint8Array.from({ length: size }, (_, i) => (i % 7 === 0 ? 0 : 65)),
  ],
];
for (const [name, filename, type, declared, replacement] of rejected) {
  test(`confirm rejects ${name} and deletes it`, async () => {
    await setup();
    const response = await presign("alice", {
      filename,
      contentType: type,
      size: declared.length,
    });
    const { attachment: view } = (await response.json()) as {
      attachment: View;
    };
    h.storage.upload(
      `u/alice/${view.id}`,
      replacement(declared.length) ?? declared,
      type,
    );
    const confirmed = await call(h, confirmRoute, {
      user: "alice",
      id: view.id,
      method: "POST",
    });
    expect(confirmed.status).toBe(422);
    expect(await confirmed.json()).toEqual({ error: "attachment_invalid" });
    expect(h.storage.objects.size).toBe(0);
    expect(await h.db.select().from(attachment)).toHaveLength(0);
  });
}

test("confirm rejects a size or content type that differs from what was signed", async () => {
  await setup();
  for (const [bytes, stored] of [
    [png(100), "image/png"],
    [png(32), "image/webp"],
    [png(32), "application/octet-stream"],
  ] as const) {
    const response = await presign("alice", {
      filename: "a.png",
      contentType: "image/png",
      size: png(32).length,
    });
    const { attachment: view } = (await response.json()) as {
      attachment: View;
    };
    h.storage.upload(`u/alice/${view.id}`, bytes, stored);
    const confirmed = await call(h, confirmRoute, {
      user: "alice",
      id: view.id,
      method: "POST",
    });
    expect(confirmed.status).toBe(422);
  }
  expect(h.storage.objects.size).toBe(0);
});

test("text and code files are accepted whatever type the browser reports", async () => {
  await setup();
  const code = text("export const x = 1;\n// héllo\n");
  const { view, confirmed } = await attach("alice", "x.ts", "video/mp2t", code);
  expect(confirmed.status).toBe(200);
  expect(view.kind).toBe("text");
  const [row] = await h.db.select().from(attachment);
  expect(row?.contentType).toBe("text/plain");
});

test("a Message carries its Attachments, and they belong to its Chat", async () => {
  await setup();
  const { view } = await attach("alice", "a.png", "image/png", png());
  const chatId = await newChat();
  const response = await sendAndFinish(chatId, [view.id]);
  expect(response.status).toBe(200);
  const [row] = await h.db.select().from(attachment);
  expect(row?.chatId).toBe(chatId);
  const chat = (await (
    await call(h, getChatRoute, { user: "alice", id: chatId })
  ).json()) as {
    messages: {
      role: string;
      parts: Record<string, string>[];
    }[];
  };
  expect(chat.messages[0]?.parts).toEqual([
    {
      type: "file",
      mediaType: "image/png",
      filename: "a.png",
      url: `/api/attachments/${view.id}`,
    },
    { type: "text", text: "What is this?" },
  ]);
  // The route that opens it redirects to a short-lived read URL.
  const opened = await call(h, viewRoute, { user: "alice", id: view.id });
  expect(opened.status).toBe(302);
  expect(opened.headers.get("location")).toContain(
    `https://storage.test/get/u/alice/${view.id}`,
  );
  expect(h.storage.gets.at(-1)?.disposition).toStartWith("inline;");
});

test("a Message can only use its own owner's ready Attachments", async () => {
  await setup();
  const mine = await attach("alice", "a.png", "image/png", png());
  const theirs = await attach("bob", "b.png", "image/png", png());
  const pending = await presign("alice", {
    filename: "c.png",
    contentType: "image/png",
    size: 40,
  });
  const pendingId = ((await pending.json()) as { attachment: View }).attachment
    .id;
  const chatId = await newChat();

  const stolen = await send(chatId, [theirs.view.id]);
  expect(stolen.status).toBe(404);
  expect((await send(chatId, [pendingId])).status).toBe(404);
  expect((await send(chatId, ["missing"])).status).toBe(404);
  // Bob cannot send into Alice's Chat, nor Alice's file into his own.
  expect((await send(chatId, [mine.view.id], { user: "bob" })).status).toBe(
    404,
  );
  const bobChat = await newChat("bob");
  expect((await send(bobChat, [mine.view.id], { user: "bob" })).status).toBe(
    404,
  );
  expect(await h.db.select().from(message)).toHaveLength(0);

  // Once used in one Chat, another Chat cannot take it.
  expect((await sendAndFinish(chatId, [mine.view.id])).status).toBe(200);
  const other = await newChat();
  expect((await send(other, [mine.view.id])).status).toBe(404);
});

test("five files per Message at most, and a Message needs text or a file", async () => {
  await setup();
  const ids: string[] = [];
  for (let i = 0; i < 6; i++) {
    ids.push(
      (await attach("alice", `f${i}.txt`, "text/plain", text(`file ${i}`))).view
        .id,
    );
  }
  const chatId = await newChat();
  expect((await send(chatId, ids)).status).toBe(400);
  expect(
    (await send(chatId, [ids[0] as string, ids[0] as string])).status,
  ).toBe(400);
  expect((await send(chatId, [], { text: "" })).status).toBe(400);
  expect((await sendAndFinish(chatId, ids.slice(0, 5))).status).toBe(200);
  expect(await h.db.select().from(message)).toHaveLength(2);
});

test("a Message of only a file is allowed", async () => {
  await setup();
  const { view } = await attach(
    "alice",
    "notes.txt",
    "text/plain",
    text("remember the milk"),
  );
  const chatId = await newChat();
  expect((await sendAndFinish(chatId, [view.id], { text: "" })).status).toBe(
    200,
  );
  expect(lastPrompt()).toContain("remember the milk");
});

test("images go to the model as a read URL for the User's own file", async () => {
  await setup();
  const { view } = await attach("alice", "a.png", "image/png", png());
  const chatId = await newChat();
  await sendAndFinish(chatId, [view.id]);
  const prompt = lastPrompt();
  expect(prompt).toContain(`https://storage.test/get/u/alice/${view.id}`);
  expect(prompt).toContain("image/png");
  expect(h.state.calls.at(-1)?.apiKey).toBeDefined();
});

test("PDFs go to models that read them as a file", async () => {
  await setup();
  expect(findModel("openai/gpt-6-luna")?.capabilities.pdf).toBe(true);
  const { view } = await attach(
    "alice",
    "r.pdf",
    "application/pdf",
    pdf("Revenue grew"),
  );
  const chatId = await newChat();
  await sendAndFinish(chatId, [view.id], { model: "openai/gpt-6-luna" });
  const prompt = lastPrompt();
  expect(prompt).toContain(`https://storage.test/get/u/alice/${view.id}`);
  expect(prompt).toContain("application/pdf");
  expect(prompt).not.toContain("Revenue grew");
});

test("PDFs go as extracted text to models that cannot read them, and the text is kept", async () => {
  await setup();
  const model = "deepseek/deepseek-v4.1-flash";
  expect(findModel(model)?.capabilities.pdf).toBe(false);
  const { view } = await attach(
    "alice",
    "r.pdf",
    "application/pdf",
    pdf("Revenue grew twelve percent"),
  );
  const chatId = await newChat();
  const response = await sendAndFinish(chatId, [view.id], { model });
  expect(response.status).toBe(200);
  const prompt = lastPrompt();
  expect(prompt).toContain("Revenue grew twelve percent");
  expect(prompt).toContain('filename=\\"r.pdf\\"');
  expect(prompt).not.toContain("storage.test");
  const [row] = await h.db
    .select()
    .from(attachment)
    .where(eq(attachment.id, view.id));
  expect(row?.extractedText).toBe("Revenue grew twelve percent");

  // The next Generation reuses the stored text instead of reading the file.
  h.storage.objects.delete(`u/alice/${view.id}`);
  const next = await sendAndFinish(chatId, [], {
    text: "And?",
    model,
    parentId: (
      (await (
        await call(h, getChatRoute, { user: "alice", id: chatId })
      ).json()) as { messages: { id: string }[] }
    ).messages[1]?.id,
  });
  expect(next.status).toBe(200);
  expect(lastPrompt()).toContain("Revenue grew twelve percent");
});

test("a PDF with no readable text is described, not dropped", async () => {
  await setup();
  const model = "deepseek/deepseek-v4.1-flash";
  const { view } = await attach(
    "alice",
    "scan.pdf",
    "application/pdf",
    pdf(""),
  );
  const chatId = await newChat();
  await sendAndFinish(chatId, [view.id], { model });
  expect(lastPrompt()).toContain("no text could be read");
});

test("text files go in as text with a cap on the length", async () => {
  await setup();
  const long = "x".repeat(INLINE_TEXT_LIMIT + 500);
  const { view } = await attach("alice", "big.log", "text/plain", text(long));
  const small = await attach(
    "alice",
    "s.py",
    "text/x-python",
    text("print('hi')"),
  );
  const chatId = await newChat();
  await sendAndFinish(chatId, [view.id, small.view.id]);
  const prompt = lastPrompt();
  expect(prompt).toContain("print('hi')");
  expect(prompt).toContain(
    `Only the first ${INLINE_TEXT_LIMIT.toLocaleString("en-US")} characters`,
  );
  expect(prompt).not.toContain("x".repeat(INLINE_TEXT_LIMIT + 1));
  expect(prompt).toContain("x".repeat(INLINE_TEXT_LIMIT));
});

test("a model that cannot read images is refused for an image, but not for history", async () => {
  await setup();
  const custom = "acme/text-only";
  const image = await attach("alice", "a.png", "image/png", png());
  const chatId = await newChat();
  const refused = await send(chatId, [image.view.id], { model: custom });
  expect(refused.status).toBe(400);
  expect(await refused.json()).toEqual({ error: "attachment_unsupported" });
  expect(await h.db.select().from(message)).toHaveLength(0);

  // Sent to a model with vision, then regenerated on one without: a note.
  await sendAndFinish(chatId, [image.view.id]);
  const reply = (
    await h.db.select().from(message).where(eq(message.role, "assistant"))
  )[0];
  const regenerate = await call(h, sendMessageRoute, {
    user: "alice",
    id: chatId,
    body: {
      trigger: "regenerate-message",
      messageId: reply?.id,
      model: custom,
    },
  });
  expect(regenerate.status).toBe(200);
  await regenerate.text();
  await h.settle();
  expect(lastPrompt()).toContain("acme/text-only cannot read images");
  expect(lastPrompt()).not.toContain("storage.test");
});

test("capability rules disable only what a model cannot read", () => {
  const luna = findModel("openai/gpt-6-luna");
  const support = modelSupport(luna?.capabilities ?? null, "GPT-6 Luna");
  const files = [
    { name: "a.png", type: "image/png", size: 10 },
    { name: "a.pdf", type: "application/pdf", size: 10 },
    { name: "a.rs", type: "", size: 10 },
  ];
  expect(selectFiles(files, 0, support).rejected).toEqual([]);
  const blind = modelSupport(
    {
      ...(luna?.capabilities as NonNullable<typeof luna>["capabilities"]),
      vision: false,
    },
    "Textbot",
  );
  const result = selectFiles(files, 0, blind);
  expect(result.rejected).toEqual([
    { code: "unsupported", name: "a.png", kind: "image" },
  ]);
  expect(result.accepted.map((entry) => entry.kind)).toEqual(["pdf", "text"]);
  // A custom model's abilities are unknown: no images, PDFs as text.
  const custom = modelSupport(null, "acme/x");
  expect(custom).toEqual({ vision: false, pdf: false, label: "acme/x" });
});

test("the client rules enforce size, count and type before upload", () => {
  const support = modelSupport(
    findModel("openai/gpt-6-luna")?.capabilities ?? null,
    "GPT-6 Luna",
  );
  const six = Array.from({ length: 6 }, (_, i) => ({
    name: `f${i}.txt`,
    type: "text/plain",
    size: 1,
  }));
  const counted = selectFiles(six, 0, support);
  expect(counted.accepted).toHaveLength(5);
  expect(counted.rejected).toEqual([{ code: "too_many", name: "f5.txt" }]);
  expect(selectFiles(six.slice(0, 1), 5, support).rejected).toHaveLength(1);
  const mixed = selectFiles(
    [
      { name: "big.png", type: "image/png", size: MAX_FILE_BYTES + 1 },
      { name: "empty.txt", type: "text/plain", size: 0 },
      { name: "a.zip", type: "application/zip", size: 5 },
      { name: "ok.png", type: "image/png", size: MAX_FILE_BYTES },
    ],
    0,
    support,
  );
  expect(mixed.rejected.map((entry) => entry.code)).toEqual([
    "too_large",
    "empty",
    "type",
  ]);
  expect(mixed.accepted).toHaveLength(1);
  expect(classifyFile("x.svg", "image/svg+xml")).toBeNull();
  expect(sniffImage(png())).toBe("image/png");
  expect(sniffImage(text("GIF89a...."))).toBe("image/gif");
});

test("a continued Reply and a regenerated one get fresh read URLs", async () => {
  await setup();
  const { view } = await attach("alice", "a.png", "image/png", png());
  const chatId = await newChat();
  await sendAndFinish(chatId, [view.id]);
  const first = h.storage.gets.length;
  const [reply] = await h.db
    .select()
    .from(message)
    .where(eq(message.role, "assistant"));
  await h.db
    .update(message)
    .set({ status: "interrupted" })
    .where(eq(message.id, reply?.id as string));
  const resumed = await call(h, sendMessageRoute, {
    user: "alice",
    id: chatId,
    body: { trigger: "continue-message", messageId: reply?.id },
  });
  expect(resumed.status).toBe(200);
  await resumed.text();
  await h.settle();
  expect(h.storage.gets.length).toBeGreaterThan(first);
  expect(lastPrompt()).toContain(`storage.test/get/u/alice/${view.id}`);
});

test("editing a Message keeps its files", async () => {
  await setup();
  const { view } = await attach("alice", "a.png", "image/png", png());
  const chatId = await newChat();
  await sendAndFinish(chatId, [view.id]);
  const edited = await sendAndFinish(chatId, [view.id], {
    text: "Better question",
  });
  expect(edited.status).toBe(200);
  const users = await h.db
    .select()
    .from(message)
    .where(eq(message.role, "user"));
  expect(users).toHaveLength(2);
  expect(JSON.stringify(users[1]?.parts)).toContain(view.id);
});

test("unsent files can be removed, sent ones cannot", async () => {
  await setup();
  const unsent = await attach("alice", "a.png", "image/png", png());
  const removed = await call(h, deleteAttachmentRoute, {
    user: "alice",
    id: unsent.view.id,
    method: "DELETE",
  });
  expect(removed.status).toBe(204);
  expect(h.storage.objects.size).toBe(0);
  expect(await h.db.select().from(attachment)).toHaveLength(0);

  const sent = await attach("alice", "b.png", "image/png", png());
  await sendAndFinish(await newChat(), [sent.view.id]);
  const refused = await call(h, deleteAttachmentRoute, {
    user: "alice",
    id: sent.view.id,
    method: "DELETE",
  });
  expect(refused.status).toBe(409);
  expect(h.storage.objects.size).toBe(1);
});

test("deleting a Chat deletes its files and leaves other Chats' alone", async () => {
  await setup();
  const one = await attach("alice", "one.png", "image/png", png());
  const two = await attach("alice", "two.png", "image/png", png());
  const loose = await attach("alice", "loose.png", "image/png", png());
  const chatOne = await newChat();
  const chatTwo = await newChat();
  await sendAndFinish(chatOne, [one.view.id]);
  await sendAndFinish(chatTwo, [two.view.id]);

  h.storage.failRemove = true;
  const failed = await call(h, deleteChatRoute, {
    user: "alice",
    id: chatOne,
    method: "DELETE",
  });
  expect(failed.status).toBe(500);
  expect(
    (await call(h, getChatRoute, { user: "alice", id: chatOne })).status,
  ).toBe(200);
  expect(h.storage.objects.size).toBe(3);

  h.storage.failRemove = false;
  const deleted = await call(h, deleteChatRoute, {
    user: "alice",
    id: chatOne,
    method: "DELETE",
  });
  expect(deleted.status).toBe(204);
  expect([...h.storage.objects.keys()].sort()).toEqual(
    [`u/alice/${two.view.id}`, `u/alice/${loose.view.id}`].sort(),
  );
  const rows = await h.db.select().from(attachment);
  expect(rows.map((row) => row.id).sort()).toEqual(
    [two.view.id, loose.view.id].sort(),
  );
});

test("deleting a Chat with no files never touches storage", async () => {
  await setup();
  const chatId = await newChat();
  h.storage.failRemove = true;
  h.ctx.storage = {
    ...h.ctx.storage,
    remove: async () => {
      throw new Error("storage must not be used");
    },
  };
  const deleted = await call(h, deleteChatRoute, {
    user: "alice",
    id: chatId,
    method: "DELETE",
  });
  expect(deleted.status).toBe(204);
});

test("account deletion leaves tombstones that survive User cascades", async () => {
  await setup();
  const mine = await attach("alice", "a.png", "image/png", png());
  const theirs = await attach("bob", "b.png", "image/png", png());
  await sendAndFinish(await newChat(), [mine.view.id]);
  const { deleteAccountRoute } = await import("../lib/api/settings");
  expect(
    (
      await call(h, deleteAccountRoute, {
        user: "alice",
        body: { confirmation: "DELETE" },
      })
    ).status,
  ).toBe(204);
  expect(h.storage.objects.has(`u/alice/${mine.view.id}`)).toBe(false);
  h.storage.upload(`u/alice/${mine.view.id}`, png(), "image/png");
  const [tombstone] = await h.db.select().from(attachmentTombstone);
  expect(tombstone?.id).toBe(mine.view.id);
  await expireTombstones();
  await purgeAttachments(h.ctx);
  expect(storedKeys()).toEqual([`u/bob/${theirs.view.id}`]);
});

test("the per-Chat helper only touches that Chat for that User", async () => {
  await setup();
  const mine = await attach("alice", "a.png", "image/png", png());
  const chatId = await newChat();
  await sendAndFinish(chatId, [mine.view.id]);
  expect(await deleteChatWithFiles(h.ctx, "bob", chatId)).toBe(false);
  expect(h.storage.objects.size).toBe(1);
  expect(await deleteChatWithFiles(h.ctx, "alice", chatId)).toBe(true);
  expect(h.storage.objects.size).toBe(0);
  expect(await h.db.select().from(attachment)).toHaveLength(0);
});

test("abandoned uploads are deleted on the owner's next upload; sent ones stay", async () => {
  await setup();
  const kept = await attach("alice", "kept.png", "image/png", png());
  await sendAndFinish(await newChat(), [kept.view.id]);
  const unconfirmed = await presign("alice", {
    filename: "x.png",
    contentType: "image/png",
    size: 40,
  });
  const abandoned = await attach("alice", "old.png", "image/png", png());
  const otherUser = await attach("bob", "bob.png", "image/png", png());
  const ancient = new Date(Date.now() - STALE_AFTER_MS - 60_000);
  await h.pg.query(`UPDATE attachment SET created_at = $1`, [ancient]);
  h.storage.upload(
    `u/alice/${((await unconfirmed.json()) as { attachment: View }).attachment.id}`,
    png(),
    "image/png",
  );

  expect(
    (
      await presign("alice", {
        filename: "new.png",
        contentType: "image/png",
        size: 40,
      })
    ).status,
  ).toBe(201);
  const left = await h.db.select().from(attachment);
  expect(left.map((row) => row.id).sort()).toEqual(
    [
      kept.view.id,
      otherUser.view.id,
      left.find((row) => row.filename === "new.png")?.id as string,
    ].sort(),
  );
  expect(h.storage.objects.has(`u/alice/${abandoned.view.id}`)).toBe(false);
  expect(
    [...h.storage.objects.keys()].some((key) => key.startsWith("tmp/")),
  ).toBe(false);
  expect(h.storage.objects.has(`u/alice/${kept.view.id}`)).toBe(true);
  expect(h.storage.objects.has(`u/bob/${otherUser.view.id}`)).toBe(true);
});

test("magic bytes tell real images, PDFs and text from impostors", () => {
  expect(sniffImage(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]))).toBe(
    "image/jpeg",
  );
  expect(sniffImage(text("RIFF\u0000\u0000\u0000\u0000WEBPVP8 "))).toBe(
    "image/webp",
  );
  expect(sniffImage(text("GIF87a"))).toBe("image/gif");
  expect(sniffImage(text("<svg xmlns='x'></svg>"))).toBeNull();
  expect(sniffImage(new Uint8Array())).toBeNull();
  expect(isPdfHeader(text("%PDF-1.7\n"))).toBe(true);
  expect(isPdfHeader(text("PK\u0003\u0004"))).toBe(false);
  expect(looksLikeText(text("héllo wörld ✓"), false)).toBe(true);
  expect(looksLikeText(Uint8Array.from([104, 0, 105]), false)).toBe(false);
  expect(looksLikeText(Uint8Array.from([0xff, 0xfe, 0x41]), false)).toBe(false);
  // A sample cut in the middle of a character is fine only when truncated.
  const cut = text("ab✓").slice(0, 4);
  expect(looksLikeText(cut, true)).toBe(true);
  expect(looksLikeText(cut, false)).toBe(false);
});

/** A gate a test opens when it wants a paused step to continue. */
function gate() {
  let open!: () => void;
  const passed = new Promise<void>((resolve) => {
    open = resolve;
  });
  let reached!: () => void;
  const arrived = new Promise<void>((resolve) => {
    reached = resolve;
  });
  return { open, passed, reached, arrived };
}

/** Pauses the first call of a storage method until the gate opens. */
function pauseOnce<K extends "presignGet" | "remove" | "head" | "read">(
  method: K,
  at: ReturnType<typeof gate>,
) {
  const storage = h.storage;
  const original = storage[method].bind(storage) as (
    ...args: unknown[]
  ) => Promise<unknown>;
  let paused = false;
  (storage as unknown as Record<string, unknown>)[method] = async (
    ...args: unknown[]
  ) => {
    if (!paused) {
      paused = true;
      at.reached();
      await at.passed;
    }
    return original(...args);
  };
}

const storedKeys = () => [...h.storage.objects.keys()].sort();

test("a send cannot claim a file whose delete has begun, and the delete finishes", async () => {
  await setup();
  const file = await attach("alice", "a.png", "image/png", png());
  const chatId = await newChat();

  // The send has loaded the file as ready and is about to claim it.
  const beforeClaim = gate();
  pauseOnce("presignGet", beforeClaim);
  const sending = send(chatId, [file.view.id]);
  await beforeClaim.arrived;

  // The delete takes the file out of circulation, then stalls in storage.
  const inStorage = gate();
  pauseOnce("remove", inStorage);
  const deleting = call(h, deleteAttachmentRoute, {
    user: "alice",
    id: file.view.id,
    method: "DELETE",
  });
  await inStorage.arrived;
  const [marked] = await h.db.select().from(attachment);
  expect(marked?.status).toBe("deleted");

  beforeClaim.open();
  const sent = await sending;
  expect(sent.status).toBe(404);
  expect(await h.db.select().from(message)).toHaveLength(0);

  inStorage.open();
  expect((await deleting).status).toBe(204);
  expect(await h.db.select().from(attachment)).toHaveLength(0);
  expect(storedKeys()).toEqual([]);
});

test("a delete after the claim answers 409 and the Message keeps its file", async () => {
  await setup();
  const file = await attach("alice", "a.png", "image/png", png());
  const chatId = await newChat();
  const beforeClaim = gate();
  pauseOnce("presignGet", beforeClaim);
  const sending = send(chatId, [file.view.id]);
  await beforeClaim.arrived;
  beforeClaim.open();
  const response = await sending;
  expect(response.status).toBe(200);
  await response.text();
  await h.settle();

  const removal = await call(h, deleteAttachmentRoute, {
    user: "alice",
    id: file.view.id,
    method: "DELETE",
  });
  expect(removal.status).toBe(409);
  const [row] = await h.db.select().from(attachment);
  expect(row).toMatchObject({ status: "ready", chatId });
  expect(storedKeys()).toEqual([`u/alice/${file.view.id}`]);
});

test("a delete that finds the file claimed first changes nothing", async () => {
  await setup();
  const file = await attach("alice", "a.png", "image/png", png());
  const chatId = await newChat();
  await sendAndFinish(chatId, [file.view.id]);
  const calls: string[][] = [];
  const remove = h.storage.remove.bind(h.storage);
  h.storage.remove = async (keys) => {
    calls.push(keys);
    return remove(keys);
  };
  // Many deletes racing: none gets past the conditional transition.
  const results = await Promise.all(
    [1, 2, 3].map(() =>
      call(h, deleteAttachmentRoute, {
        user: "alice",
        id: file.view.id,
        method: "DELETE",
      }),
    ),
  );
  expect(results.map((r) => r.status)).toEqual([409, 409, 409]);
  expect(calls).toEqual([]);
  expect(storedKeys()).toEqual([`u/alice/${file.view.id}`]);
});

test("a failed storage delete leaves the file deleting, unusable and retryable", async () => {
  await setup();
  const file = await attach("alice", "a.png", "image/png", png());
  h.storage.failRemove = true;
  const failed = await call(h, deleteAttachmentRoute, {
    user: "alice",
    id: file.view.id,
    method: "DELETE",
  });
  expect(failed.status).toBe(500);
  const [row] = await h.db.select().from(attachment);
  expect(row?.status).toBe("deleted");
  const chatId = await newChat();
  expect((await send(chatId, [file.view.id])).status).toBe(404);
  expect(
    (await call(h, viewRoute, { user: "alice", id: file.view.id })).status,
  ).toBe(404);

  h.storage.failRemove = false;
  const retried = await call(h, deleteAttachmentRoute, {
    user: "alice",
    id: file.view.id,
    method: "DELETE",
  });
  expect(retried.status).toBe(204);
  expect(await h.db.select().from(attachment)).toHaveLength(0);
  expect(storedKeys()).toEqual([]);
});

test("deleting a Chat locks out a send that would claim a file for it", async () => {
  await setup();
  const sent = await attach("alice", "sent.png", "image/png", png());
  const late = await attach("alice", "late.png", "image/png", png());
  const chatId = await newChat();
  await sendAndFinish(chatId, [sent.view.id]);

  // The delete has scanned the Chat's files and is removing their objects.
  const inStorage = gate();
  pauseOnce("remove", inStorage);
  const deleting = call(h, deleteChatRoute, {
    user: "alice",
    id: chatId,
    method: "DELETE",
  });
  await inStorage.arrived;

  // A send for the same Chat now tries to claim the other file.
  const sending = send(chatId, [late.view.id]);
  await new Promise((done) => setTimeout(done, 50));
  inStorage.open();
  expect((await deleting).status).toBe(204);
  expect((await sending).ok).toBe(false);
  await h.settle();

  // The late file was never tied to the deleted Chat: it is still a plain
  // unsent file with its object, and nothing in the bucket lacks a row.
  const rows = await h.db.select().from(attachment);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ id: late.view.id, chatId: null });
  expect(storedKeys()).toEqual([`u/alice/${late.view.id}`]);
  expect(await h.db.select().from(message)).toHaveLength(0);
});

async function pendingUpload(data = png()) {
  const response = await presign("alice", {
    filename: "a.png",
    contentType: "image/png",
    size: data.length,
  });
  const { attachment: view } = (await response.json()) as { attachment: View };
  h.storage.upload(`u/alice/${view.id}`, data, "image/png");
  return view;
}
const confirm = (id: string) =>
  call(h, confirmRoute, { user: "alice", id, method: "POST" });
const remove = (id: string) =>
  call(h, deleteAttachmentRoute, { user: "alice", id, method: "DELETE" });

test("a repeated conditional PUT after confirm cannot change the object", async () => {
  await setup();
  const file = await attach("alice", "a.png", "image/png", png());
  const key = `u/alice/${file.view.id}`;
  expect(() =>
    h.storage.upload(key, text("different bytes"), "image/png"),
  ).toThrow("object changed");
  expect((await confirm(file.view.id)).status).toBe(200);
  expect(h.storage.objects.get(key)?.bytes).toEqual(png());
});

test("concurrent confirms validate immutable bytes and return the same result", async () => {
  await setup();
  const view = await pendingUpload();
  const results = await Promise.all([
    confirm(view.id),
    confirm(view.id),
    confirm(view.id),
  ]);
  expect(results.map((r) => r.status)).toEqual([200, 200, 200]);
  const bodies = await Promise.all(results.map((r) => r.json()));
  expect(bodies[0]).toEqual(bodies[1]);
  expect(bodies[1]).toEqual(bodies[2]);
  expect((await h.db.select().from(attachment))[0]?.status).toBe("ready");
});

test("gap 1: a delayed confirm cannot overwrite another confirm's ready object", async () => {
  await setup();
  const view = await pendingUpload();
  const atRead = gate();
  pauseOnce("read", atRead);
  const delayed = confirm(view.id);
  await atRead.arrived;
  expect((await confirm(view.id)).status).toBe(200);
  expect(() =>
    h.storage.upload(`u/alice/${view.id}`, text("replacement"), "image/png"),
  ).toThrow();
  atRead.open();
  expect((await delayed).status).toBe(200);
  expect(h.storage.objects.get(`u/alice/${view.id}`)?.bytes).toEqual(png());
});

test("delete then PUT before expiry is tracked and purged after expiry", async () => {
  await setup();
  const view = await pendingUpload();
  expect((await remove(view.id)).status).toBe(204);
  const key = `u/alice/${view.id}`;
  h.storage.upload(key, png(), "image/png");
  await purgeAttachments(h.ctx);
  expect(h.storage.objects.has(key)).toBe(true);
  await expireTombstones();
  await purgeAttachments(h.ctx);
  expect(h.storage.objects.has(key)).toBe(false);
  expect(await h.db.select().from(attachmentTombstone)).toHaveLength(1);
});

test("gap 2: confirm finishing after deletion writes no untracked object", async () => {
  await setup();
  const view = await pendingUpload();
  const atRead = gate();
  const read = h.storage.read.bind(h.storage);
  h.storage.read = async (...args) => {
    const bytes = await read(...args);
    atRead.reached();
    await atRead.passed;
    return bytes;
  };
  const delayed = confirm(view.id);
  await atRead.arrived;
  expect((await remove(view.id)).status).toBe(204);
  atRead.open();
  expect((await delayed).status).toBe(404);
  expect(storedKeys()).toEqual([]);
  expect(await h.db.select().from(attachmentTombstone)).toHaveLength(1);
});

test("a PUT accepted before expiry but committed after purge remains tracked", async () => {
  await setup();
  const view = await pendingUpload();
  await remove(view.id);
  await expireTombstones();
  await purgeAttachments(h.ctx);
  // R2 checks If-None-Match at commit; expiry does not establish finality.
  h.storage.upload(`u/alice/${view.id}`, png(), "image/png");
  await h.pg.query(
    `UPDATE attachment_tombstone SET next_purge_at = now() - interval '1 second'`,
  );
  await purgeAttachments(h.ctx);
  expect(storedKeys()).toEqual([]);
});

test("account route promptly removes fresh confirmed objects despite purge backlog", async () => {
  await setup();
  const { view, confirmed } = await attach(
    "alice",
    "a.png",
    "image/png",
    png(),
  );
  expect(confirmed.status).toBe(200);
  await h.pg.query(`INSERT INTO attachment_tombstone (id, key, purge_after, next_purge_at)
    SELECT 'old-' || n, 'backlog/' || n, now() - interval '2 hours', now() - interval '2 hours'
    FROM generate_series(1, 150) n`);
  const { deleteAccountRoute } = await import("../lib/api/settings");
  const response = await call(h, deleteAccountRoute, {
    user: "alice",
    body: { confirmation: "DELETE" },
  });
  expect(response.status).toBe(204);
  expect(await h.db.select().from(attachment)).toHaveLength(0);
  const key = `u/alice/${view.id}`;
  expect(h.storage.objects.has(key)).toBe(false);
  const [row] = await h.db
    .select()
    .from(attachmentTombstone)
    .where(eq(attachmentTombstone.id, view.id));
  expect(row?.purgeAfter.getTime()).toBeGreaterThan(Date.now());
  h.storage.upload(key, png(), "image/png");
  await h.pg.query(
    `UPDATE attachment_tombstone SET purge_after = now() - interval '1 second' WHERE id = $1`,
    [view.id],
  );
  await purgeAttachments(h.ctx);
  await purgeAttachments(h.ctx);
  expect(h.storage.objects.has(key)).toBe(false);
});

async function expireTombstones() {
  await h.pg.query(
    `UPDATE attachment_tombstone SET purge_after = now() - interval '1 second', next_purge_at = now() - interval '1 second'`,
  );
}

test("one failing key backs off while all 150 other tombstones purge", async () => {
  await setup();
  await h.pg.query(`INSERT INTO attachment_tombstone (id, key, purge_after, next_purge_at)
    SELECT 'purge-' || n, 'purge/' || n, now() - interval '25 hours', now() - interval '25 hours'
    FROM generate_series(0, 150) n`);
  for (let n = 0; n <= 150; n++)
    h.storage.upload(`purge/${n}`, png(), "image/png");
  const remove = h.storage.remove.bind(h.storage);
  let failures = 0;
  h.storage.remove = async (keys) => {
    if (keys.includes("purge/0")) {
      failures++;
      throw new Error("storage unavailable");
    }
    await remove(keys);
  };
  await purgeAttachments(h.ctx);
  await purgeAttachments(h.ctx);
  expect(storedKeys()).toEqual(["purge/0"]);
  expect(failures).toBe(1);
  const [row] = await h.db.select().from(attachmentTombstone);
  expect(row?.attempts).toBe(1);
  expect(row?.nextPurgeAt.getTime()).toBeGreaterThan(Date.now());
  expect(await h.db.select().from(attachmentTombstone)).toHaveLength(1);
  // A failed old tombstone survives until a successful retry.
  h.storage.remove = remove;
  await h.pg.query(
    `UPDATE attachment_tombstone SET next_purge_at = now() - interval '1 second'`,
  );
  await purgeAttachments(h.ctx);
  expect(storedKeys()).toEqual([]);
  expect(await h.db.select().from(attachmentTombstone)).toHaveLength(0);
});

test("purge uses database time and retains recent tombstones after successful deletion", async () => {
  await setup();
  await h.pg.query(`INSERT INTO attachment_tombstone (id, key, purge_after, next_purge_at) VALUES
    ('recent', 'recent', now() - interval '1 hour', now() - interval '1 hour'),
    ('future-expiry', 'future-expiry', now() + interval '1 hour', now() - interval '1 hour'),
    ('future-retry', 'future-retry', now() - interval '1 hour', now() + interval '1 hour')`);
  for (const key of ["recent", "future-expiry", "future-retry"])
    h.storage.upload(key, png(), "image/png");
  await purgeAttachments(h.ctx);
  await purgeAttachments(h.ctx);
  expect(storedKeys().sort()).toEqual(["future-expiry", "future-retry"]);
  expect(await h.db.select().from(attachmentTombstone)).toHaveLength(3);
  const [recent] = await h.db
    .select()
    .from(attachmentTombstone)
    .where(eq(attachmentTombstone.id, "recent"));
  expect(recent?.nextPurgeAt.getTime()).toBeLessThan(Date.now() + 61 * 60_000);
  expect(recent?.nextPurgeAt.getTime()).toBeGreaterThan(Date.now());
});

test("stale Attachment timestamps remain correct outside UTC", async () => {
  await setup();
  await h.pg.query(`SET TIME ZONE 'Asia/Kolkata'`);
  try {
    const old = await pendingUpload();
    const fresh = await pendingUpload();
    await h.pg.query(
      `UPDATE attachment SET created_at = now() - interval '25 hours' WHERE id = $1`,
      [old.id],
    );
    const { cleanupStaleAttachments } = await import(
      "../lib/attachments/store"
    );
    expect(await cleanupStaleAttachments(h.ctx, "alice")).toBe(1);
    expect(h.storage.objects.has(`u/alice/${old.id}`)).toBe(false);
    expect(h.storage.objects.has(`u/alice/${fresh.id}`)).toBe(true);
  } finally {
    await h.pg.query(`SET TIME ZONE 'UTC'`);
  }
});

test("account route retries captured keys after the User cascade on storage failure", async () => {
  await setup();
  const { view } = await attach("alice", "a.png", "image/png", png());
  const key = `u/alice/${view.id}`;
  const remove = h.storage.remove.bind(h.storage);
  let attempts = 0;
  h.storage.remove = async (keys) => {
    expect(keys).toEqual([key]);
    expect(
      (await h.pg.query(`SELECT id FROM "user" WHERE id = 'alice'`)).rows,
    ).toHaveLength(0);
    if (++attempts === 1) throw new Error("storage unavailable");
    await remove(keys);
  };
  const { deleteAccountRoute } = await import("../lib/api/settings");
  expect(
    (
      await call(h, deleteAccountRoute, {
        user: "alice",
        body: { confirmation: "DELETE" },
      })
    ).status,
  ).toBe(204);
  await h.settle();
  expect(attempts).toBe(2);
  expect(h.storage.objects.has(key)).toBe(false);
  expect(await h.db.select().from(attachmentTombstone)).toHaveLength(1);
});
