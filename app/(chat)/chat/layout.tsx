import { AppSidebar } from "@/components/sidebar/app-sidebar";
import type { ChatHistoryItem } from "@/components/sidebar/sidebar-history";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { getOrCreateUserProfile } from "@/lib/actions/auth/user";
import { getUserChats } from "@/lib/actions/chat/chat";
import { toSidebarUser, toUserProfileInput } from "@/lib/mappers/user";
import { auth, currentUser } from "@clerk/nextjs/server";
import { ChatUserProvider } from "./user-provider";

export default async function ChatLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const clerkUser = await currentUser();
  const profileInput = toUserProfileInput(clerkUser);
  if (profileInput) {
    // Fire-and-forget to avoid blocking first paint, but ensure errors are logged
    void getOrCreateUserProfile(profileInput).catch((error) => {
      console.error("getOrCreateUserProfile failed", {
        context: "ChatLayout",
        userId: profileInput.userId,
        error,
      });
    });
  }

  const sidebarUser = toSidebarUser(clerkUser);

  // Fetch user's chats for the sidebar
  let chats: ChatHistoryItem[] = [];
  try {
    const { userId } = await auth();
    if (userId) {
      const userChats = await getUserChats();
      chats = userChats.map((chat) => ({
        id: chat.id,
        title: chat.title,
        createdAt: chat.createdAt,
        updatedAt: chat.updatedAt,
      }));
    }
  } catch (error) {
    console.error("Failed to fetch user chats in layout:", error);
  }

  return (
    <SidebarProvider>
      <AppSidebar user={sidebarUser} chats={chats} />
      <SidebarInset>
        <ChatUserProvider user={sidebarUser ?? null}>
          {children}
        </ChatUserProvider>
      </SidebarInset>
    </SidebarProvider>
  );
}
