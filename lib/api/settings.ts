import "server-only";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { deleteAccount } from "@/lib/account/delete";
import { getSettings } from "@/lib/account/settings";
import type { AppContext } from "@/lib/api/context";
import { handle, json, readJson } from "@/lib/api/respond";
import { attachmentIdFromUrl } from "@/lib/attachments/rules";
import { getByokKeyStatus } from "@/lib/byok/store";
import { getCredits } from "@/lib/credits";
import { attachment, chat, message, user, userSettings } from "@/lib/db/schema";
import { AppError } from "@/lib/errors";

export function getSettingsRoute(ctx: AppContext, request: Request) {
  return handle(async () => {
    const id = await ctx.authenticate(request);
    const replies = await ctx.db
      .select({
        id: message.id,
        model: message.model,
        usage: message.usage,
        createdAt: message.createdAt,
      })
      .from(message)
      .innerJoin(chat, eq(message.chatId, chat.id))
      .where(and(eq(chat.userId, id), eq(message.role, "assistant")))
      .orderBy(desc(message.createdAt))
      .limit(50);
    return json({
      settings: await getSettings(ctx.db, id),
      credits: await getCredits(ctx.db, id),
      key: await getByokKeyStatus(ctx.db, id),
      replies,
    });
  });
}
export function saveSettingsRoute(ctx: AppContext, request: Request) {
  return handle(async () => {
    const userId = await ctx.authenticate(request);
    const settings = await readJson(
      request,
      z.strictObject({
        aboutYou: z.string().max(2000),
        responseInstructions: z.string().max(2000),
      }),
    );
    await ctx.db
      .insert(userSettings)
      .values({ userId, ...settings })
      .onConflictDoUpdate({ target: userSettings.userId, set: settings });
    return json({ settings });
  });
}
export function exportAccountRoute(ctx: AppContext, request: Request) {
  return handle(async () => {
    const id = await ctx.authenticate(request);
    // Check stored content size before loading the export into application memory.
    const [size] = await ctx.db
      .select({
        bytes: sql<number>`coalesce(sum(octet_length(row_to_json(${message})::text)), 0)`,
      })
      .from(message)
      .innerJoin(chat, eq(message.chatId, chat.id))
      .where(eq(chat.userId, id));
    const [chatSize] = await ctx.db
      .select({
        bytes: sql<number>`coalesce(sum(octet_length(row_to_json(${chat})::text)), 0)`,
      })
      .from(chat)
      .where(eq(chat.userId, id));
    if (Number(size.bytes) + Number(chatSize.bytes) > 10 * 1024 * 1024)
      throw new AppError("export_too_large", 413);
    const [profile] = await ctx.db
      .select({
        id: user.id,
        name: user.name,
        email: user.email,
        image: user.image,
        createdAt: user.createdAt,
      })
      .from(user)
      .where(eq(user.id, id));
    const chats = await ctx.db.select().from(chat).where(eq(chat.userId, id));
    const messages = await ctx.db
      .select({ message })
      .from(message)
      .innerJoin(chat, eq(message.chatId, chat.id))
      .where(eq(chat.userId, id));
    const files = await ctx.db
      .select({
        id: attachment.id,
        filename: attachment.filename,
        contentType: attachment.contentType,
        size: attachment.size,
        createdAt: attachment.createdAt,
        chatId: attachment.chatId,
      })
      .from(attachment)
      .where(and(eq(attachment.userId, id), eq(attachment.status, "ready")));
    // Metadata only: no file bytes, object keys, URLs or extracted text. The
    // Message an Attachment belongs to is the one whose file part points at it.
    const messageOf = new Map<string, string>();
    for (const { message: row } of messages) {
      for (const part of row.parts as { type: string; url?: string }[]) {
        const fileId =
          part.type === "file" && part.url
            ? attachmentIdFromUrl(part.url)
            : null;
        if (fileId) messageOf.set(fileId, row.id);
      }
    }
    return new Response(
      JSON.stringify({
        profile,
        chats,
        messages: messages.map((row) => row.message),
        attachments: files.map((file) => ({
          ...file,
          messageId: messageOf.get(file.id) ?? null,
        })),
        settings: await getSettings(ctx.db, id),
        credits: await getCredits(ctx.db, id),
        key: await getByokKeyStatus(ctx.db, id),
      }),
      {
        headers: {
          "Content-Type": "application/json",
          "Content-Disposition": 'attachment; filename="galaxy-account.json"',
          "Cache-Control": "no-store",
        },
      },
    );
  });
}
export function deleteAccountRoute(ctx: AppContext, request: Request) {
  return handle(async () => {
    const id = await ctx.authenticate(request);
    await readJson(
      request,
      z.strictObject({ confirmation: z.literal("DELETE") }),
    );
    const createdAt = (await ctx.sessionCreatedAt(request)).getTime();
    if (
      !Number.isFinite(createdAt) ||
      createdAt > Date.now() ||
      Date.now() - createdAt > 24 * 60 * 60_000
    ) {
      throw new AppError("reauth_required", 403);
    }
    await deleteAccount(ctx, id);
    return new Response(null, { status: 204 });
  });
}

export function getCreditsRoute(ctx: AppContext, request: Request) {
  return handle(async () => {
    const id = await ctx.authenticate(request);
    return json({
      credits: await getCredits(ctx.db, id),
      key: await getByokKeyStatus(ctx.db, id),
    });
  });
}
