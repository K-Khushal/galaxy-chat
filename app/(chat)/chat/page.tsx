import { nanoid } from "nanoid";
import Chat from "@/components/chat/chat";

export const dynamic = "force-dynamic";

export default function Page() {
  const id = nanoid();

  return <Chat id={id} chatMessages={[]} />;
}
