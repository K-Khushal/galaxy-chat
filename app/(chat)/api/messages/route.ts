import { NextResponse } from "next/server";
import { z } from "zod";
import {
  createMultipleMessages,
  listOwnedMessages,
} from "@/lib/actions/chat/chat-message";
import { requireChatAccess } from "@/lib/auth/access";
import { errorResponse } from "@/lib/http/error-response";

const messageSchema = z.object({
  attachments: z.array(z.unknown()).max(20).optional(),
  chatId: z.string().trim().min(1).max(200),
  id: z.string().trim().min(1).max(200),
  parts: z.array(z.unknown()).max(100),
  role: z.enum(["system", "user", "assistant"]),
});

const postSchema = z.object({
  messages: z.array(messageSchema).min(1).max(50),
});

export async function GET(request: Request) {
  const url = new URL(request.url);
  const chatId = url.searchParams.get("chatId") ?? "";
  const afterId = url.searchParams.get("after") ?? undefined;
  const limit = Number.parseInt(url.searchParams.get("limit") || "100", 10);
  try {
    const access = await requireChatAccess(request.headers);
    if (!chatId.trim()) {
      return NextResponse.json(
        { error: { id: "invalid_message" } },
        { status: 400 },
      );
    }
    const page = await listOwnedMessages({
      afterId,
      chatId,
      limit,
      userId: access.userId,
    });
    return NextResponse.json(page);
  } catch (error) {
    return errorResponse(error, "messages_failed");
  }
}

export async function POST(request: Request) {
  try {
    const access = await requireChatAccess(request.headers);
    const json: unknown = await request.json();
    const body = postSchema.parse(json);
    const messages = await createMultipleMessages(body.messages, access.userId);
    return NextResponse.json({ messages }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: { id: "invalid_request" } },
        { status: 400 },
      );
    }
    return errorResponse(error, "messages_failed");
  }
}
