import { and, asc, desc, eq, ilike, type SQL, sql } from "drizzle-orm";
import type { AppUsage } from "@/lib/ai/usage";
import { cleanupAfterDeletion } from "@/lib/attachments/service";
import { lockAttachments } from "@/lib/attachments/store";
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
  query?: string;
};

export type GetChatsResult = {
  chats: Chat[];
  hasMore: boolean;
};

export function boundedLimit(
  value: number | undefined,
  fallback: number,
  max: number,
) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 1) {
    return fallback;
  }
  return Math.min(Math.floor(value), max);
}

function likePattern(query: string) {
  const escaped = query.replace(/[\\%_]/g, (character) => `\\${character}`);
  return `%${escaped}%`;
}

function definedSql(clauses: Array<SQL | undefined>) {
  const present = clauses.filter((clause) => clause !== undefined);
  const combined = and(...present);
  if (!combined) {
    throw new AppError("persistence_failed", 500);
  }
  return combined;
}

function toChat(row: typeof chatTable.$inferSelect): Chat {
  return {
    id: row.id,
    title: row.title,
    projectId: row.projectId,
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

async function requireOwnedChatId(id: string, userId: string) {
  const db = requireDb();
  const rows = await db
    .select({ id: chatTable.id })
    .from(chatTable)
    .where(and(eq(chatTable.id, id), eq(chatTable.userId, userId)))
    .limit(1);
  if (!rows[0]) {
    throw new AppError("not_found", 404);
  }
}

function chatOlderThanCursor(cursorId: string, userId: string) {
  return sql`(${chatTable.createdAt}, ${chatTable.id}) < (
    select created_at, id from public.chat
    where id = ${cursorId} and user_id = ${userId}
  )`;
}

function chatNewerThanCursor(cursorId: string, userId: string) {
  return sql`(${chatTable.createdAt}, ${chatTable.id}) > (
    select created_at, id from public.chat
    where id = ${cursorId} and user_id = ${userId}
  )`;
}

export async function getUserChats(
  input: GetChatsInput,
): Promise<GetChatsResult> {
  if (!input.userId.trim()) {
    throw new AppError("invalid_chat", 400);
  }
  if (input.startingAfter && input.endingBefore) {
    throw new AppError("invalid_cursor", 400);
  }
  const db = requireDb();
  const limit = boundedLimit(input.limit, 50, 100);
  const userId = input.userId.trim();
  const query = input.query?.trim() ?? "";
  let cursorId: string | null = null;
  let direction: "older" | "newer" | null = null;
  if (input.endingBefore) {
    cursorId = input.endingBefore;
    direction = "older";
  }
  if (input.startingAfter) {
    cursorId = input.startingAfter;
    direction = "newer";
  }
  if (cursorId) {
    await requireOwnedChatId(cursorId, userId);
  }
  const search =
    query.length > 0 ? ilike(chatTable.title, likePattern(query)) : undefined;
  let timeline: SQL | undefined;
  if (cursorId && direction === "older") {
    timeline = chatOlderThanCursor(cursorId, userId);
  }
  if (cursorId && direction === "newer") {
    timeline = chatNewerThanCursor(cursorId, userId);
  }
  const newer = direction === "newer";
  const rows = await db
    .select()
    .from(chatTable)
    .where(definedSql([eq(chatTable.userId, userId), search, timeline]))
    .orderBy(
      newer ? asc(chatTable.createdAt) : desc(chatTable.createdAt),
      newer ? asc(chatTable.id) : desc(chatTable.id),
    )
    .limit(limit + 1);
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  if (newer) {
    page.reverse();
  }
  return {
    chats: page.map(toChat),
    hasMore,
  };
}

export async function getAllUserChats(userId: string): Promise<Chat[]> {
  const db = requireDb();
  const rows = await db
    .select()
    .from(chatTable)
    .where(eq(chatTable.userId, userId))
    .orderBy(desc(chatTable.createdAt), desc(chatTable.id));
  return rows.map(toChat);
}

export const getChatsByUserId = getAllUserChats;

export async function deleteChat(id: string, userId: string): Promise<boolean> {
  const db = requireDb();
  let hasAttachments = false;
  const deleted = await db.transaction(async (tx) => {
    await lockAttachments(tx);
    const owned = await tx
      .select({ id: chatTable.id })
      .from(chatTable)
      .where(and(eq(chatTable.id, id), eq(chatTable.userId, userId)))
      .limit(1);
    if (!owned[0]) {
      return false;
    }
    hasAttachments = Boolean(
      (
        await tx.execute(
          sql`SELECT id FROM attachment WHERE chat_id=${id} AND user_id=${userId} LIMIT 1`,
        )
      )[0],
    );
    await tx
      .delete(chatMessage)
      .where(and(eq(chatMessage.chatId, id), eq(chatMessage.userId, userId)));
    await tx
      .delete(chatTable)
      .where(and(eq(chatTable.id, id), eq(chatTable.userId, userId)));
    return true;
  });
  if (deleted && hasAttachments) await cleanupAfterDeletion();
  return deleted;
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
