import { headers } from "next/headers";
import { notFound } from "next/navigation";
import type { ChatView } from "@/components/chat/api";
import { Chat } from "@/components/chat/chat";
import { getChatRoute } from "@/lib/api/chats";
import { appContext } from "@/lib/api/production";
export default async function ChatPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const response = await getChatRoute(
    appContext(),
    new Request("http://localhost/api/chats", { headers: await headers() }),
    id,
  );
  if (response.status === 404) notFound();
  if (!response.ok) throw new Error("Could not load Chat");
  const initial: ChatView = await response.json();
  return <Chat key={id} initial={initial} />;
}
