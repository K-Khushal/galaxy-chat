import Chat from "@/components/chat/chat";
import { v4 as uuidv4 } from "uuid";

export default async function Page() {
  const id = uuidv4();

  return (
    <>
      <Chat id={id} chatMessages={[]} />
    </>
  );
}
