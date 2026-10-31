import "server-only";
import { z } from "zod";
import type { AppContext } from "@/lib/api/context";
import { handle, json, readJson, sseResponse } from "@/lib/api/respond";
import {
  activePath,
  type ChatRow,
  chatSummary,
  createChat,
  deleteChat,
  getOwnedChat,
  listChats,
  listMessages,
  switchVersion,
  updateChat,
} from "@/lib/chat/store";
import { AppError } from "@/lib/errors";
import { getActiveGeneration } from "@/lib/generation/locks";
import { recoverRepliesQuietly } from "@/lib/generation/recover";
import { resumeGeneration, stopGeneration } from "@/lib/generation/resume";
import { startGeneration } from "@/lib/generation/start";
import { DEFAULT_MODEL_ID, resolveModel } from "@/lib/models";

const id = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const modelId = z
  .string()
  .max(100)
  .refine((value) => resolveModel(value) !== null);

async function ownedChat(ctx: AppContext, userId: string, chatId: string) {
  const row = id.safeParse(chatId).success
    ? await getOwnedChat(ctx.db, userId, chatId)
    : null;
  if (!row) throw new AppError("chat_not_found", 404);
  return row;
}

async function chatView(ctx: AppContext, row: ChatRow) {
  // Settles credits of Generations that died before their first token, so
  // the view shows those Replies as they ended.
  await recoverRepliesQuietly(ctx, row.userId);
  const [messages, active] = await Promise.all([
    listMessages(ctx.db, row.id),
    getActiveGeneration(ctx.kv, row.id),
  ]);
  return {
    chat: chatSummary(row),
    messages: activePath(messages, row.activeLeafMessageId),
    // The Reply a running Generation is writing; resume it via GET .../stream.
    generation: active ? { messageId: active.messageId } : null,
  };
}

/** GET /api/chats[?archived=true] */
export function listChatsRoute(ctx: AppContext, request: Request) {
  return handle(async () => {
    const userId = await ctx.authenticate(request);
    const archived =
      new URL(request.url).searchParams.get("archived") === "true";
    const rows = await listChats(ctx.db, userId, archived);
    return json({ chats: rows.map(chatSummary) });
  });
}

/** POST /api/chats { model? } */
export function createChatRoute(ctx: AppContext, request: Request) {
  return handle(async () => {
    const userId = await ctx.authenticate(request);
    const body = await readJson(
      request,
      z.object({ model: modelId.optional() }),
    );
    const row = await createChat(
      ctx.db,
      userId,
      body.model ?? DEFAULT_MODEL_ID,
    );
    return json({ chat: chatSummary(row) }, 201);
  });
}

/** GET /api/chats/[id]: the Chat, its active path and any running Generation. */
export function getChatRoute(
  ctx: AppContext,
  request: Request,
  chatId: string,
) {
  return handle(async () => {
    const userId = await ctx.authenticate(request);
    return json(await chatView(ctx, await ownedChat(ctx, userId, chatId)));
  });
}

const patchSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    pinned: z.boolean().optional(),
    archived: z.boolean().optional(),
    model: modelId.optional(),
  })
  .strict();

/** PATCH /api/chats/[id] { title?, pinned?, archived?, model? } */
export function updateChatRoute(
  ctx: AppContext,
  request: Request,
  chatId: string,
) {
  return handle(async () => {
    const userId = await ctx.authenticate(request);
    await ownedChat(ctx, userId, chatId);
    const patch = await readJson(request, patchSchema);
    const row = await updateChat(ctx.db, userId, chatId, patch);
    if (!row) throw new AppError("chat_not_found", 404);
    return json({ chat: chatSummary(row) });
  });
}

/** DELETE /api/chats/[id]: stops any running Generation first. */
export function deleteChatRoute(
  ctx: AppContext,
  request: Request,
  chatId: string,
) {
  return handle(async () => {
    const userId = await ctx.authenticate(request);
    await ownedChat(ctx, userId, chatId);
    await stopGeneration(ctx, chatId);
    await deleteChat(ctx.db, userId, chatId);
    return new Response(null, { status: 204 });
  });
}

const textParts = z
  .array(
    z.object({ type: z.literal("text"), text: z.string().min(1).max(100_000) }),
  )
  .min(1)
  .max(20)
  .refine(
    (parts) =>
      parts.reduce((total, part) => total + part.text.length, 0) <= 100_000,
  );

const startSchema = z.discriminatedUnion("trigger", [
  z.object({
    trigger: z.literal("submit-message"),
    parentId: id.nullable(),
    messageId: id.optional(),
    parts: textParts,
    model: modelId.optional(),
  }),
  z.object({
    trigger: z.literal("regenerate-message"),
    messageId: id,
    model: modelId.optional(),
  }),
  z.object({ trigger: z.literal("continue-message"), messageId: id }),
]);

/**
 * POST /api/chats/[id]/messages: send (or edit, as a submit under the edited
 * Message's parent), regenerate or continue. Streams the Reply as SSE.
 */
export function sendMessageRoute(
  ctx: AppContext,
  request: Request,
  chatId: string,
) {
  return handle(async () => {
    const userId = await ctx.authenticate(request);
    const row = await ownedChat(ctx, userId, chatId);
    const body = await readJson(request, startSchema);
    if (!(await ctx.rateLimit("send", userId))) {
      throw new AppError("rate_limited", 429);
    }
    const { stream } = await startGeneration(ctx, userId, row, body);
    return sseResponse(stream);
  });
}

/** GET /api/chats/[id]/stream: rejoin the running Generation, or 204. */
export function resumeStreamRoute(
  ctx: AppContext,
  request: Request,
  chatId: string,
) {
  return handle(async () => {
    const userId = await ctx.authenticate(request);
    await ownedChat(ctx, userId, chatId);
    const stream = await resumeGeneration(ctx, chatId);
    return stream ? sseResponse(stream) : new Response(null, { status: 204 });
  });
}

/** POST /api/chats/[id]/stop: the Reply ends as Stopped with its text so far. */
export function stopRoute(ctx: AppContext, request: Request, chatId: string) {
  return handle(async () => {
    const userId = await ctx.authenticate(request);
    await ownedChat(ctx, userId, chatId);
    const active = await stopGeneration(ctx, chatId);
    return json(
      { stopping: active ? { messageId: active.messageId } : null },
      active ? 202 : 200,
    );
  });
}

/** POST /api/chats/[id]/version { messageId }: show another Version. */
export function switchVersionRoute(
  ctx: AppContext,
  request: Request,
  chatId: string,
) {
  return handle(async () => {
    const userId = await ctx.authenticate(request);
    await ownedChat(ctx, userId, chatId);
    const body = await readJson(request, z.object({ messageId: id }));
    const leaf = await switchVersion(ctx.db, chatId, body.messageId);
    if (!leaf) throw new AppError("message_not_found", 404);
    return json(await chatView(ctx, await ownedChat(ctx, userId, chatId)));
  });
}
