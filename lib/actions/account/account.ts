import { asc, desc, eq } from "drizzle-orm";
import { requireDb } from "@/lib/db/client";
import {
  account,
  chatMessage,
  chat as chatTable,
  usageRecord,
  user,
} from "@/lib/db/schema";
import { AppError } from "@/lib/errors";

export type AccountProfile = {
  id: string;
  name: string;
  email: string;
  githubLogin: string | null;
  createdAt: Date;
};

export type AccountExport = {
  profile: AccountProfile;
  chats: Array<{
    id: string;
    title: string;
    visibility: string;
    createdAt: Date;
    updatedAt: Date;
  }>;
  messages: Array<{
    id: string;
    chatId: string;
    role: string;
    parts: unknown;
    attachments: unknown;
    createdAt: Date;
    updatedAt: Date;
  }>;
  usageRecords: Array<{
    id: string;
    chatId: string | null;
    createdAt: Date;
  }>;
};

async function ownedProfile(userId: string): Promise<AccountProfile> {
  const db = requireDb();
  const rows = await db
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
      githubLogin: user.githubLogin,
      createdAt: user.createdAt,
    })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);
  const profile = rows[0];
  if (!profile) {
    throw new AppError("not_found", 404);
  }
  return profile;
}

export async function readOwnedProfile(userId: string) {
  return ownedProfile(userId);
}

export async function exportOwnedAccount(
  userId: string,
): Promise<AccountExport> {
  const db = requireDb();
  const profile = await ownedProfile(userId);
  const chats = await db
    .select({
      id: chatTable.id,
      title: chatTable.title,
      visibility: chatTable.visibility,
      createdAt: chatTable.createdAt,
      updatedAt: chatTable.updatedAt,
    })
    .from(chatTable)
    .where(eq(chatTable.userId, userId))
    .orderBy(desc(chatTable.createdAt), desc(chatTable.id));
  const messages = await db
    .select({
      id: chatMessage.id,
      chatId: chatMessage.chatId,
      role: chatMessage.role,
      parts: chatMessage.parts,
      attachments: chatMessage.attachments,
      createdAt: chatMessage.createdAt,
      updatedAt: chatMessage.updatedAt,
    })
    .from(chatMessage)
    .where(eq(chatMessage.userId, userId))
    .orderBy(asc(chatMessage.createdAt), asc(chatMessage.id));
  const usageRecords = await db
    .select({
      id: usageRecord.id,
      chatId: usageRecord.chatId,
      createdAt: usageRecord.createdAt,
    })
    .from(usageRecord)
    .where(eq(usageRecord.userId, userId))
    .orderBy(asc(usageRecord.createdAt), asc(usageRecord.id));
  return { profile, chats, messages, usageRecords };
}

export async function deleteOwnedAccount(userId: string) {
  const db = requireDb();
  return db.transaction(async (tx) => {
    const owned = await tx
      .select({ id: user.id })
      .from(user)
      .where(eq(user.id, userId))
      .limit(1);
    if (!owned[0]) {
      throw new AppError("not_found", 404);
    }
    await tx.delete(account).where(eq(account.userId, userId));
    await tx.delete(user).where(eq(user.id, userId));
    return { deleted: true };
  });
}
