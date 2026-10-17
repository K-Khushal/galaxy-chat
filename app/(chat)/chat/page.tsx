import Chat from "@/components/chat/chat";

export const dynamic = "force-dynamic";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ project?: string }>;
}) {
  const id = crypto.randomUUID();

  return (
    <Chat
      id={id}
      chatMessages={[]}
      initialProjectId={(await searchParams).project ?? null}
    />
  );
}
