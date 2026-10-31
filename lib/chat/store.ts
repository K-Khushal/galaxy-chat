import "server-only";
import type { UIMessage } from "ai";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
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
import { refundReplyCredit } from "@/lib/generation/payment";

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
    .orderBy(desc(chat.pinned), desc(chat.updatedAt));
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

/** Whether a Reply has any text or reasoning. */
export function hasContent(parts: MessageParts) {
  return parts.some(
    (part) =>
      (part.type === "text" || part.type === "reasoning") &&
      part.text.length > 0,
  );
}

/** Marks every text and reasoning part as done, so stored parts never stream. */
export function settleParts(parts: MessageParts): MessageParts {
  return parts.map((part) =>
    "state" in part && part.state === "streaming"
      ? ({ ...part, state: "done" } as typeof part)
      : part,
  );
}

/**
 * The Generation writing a Reply. Every write below is fenced on it: once a
 * newer Generation takes the Reply over, the old one's writes change nothing.
 */
export type ReplyOwner = { replyId: string; generationId: string };

const owned = (owner: ReplyOwner) =>
  and(
    eq(message.id, owner.replyId),
    eq(message.generationId, owner.generationId),
  );

/**
 * Saves a running Reply's partial parts. Never touches its status. False when
 * this Generation no longer owns the Reply.
 */
export async function checkpointReply(
  db: Db,
  owner: ReplyOwner,
  parts: MessageParts,
): Promise<boolean> {
  const rows = await db
    .update(message)
    .set({
      parts: settleParts(parts),
      updatedAt: new Date(),
      // A checkpoint with content also counts as the first token, so a failed
      // markFirstToken write can never lead to refunding a Reply with text.
      ...(parts.length > 0
        ? { firstTokenAt: sql`coalesce(${message.firstTokenAt}, now())` }
        : {}),
    })
    .where(owned(owner))
    .returning({ id: message.id });
  return rows.length > 0;
}

/** Records the first token; from then on the credit is never refunded. */
export async function markFirstToken(
  db: Db,
  owner: ReplyOwner,
): Promise<boolean> {
  const rows = await db
    .update(message)
    .set({ firstTokenAt: sql`coalesce(${message.firstTokenAt}, now())` })
    .where(owned(owner))
    .returning({ id: message.id });
  return rows.length > 0;
}

export type ReplyResult = {
  parts: MessageParts;
  status: MessageStatus;
  usage: MessageUsage | null;
  error: string | null;
  /** Whether this Generation produced a token. */
  firstToken: boolean;
};

/**
 * Saves a Reply's final state. With `refundTo`, also gives back its credit in
 * the same transaction, if one is still owed (see refundReplyCredit). False
 * when this Generation no longer owns the Reply; nothing is written then.
 */
export async function finishReply(
  db: Db,
  owner: ReplyOwner,
  result: ReplyResult,
  refundTo: string | null = null,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const rows = await tx
      .update(message)
      .set({
        parts: settleParts(result.parts),
        status: result.status,
        usage: result.usage,
        error: result.error,
        updatedAt: new Date(),
        ...(result.firstToken
          ? { firstTokenAt: sql`coalesce(${message.firstTokenAt}, now())` }
          : {}),
      })
      .where(owned(owner))
      .returning({ id: message.id });
    if (rows.length === 0) return false;
    if (refundTo !== null) await refundReplyCredit(tx, owner, refundTo);
    return true;
  });
}
