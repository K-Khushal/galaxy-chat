"use server";

import { headers } from "next/headers";
import {
  deleteTrailingMessages,
  getMessageById,
} from "@/lib/actions/chat/chat-message";
import { requireChatAccess } from "@/lib/auth/access";
import { AppError } from "@/lib/errors";

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
