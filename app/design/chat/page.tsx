import { notFound } from "next/navigation";
import { ChatLoader } from "@/components/chat/chat";
import { RecentChats } from "@/components/chat/recent-chats";
import { AppSidebar } from "@/components/shell/app-sidebar";
import { ChatHeader } from "@/components/shell/chat-header";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
// Isolated verification surface. Never bypasses authentication on /chat or its API.
export default async function ChatDesign({
  searchParams,
}: {
  searchParams: Promise<{ id?: string }>;
}) {
  if (process.env.NODE_ENV === "production") notFound();
  const { id } = await searchParams;
  return (
    <SidebarProvider>
      <AppSidebar
        chats={<RecentChats />}
        footer={
          <span className="p-2 text-xs text-muted-foreground">
            Local mock verification
          </span>
        }
      />
      <SidebarInset className="h-dvh min-w-0">
        <ChatHeader />
        <main className="flex min-h-0 flex-1 flex-col">
          {id && <ChatLoader id={id} />}
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
