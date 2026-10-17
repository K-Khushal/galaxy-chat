import Chat from "@/components/chat/chat";

export const dynamic = "force-dynamic";

export default function Page() {
  const id = crypto.randomUUID();

  return <Chat id={id} chatMessages={[]} />;
}
