import { and, desc, eq, gt, lt } from "drizzle-orm";
import type { AppUsage } from "@/lib/ai/usage";
import { requireDb } from "@/lib/db/client";
import { chatMessage, chat as chatTable } from "@/lib/db/schema";
import { AppError } from "@/lib/errors";
import type { Chat as ChatRecord, ChatVisibility } from "@/lib/types";

export type Chat = ChatRecord;

export type CreateChatInput = {
  id: string;
  userId: string;
  title: string;
  visibility: ChatVisibility;
};

export type UpdateChatInput = {
  id: string;
  userId: string;
  title?: string;
  visibility?: ChatVisibility;
  lastContext?: unknown;
};

export type GetChatsInput = {
  userId: string;
  limit?: number;
  startingAfter?: string;
  endingBefore?: string;
};

export type GetChatsResult = {
  chats: Chat[];
  hasMore: boolean;
};

function toChat(row: typeof chatTable.$inferSelect): Chat {
  return {
    id: row.id,
    title: row.title,
    userId: row.userId,
    visibility: row.visibility === "public" ? "public" : "private",
    lastContext: (row.lastContext as AppUsage | null) ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function createChat(input: CreateChatInput): Promise<Chat> {
  if (!input.id.trim() || !input.userId.trim() || !input.title.trim()) {
    throw new AppError("invalid_chat", 400);
  }
  const db = requireDb();
  const rows = await db
    .insert(chatTable)
    .values({
      id: input.id.trim(),
      userId: input.userId.trim(),
      title: input.title.trim(),
      visibility: input.visibility,
    })
    .returning();
  const created = rows[0];
  if (!created) {
    throw new AppError("persistence_failed", 500);
  }
  return toChat(created);
}

export async function updateChat(input: UpdateChatInput): Promise<Chat> {
  const db = requireDb();
  const existing = await getChatForUser(input.id, input.userId);
  if (!existing) {
    throw new AppError("not_found", 404);
  }
  const rows = await db
    .update(chatTable)
    .set({
      title: input.title ?? existing.title,
      visibility: input.visibility ?? existing.visibility,
      lastContext: input.lastContext ?? existing.lastContext,
      updatedAt: new Date(),
    })
    .where(and(eq(chatTable.id, input.id), eq(chatTable.userId, input.userId)))
    .returning();
  const updated = rows[0];
  if (!updated) {
    throw new AppError("not_found", 404);
  }
  return toChat(updated);
}

export async function getChatForUser(
  id: string,
  userId: string,
): Promise<Chat | null> {
  const db = requireDb();
  const rows = await db
    .select()
    .from(chatTable)
    .where(and(eq(chatTable.id, id), eq(chatTable.userId, userId)))
    .limit(1);
  const row = rows[0];
  return row ? toChat(row) : null;
}

export async function getUserChats(
  input: GetChatsInput,
): Promise<GetChatsResult> {
  if (!input.userId.trim()) {
    throw new AppError("invalid_chat", 400);
  }
  const db = requireDb();
  const limit = Math.min(input.limit || 50, 100);
  const userId = input.userId.trim();
  let cursorDate: Date | null = null;
  let direction: "before" | "after" = "before";
  if (input.startingAfter) {
    const cursor = await getChatForUser(input.startingAfter, userId);
    if (!cursor) {
      throw new AppError("not_found", 404);
    }
    cursorDate = cursor.createdAt;
    direction = "before";
  }
  if (input.endingBefore) {
    const cursor = await getChatForUser(input.endingBefore, userId);
    if (!cursor) {
      throw new AppError("not_found", 404);
    }
    cursorDate = cursor.createdAt;
    direction = "after";
  }
  let where = eq(chatTable.userId, userId);
  if (cursorDate && direction === "before") {
    const next = and(
      eq(chatTable.userId, userId),
      lt(chatTable.createdAt, cursorDate),
    );
    if (next) {
      where = next;
    }
  }
  if (cursorDate && direction === "after") {
    const next = and(
      eq(chatTable.userId, userId),
      gt(chatTable.createdAt, cursorDate),
    );
    if (next) {
      where = next;
    }
  }
  const rows = await db
    .select()
    .from(chatTable)
    .where(where)
    .orderBy(desc(chatTable.createdAt))
    .limit(limit + 1);
  const hasMore = rows.length > limit;
  return {
    chats: rows.slice(0, limit).map(toChat),
    hasMore,
  };
}

export async function getAllUserChats(userId: string): Promise<Chat[]> {
  const db = requireDb();
  const rows = await db
    .select()
    .from(chatTable)
    .where(eq(chatTable.userId, userId))
    .orderBy(desc(chatTable.createdAt));
  return rows.map(toChat);
}

export const getChatsByUserId = getAllUserChats;

export async function deleteChat(id: string, userId: string): Promise<boolean> {
  const db = requireDb();
  return db.transaction(async (tx) => {
    const owned = await tx
      .select({ id: chatTable.id })
      .from(chatTable)
      .where(and(eq(chatTable.id, id), eq(chatTable.userId, userId)))
      .limit(1);
    if (!owned[0]) {
      return false;
    }
    await tx
      .delete(chatMessage)
      .where(and(eq(chatMessage.chatId, id), eq(chatMessage.userId, userId)));
    await tx
      .delete(chatTable)
      .where(and(eq(chatTable.id, id), eq(chatTable.userId, userId)));
    return true;
  });
}

export async function updateChatLastContext({
  chatId,
  userId,
  context,
}: {
  chatId: string;
  userId: string;
  context: AppUsage;
}): Promise<Chat | null> {
  return updateChat({ id: chatId, userId, lastContext: context });
}
