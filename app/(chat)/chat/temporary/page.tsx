import Chat from "@/components/chat/chat";
export const dynamic = "force-dynamic";
export default function Page() {
  return <Chat id={crypto.randomUUID()} chatMessages={[]} temporary />;
}
