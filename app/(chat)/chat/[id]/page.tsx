import ChatInterface from "@/components/chat/chat-interface";
import {
  convertChatMessageToUIMessage,
  getChatById,
  getChatMessages,
} from "@/lib/actions/chat/chat";
import { isValidObjectId } from "@/lib/utils/validation";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

export default async function ConversationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { userId } = await auth();

  if (!userId) {
    redirect("/sign-in");
  }

  // Validate chat ID format before making database calls
  if (!id || typeof id !== "string" || !isValidObjectId(id)) {
    console.warn("Invalid chat ID provided:", id);
    redirect("/chat");
  }

  // Get chat and verify access
  const chat = await getChatById(id);
  if (!chat) {
    console.warn(`Chat not found or access denied: ${id}`);
    redirect("/chat");
  }

  // Get chat messages
  const chatMessages = await getChatMessages(id);

  // Convert to UI messages format
  const initialMessages = chatMessages.map(convertChatMessageToUIMessage);

  return (
    <ChatInterface
      chatId={id}
      chatTitle={chat.title}
      initialMessages={initialMessages}
    />
  );
}
