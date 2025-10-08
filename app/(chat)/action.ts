"use server";

import { getChat } from "@/lib/actions/chat/chat";
import {
  deleteTrailingMessages,
  getMessageById,
} from "@/lib/actions/chat/chat-message";
import { auth } from "@clerk/nextjs/server";
import { generateText, type UIMessage } from "ai";

export async function generateChatTitle({ message }: { message: UIMessage }) {
  const { text: title } = await generateText({
    model: "meituan/longcat-flash-chat",
    system: `\n
      - you will generate a short title based on the first message a user begins a conversation with
      - ensure it is not more than 80 characters long
      - the title should be a summary of the user's message
      - do not use single quotes double quotes or colons`,
    prompt: JSON.stringify(message),
  });

  return title;
}

export async function deleteChatMessages(id: string) {
  const { isAuthenticated, userId } = await auth();

  if (!isAuthenticated || !userId) {
    throw new Error("Unauthorized");
  }

  const message = await getMessageById(id);

  if (!message) {
    throw new Error("Message not found");
  }

  const chatId = message.chatId;
  const chat = await getChat(chatId);

  if (!chat) {
    throw new Error("Chat not found");
  }

  if (chat.userId !== userId) {
    throw new Error(
      "Unauthorized: You can only delete messages from your own chats",
    );
  }

  const timestamp = message.createdAt;

  await deleteTrailingMessages(chatId, timestamp);
}
