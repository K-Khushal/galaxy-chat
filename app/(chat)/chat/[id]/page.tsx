import Chat from "@/components/chat/chat";
import { getChat } from "@/lib/actions/chat/chat";
import { getChatMessages } from "@/lib/actions/chat/chat-message";
import { convertToUIMessages } from "@/lib/ai/utils";
import { notFound } from "next/navigation";

export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const chat = await getChat(id);

  if (!chat) {
    return notFound();
  }

  const messages = await getChatMessages({ chatId: id });

  const chatMessages = convertToUIMessages(messages);

  return (
    <>
      <Chat
        id={chat.id}
        chatMessages={chatMessages}
        lastContext={chat.lastContext ?? undefined}
      />
    </>
  );
}
