import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import Chat from "@/components/chat/chat";
import { getChatForUser } from "@/lib/actions/chat/chat";
import { getChatMessages } from "@/lib/actions/chat/chat-message";
import { convertToUIMessages } from "@/lib/ai/utils";
import { requireChatAccess } from "@/lib/auth/access";
import { AppError } from "@/lib/errors";

export const dynamic = "force-dynamic";

export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  let userId = "";
  try {
    userId = (await requireChatAccess(await headers())).userId;
  } catch (error) {
    if (error instanceof AppError) {
      redirect(`/sign-in?notice=${error.id}`);
    }
    throw error;
  }

  const chat = await getChatForUser(id, userId);

  if (!chat) {
    return notFound();
  }

  const messages = await getChatMessages({ chatId: id, userId });

  return (
    <Chat
      id={chat.id}
      title={chat.title}
      chatMessages={convertToUIMessages(messages)}
      lastContext={chat.lastContext ?? undefined}
    />
  );
}
