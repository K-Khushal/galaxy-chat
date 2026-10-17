import { createUIMessageStream, createUIMessageStreamResponse } from "ai";
import { and, desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import {
  createChat,
  deleteChat,
  getChatForUser,
  updateChat,
} from "@/lib/actions/chat/chat";
import {
  createMessage,
  createMultipleMessages,
} from "@/lib/actions/chat/chat-message";
import { generateChatTitle } from "@/lib/ai/title";
import { requireChatAccess } from "@/lib/auth/access";
import { LIMITS } from "@/lib/credits/config";
import { boundedJson } from "@/lib/credits/http";
import { startFundedStream, type TextTurn } from "@/lib/credits/service";
import { actorFor } from "@/lib/credits/store";
import { requireDb } from "@/lib/db/client";
import { chatMessage } from "@/lib/db/schema";
import { AppError, logErrorId } from "@/lib/errors";
import { errorResponse } from "@/lib/http/error-response";
import { postRequestBodySchema } from "@/lib/schema/chat/chat";
export const maxDuration = 30;

export async function POST(request: Request) {
  try {
    const access = await requireChatAccess(request.headers);
    const parsed = postRequestBodySchema.safeParse(await boundedJson(request));
    if (!parsed.success) throw new AppError("invalid_request", 400);
    const { id, message, model, webSearch, visibility } = parsed.data;
    if (webSearch || message.parts.some((part) => part.type !== "text"))
      throw new AppError("funded_capability_denied", 403);
    const actor = actorFor(
      "user",
      access.userId,
      process.env.CREDIT_ACTOR_SECRET ?? "",
    );
    const chat = await getChatForUser(id, access.userId);
    const rows = chat
      ? await requireDb()
          .select()
          .from(chatMessage)
          .where(
            and(
              eq(chatMessage.chatId, id),
              eq(chatMessage.userId, access.userId),
            ),
          )
          .orderBy(desc(chatMessage.createdAt), desc(chatMessage.id))
          .limit(LIMITS.messages)
      : [];
    const turns: TextTurn[] = rows.reverse().flatMap((row) => {
      if (row.role !== "user" && row.role !== "assistant") return [];
      const parts: unknown = row.parts;
      if (!Array.isArray(parts)) return [];
      const content = parts
        .filter(
          (part): part is { type: "text"; text: string } =>
            part &&
            typeof part === "object" &&
            part.type === "text" &&
            typeof part.text === "string",
        )
        .map((part) => part.text)
        .join("\n");
      return content ? [{ role: row.role, content }] : [];
    });
    turns.push({
      role: "user",
      content: message.parts
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("\n"),
    });
    const result = await startFundedStream({
      env: process.env,
      actor,
      model,
      idempotencyKey: `${id}:${message.id}`,
      turns,
      beforeProvider: async () => {
        if (!chat)
          await createChat({
            id,
            userId: access.userId,
            title: await generateChatTitle(request.headers, message),
            visibility,
          });
        await createMessage({
          chatId: id,
          id: message.id,
          userId: access.userId,
          role: "user",
          parts: message.parts,
          attachments: [],
        });
      },
    });
    void result.completion.catch(() => logErrorId("credit_settlement_failed"));
    const stream = createUIMessageStream({
      execute: ({ writer }) => {
        writer.merge(result.stream);
      },
      generateId: () => crypto.randomUUID(),
      onEnd: async ({ messages }) => {
        await createMultipleMessages(
          messages
            .filter((item) => item.role === "assistant")
            .map((item) => ({
              id: item.id,
              chatId: id,
              role: "assistant",
              parts: item.parts,
              attachments: [],
            })),
          access.userId,
        );
      },
      onError: () => "chat_failed",
    });
    return createUIMessageStreamResponse({
      stream,
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    return errorResponse(error, "chat_failed");
  }
}

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    return NextResponse.json(
      { error: { id: "invalid_chat" } },
      { status: 400 },
    );
  }

  try {
    const access = await requireChatAccess(request.headers);
    const chat = await getChatForUser(id, access.userId);
    if (!chat) {
      return NextResponse.json({ error: { id: "forbidden" } }, { status: 403 });
    }
    const deletedChat = await deleteChat(id, access.userId);
    return Response.json(deletedChat, { status: 200 });
  } catch (error) {
    return errorResponse(error, "chat_failed");
  }
}

export async function PATCH(request: Request) {
  try {
    const access = await requireChatAccess(request.headers);
    const json: unknown = await request.json();
    if (!json || typeof json !== "object") {
      throw new AppError("invalid_request", 400);
    }
    const id =
      "id" in json && typeof json.id === "string" ? json.id.trim() : "";
    const title =
      "title" in json && typeof json.title === "string"
        ? json.title.trim()
        : "";
    if (!id || !title || title.length > 200) {
      throw new AppError("invalid_title", 400);
    }
    const chat = await getChatForUser(id, access.userId);
    if (!chat) {
      return NextResponse.json({ error: { id: "forbidden" } }, { status: 403 });
    }
    const updated = await updateChat({
      id,
      title,
      userId: access.userId,
    });
    return NextResponse.json(updated);
  } catch (error) {
    return errorResponse(error, "chat_failed");
  }
}
