import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { boundedLimit } from "@/lib/actions/chat/chat";
import { lockAttachments } from "@/lib/attachments/store";
import { requireChatAccess } from "@/lib/auth/access";
import { lockByokResources } from "@/lib/byok/store";
import { requireDb } from "@/lib/db/client";
import { chatMessage, chat as chatTable } from "@/lib/db/schema";
import { AppError } from "@/lib/errors";
import type { ChatMessageRole, TypeChatMessage } from "@/lib/types";

export type ChatMessage = TypeChatMessage;

export type CreateSingleMessageInput = {
  id: string;
  chatId: string;
  role: ChatMessageRole;
  parts: unknown[];
  attachments?: unknown[];
};

export type CreateMultipleMessagesInput = CreateSingleMessageInput[];

export type UpdateMessageInput = {
  id: string;
  userId: string;
  parts?: unknown[];
  attachments?: unknown[];
};

export type GetMessagesInput = {
  chatId: string;
  userId: string;
  limit?: number;
  afterId?: string;
};

export type OwnedMessagePage = {
  messages: ChatMessage[];
  hasMore: boolean;
};

function asList(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function toMessage(row: typeof chatMessage.$inferSelect): ChatMessage {
  const role: ChatMessageRole =
    row.role === "system" || row.role === "assistant" || row.role === "user"
      ? row.role
      : "assistant";
  return {
    id: row.id,
    chatId: row.chatId,
    role,
    parts: asList(row.parts),
    attachments: asList(row.attachments),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function ownerId(chatId: string, userId: string) {
  const db = requireDb();
  const rows = await db
    .select({ userId: chatTable.userId })
    .from(chatTable)
    .where(and(eq(chatTable.id, chatId), eq(chatTable.userId, userId)))
    .limit(1);
  return rows[0]?.userId ?? null;
}

type MessageInsert = {
  id: string;
  chatId: string;
  userId: string;
  role: ChatMessageRole;
  parts: unknown[];
  attachments: unknown[];
};

export type OwnedMessageStore = {
  ownedChatIds: (userId: string, chatIds: string[]) => Promise<string[]>;
  insert: (
    rows: MessageInsert[],
  ) => Promise<Array<typeof chatMessage.$inferSelect>>;
};

export function distinctMessageChatIds(
  input: Array<{ chatId: string }>,
): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const message of input) {
    const chatId = message.chatId.trim();
    if (chatId.length === 0) {
      throw new AppError("invalid_message", 400);
    }
    if (seen.has(chatId)) {
      continue;
    }
    seen.add(chatId);
    ids.push(chatId);
  }
  return ids;
}

export async function insertOwnedMessageBatch(
  store: OwnedMessageStore,
  input: Array<CreateSingleMessageInput & { userId?: string }>,
  userId: string,
): Promise<ChatMessage[]> {
  if (input.length === 0) {
    return [];
  }
  const chatIds = distinctMessageChatIds(input);
  const owned = new Set(await store.ownedChatIds(userId, chatIds));
  for (const chatId of chatIds) {
    if (!owned.has(chatId)) {
      throw new AppError("forbidden", 403);
    }
  }
  const rows = await store.insert(
    input.map((message) => ({
      attachments: message.attachments ?? [],
      chatId: message.chatId,
      id: message.id,
      parts: message.parts,
      role: message.role,
      userId,
    })),
  );
  return rows.map(toMessage);
}

export async function createMessage(
  input: CreateSingleMessageInput & { userId: string },
): Promise<ChatMessage> {
  const created = await createMultipleMessages([input], input.userId);
  const message = created[0];
  if (!message) {
    throw new AppError("persistence_failed", 500);
  }
  return message;
}

export async function createMultipleMessages(
  input: Array<CreateSingleMessageInput & { userId?: string }>,
  userId: string,
): Promise<ChatMessage[]> {
  if (input.length === 0) {
    return [];
  }
  const db = requireDb();
  return db.transaction((tx) =>
    insertOwnedMessageBatch(
      {
        ownedChatIds: async (owner, chatIds) => {
          const rows = await tx
            .select({ id: chatTable.id })
            .from(chatTable)
            .where(
              and(eq(chatTable.userId, owner), inArray(chatTable.id, chatIds)),
            );
          return rows.map((row) => row.id);
        },
        insert: (values) => tx.insert(chatMessage).values(values).returning(),
      },
      input,
      userId,
    ),
  );
}

export async function updateMessage(
  input: UpdateMessageInput,
): Promise<ChatMessage> {
  const db = requireDb();
  const rows = await db
    .update(chatMessage)
    .set({
      parts: input.parts,
      attachments: input.attachments,
      updatedAt: new Date(),
    })
    .where(
      and(eq(chatMessage.id, input.id), eq(chatMessage.userId, input.userId)),
    )
    .returning();
  const updated = rows[0];
  if (!updated) {
    throw new AppError("not_found", 404);
  }
  return toMessage(updated);
}

export async function listOwnedMessages(
  input: GetMessagesInput,
): Promise<OwnedMessagePage> {
  const owner = await ownerId(input.chatId, input.userId);
  if (!owner) {
    throw new AppError("forbidden", 403);
  }
  const db = requireDb();
  const limit = boundedLimit(input.limit, 100, 500);
  if (input.afterId) {
    const cursorRows = await db
      .select({ id: chatMessage.id })
      .from(chatMessage)
      .where(
        and(
          eq(chatMessage.id, input.afterId),
          eq(chatMessage.chatId, input.chatId),
          eq(chatMessage.userId, input.userId),
        ),
      )
      .limit(1);
    if (!cursorRows[0]) {
      throw new AppError("not_found", 404);
    }
  }
  const timeline = input.afterId
    ? sql`(${chatMessage.createdAt}, ${chatMessage.id}) > (
        select created_at, id from public.chat_message
        where id = ${input.afterId}
          and chat_id = ${input.chatId}
          and user_id = ${input.userId}
      )`
    : undefined;
  const ownedMessages = and(
    eq(chatMessage.chatId, input.chatId),
    eq(chatMessage.userId, input.userId),
  );
  const where = timeline ? and(ownedMessages, timeline) : ownedMessages;
  const rows = await db
    .select()
    .from(chatMessage)
    .where(where)
    .orderBy(asc(chatMessage.createdAt), asc(chatMessage.id))
    .limit(limit + 1);
  const hasMore = rows.length > limit;
  return {
    messages: rows.slice(0, limit).map(toMessage),
    hasMore,
  };
}

export async function getChatMessages(
  input: GetMessagesInput,
): Promise<ChatMessage[]> {
  const page = await listOwnedMessages(input);
  return page.messages;
}

export async function getMessageById(
  id: string,
  userId: string,
): Promise<ChatMessage | null> {
  const db = requireDb();
  const rows = await db
    .select()
    .from(chatMessage)
    .where(and(eq(chatMessage.id, id), eq(chatMessage.userId, userId)))
    .limit(1);
  const row = rows[0];
  return row ? toMessage(row) : null;
}

export async function deleteMessage(
  id: string,
  userId: string,
): Promise<boolean> {
  const db = requireDb();
  const rows = await db.transaction(async (tx) => {
    await lockByokResources(tx);
    await lockAttachments(tx);
    return tx
      .delete(chatMessage)
      .where(and(eq(chatMessage.id, id), eq(chatMessage.userId, userId)))
      .returning({ id: chatMessage.id });
  });
  return rows.length > 0;
}

export async function deleteTrailingMessages(
  chatId: string,
  userId: string,
  anchorId: string,
): Promise<number> {
  const owner = await ownerId(chatId, userId);
  if (!owner) {
    throw new AppError("forbidden", 403);
  }
  const db = requireDb();
  const rows = await db.transaction(async (tx) => {
    await lockByokResources(tx);
    await lockAttachments(tx);
    return tx
      .delete(chatMessage)
      .where(
        and(
          eq(chatMessage.chatId, chatId),
          eq(chatMessage.userId, userId),
          sql`(${chatMessage.createdAt}, ${chatMessage.id}) > (
          select created_at, id from public.chat_message
          where id = ${anchorId}
            and chat_id = ${chatId}
            and user_id = ${userId}
        )`,
        ),
      )
      .returning({ id: chatMessage.id });
  });
  return rows.length;
}

export async function deleteOwnedTrailingFromMessage(
  requestHeaders: Headers,
  messageId: string,
) {
  const access = await requireChatAccess(requestHeaders);
  const message = await getMessageById(messageId, access.userId);
  if (!message) {
    throw new AppError("not_found", 404);
  }
  await deleteTrailingMessages(message.chatId, access.userId, message.id);
}

export async function getLatestMessage(
  chatId: string,
  userId: string,
): Promise<ChatMessage | null> {
  const messages = await getChatMessages({ chatId, userId, limit: 500 });
  return messages.at(-1) ?? null;
}

export async function getChatMessagesWithMedia(userId: string): Promise<
  Array<{
    id: string;
    chatId: string;
    messageId: string;
    imageUrl: string;
    createdAt: Date;
    chatTitle?: string;
  }>
> {
  const db = requireDb();
  const rows = await db
    .select({
      id: chatMessage.id,
      chatId: chatMessage.chatId,
      parts: chatMessage.parts,
      createdAt: chatMessage.createdAt,
      chatTitle: chatTable.title,
    })
    .from(chatMessage)
    .innerJoin(chatTable, eq(chatMessage.chatId, chatTable.id))
    .where(eq(chatMessage.userId, userId))
    .orderBy(asc(chatMessage.createdAt), asc(chatMessage.id));
  const media: Array<{
    id: string;
    chatId: string;
    messageId: string;
    imageUrl: string;
    createdAt: Date;
    chatTitle?: string;
  }> = [];
  for (const row of rows) {
    for (const part of asList(row.parts)) {
      if (!part || typeof part !== "object") {
        continue;
      }
      const record = part as { type?: string; url?: string };
      if (record.type !== "file" || typeof record.url !== "string") {
        continue;
      }
      media.push({
        id: row.id,
        chatId: row.chatId,
        messageId: row.id,
        imageUrl: record.url,
        createdAt: row.createdAt,
        chatTitle: row.chatTitle,
      });
    }
  }
  return media;
}
