"use server";

import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { generateText, type UIMessage } from "ai";
import { headers } from "next/headers";
import {
  deleteTrailingMessages,
  getMessageById,
} from "@/lib/actions/chat/chat-message";
import { runFundedModelCall } from "@/lib/ai/funded";
import { requireChatAccess } from "@/lib/auth/access";
import { AppError } from "@/lib/errors";

export async function generateChatTitle({ message }: { message: UIMessage }) {
  return runFundedModelCall(process.env, async () => {
    const providerKey = process.env.OPENROUTER_API_KEY?.trim();
    if (!providerKey) {
      throw new AppError("provider_unconfigured", 503);
    }
    const openrouter = createOpenRouter({ apiKey: providerKey });
    const { text: title } = await generateText({
      model: openrouter.chat("openai/gpt-4o-mini"),
      instructions:
        "Generate a short title, at most 80 characters, summarizing the user's message. Do not use quotes or colons.",
      prompt: JSON.stringify({
        role: message.role,
        parts: message.parts,
      }),
    });
    return title;
  });
}

export async function deleteChatMessages(id: string) {
  const access = await requireChatAccess(await headers());
  const message = await getMessageById(id, access.userId);

  if (!message) {
    throw new AppError("not_found", 404);
  }

  await deleteTrailingMessages(
    message.chatId,
    access.userId,
    message.createdAt,
  );
}
