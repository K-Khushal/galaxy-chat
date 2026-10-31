import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { deleteAccount } from "@/lib/account/delete";
import { getSettings } from "@/lib/account/settings";
import type { AppContext } from "@/lib/api/context";
import { handle, json, readJson } from "@/lib/api/respond";
import { getByokKeyStatus } from "@/lib/byok/store";
import { getCredits } from "@/lib/credits";
import { chat, message, user, userSettings } from "@/lib/db/schema";

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
    const [profile] = await ctx.db.select().from(user).where(eq(user.id, id));
    const chats = await ctx.db.select().from(chat).where(eq(chat.userId, id));
    const messages = await ctx.db
      .select({ message })
      .from(message)
      .innerJoin(chat, eq(message.chatId, chat.id))
      .where(eq(chat.userId, id));
    return new Response(
      JSON.stringify({
        profile,
        chats,
        messages: messages.map((row) => row.message),
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
    await deleteAccount(ctx, id);
    return new Response(null, { status: 204 });
  });
}
