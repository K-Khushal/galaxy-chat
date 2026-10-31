import "server-only";
import type { UIMessage } from "ai";
import { and, asc, desc, eq, isNull } from "drizzle-orm";
import {
  latestLeaf,
  pathTo,
  type VersionInfo,
  versionsOf,
} from "@/lib/chat/tree";
import {
  chat,
  type MessageRole,
  type MessageStatus,
  type MessageUsage,
  message,
  type PaymentSource,
} from "@/lib/db/schema";
import type { Db } from "@/lib/db/types";

export type ChatRow = typeof chat.$inferSelect;
export type MessageRow = typeof message.$inferSelect;
export type MessageParts = UIMessage["parts"];

/** A Message as the API returns it, with its Versions. */
export type ChatMessage = {
  id: string;
  parentId: string | null;
  role: MessageRole;
  parts: MessageParts;
  status: MessageStatus;
  model: string | null;
  payment: PaymentSource | null;
  usage: MessageUsage | null;
  error: string | null;
  createdAt: string;
  versions: VersionInfo;
};

export type ChatSummary = {
  id: string;
  title: string | null;
  pinned: boolean;
  archived: boolean;
  model: string;
  activeLeafMessageId: string | null;
  createdAt: string;
  updatedAt: string;
};

export function chatSummary(row: ChatRow): ChatSummary {
  return {
    id: row.id,
    title: row.title,
    pinned: row.pinned,
    archived: row.archived,
    model: row.model,
    activeLeafMessageId: row.activeLeafMessageId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function createChat(
  db: Db,
  userId: string,
  model: string,
): Promise<ChatRow> {
  const [row] = await db
    .insert(chat)
    .values({ id: crypto.randomUUID(), userId, model })
    .returning();
  if (!row) throw new Error("chat insert returned no row");
  return row;
}

export function listChats(db: Db, userId: string, archived: boolean) {
  return db
    .select()
    .from(chat)
    .where(and(eq(chat.userId, userId), eq(chat.archived, archived)))
    .orderBy(desc(chat.pinned), desc(chat.updatedAt))
    .limit(500);
}

/** The Chat when `userId` owns it; null otherwise, so callers answer 404. */
export async function getOwnedChat(
  db: Db,
  userId: string,
  chatId: string,
): Promise<ChatRow | null> {
  const rows = await db
    .select()
    .from(chat)
    .where(and(eq(chat.id, chatId), eq(chat.userId, userId)));
  return rows[0] ?? null;
}

export type ChatPatch = Partial<
  Pick<ChatRow, "title" | "pinned" | "archived" | "model">
>;

export async function updateChat(
  db: Db,
  userId: string,
  chatId: string,
  patch: ChatPatch,
): Promise<ChatRow | null> {
  const rows = await db
    .update(chat)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(chat.id, chatId), eq(chat.userId, userId)))
    .returning();
  return rows[0] ?? null;
}

export async function deleteChat(db: Db, userId: string, chatId: string) {
  const rows = await db
    .delete(chat)
    .where(and(eq(chat.id, chatId), eq(chat.userId, userId)))
    .returning({ id: chat.id });
  return rows.length > 0;
}

export function listMessages(db: Db, chatId: string): Promise<MessageRow[]> {
  return db
    .select()
    .from(message)
    .where(eq(message.chatId, chatId))
    .orderBy(asc(message.createdAt), asc(message.id));
}

/** The Messages on the active path, each with its Versions. */
export function activePath(
  messages: readonly MessageRow[],
  activeLeafId: string | null,
): ChatMessage[] {
  return pathTo(messages, activeLeafId).map((row) => ({
    id: row.id,
    parentId: row.parentId,
    role: row.role,
    parts: row.parts as MessageParts,
    status: row.status,
    model: row.model,
    payment: row.payment,
    usage: row.usage,
    error: row.error,
    createdAt: row.createdAt.toISOString(),
    versions: versionsOf(messages, row),
  }));
}

/**
 * Shows the Version `messageId` (and the newest Messages below it). Returns
 * the new active leaf, or null when the Message is not in this Chat.
 */
export async function switchVersion(
  db: Db,
  chatId: string,
  messageId: string,
): Promise<string | null> {
  const messages = await listMessages(db, chatId);
  if (!messages.some((row) => row.id === messageId)) return null;
  const leaf = latestLeaf(messages, messageId);
  await db
    .update(chat)
    .set({ activeLeafMessageId: leaf })
    .where(eq(chat.id, chatId));
  return leaf;
}

/** Saves a title only if the Chat still has none. */
export async function setTitleIfMissing(db: Db, chatId: string, title: string) {
  await db
    .update(chat)
    .set({ title })
    .where(and(eq(chat.id, chatId), isNull(chat.title)));
}

/** Marks every text and reasoning part as done, so stored parts never stream. */
export function settleParts(parts: MessageParts): MessageParts {
  return parts.map((part) =>
    "state" in part && part.state === "streaming"
      ? ({ ...part, state: "done" } as typeof part)
      : part,
  );
}

/** Saves a running Reply's partial parts. Never touches its status. */
export async function checkpointReply(
  db: Db,
  replyId: string,
  parts: MessageParts,
) {
  await db
    .update(message)
    .set({ parts: settleParts(parts), updatedAt: new Date() })
    .where(eq(message.id, replyId));
}

export async function finishReply(
  db: Db,
  replyId: string,
  result: {
    parts: MessageParts;
    status: MessageStatus;
    usage: MessageUsage | null;
    error: string | null;
  },
) {
  await db
    .update(message)
    .set({
      parts: settleParts(result.parts),
      status: result.status,
      usage: result.usage,
      error: result.error,
      updatedAt: new Date(),
    })
    .where(eq(message.id, replyId));
}
