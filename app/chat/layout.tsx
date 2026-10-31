import { cookies } from "next/headers";
import type { ReactNode } from "react";
import { RecentChats } from "@/components/chat/recent-chats";
import { AccountMenu } from "@/components/shell/account-menu";
import { AppSidebar } from "@/components/shell/app-sidebar";
import { ChatHeader } from "@/components/shell/chat-header";
import { CreditsIndicator } from "@/components/shell/credits-indicator";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { requireSignedIn } from "@/lib/auth/gate";

export default async function ChatLayout({
  children,
  header,
}: {
  children: ReactNode;
  header: ReactNode;
}) {
  const [user, cookieStore] = await Promise.all([requireSignedIn(), cookies()]);
  const defaultOpen = cookieStore.get("sidebar_state")?.value !== "false";

  return (
    <SidebarProvider defaultOpen={defaultOpen}>
      <AppSidebar
        chats={<RecentChats />}
        footer={
          <>
            <CreditsIndicator />
            <AccountMenu
              user={{ name: user.name, email: user.email, image: user.image }}
            />
          </>
        }
      />
      <SidebarInset className="h-dvh min-w-0">
        <ChatHeader>{header}</ChatHeader>
        <main className="flex min-h-0 flex-1 flex-col">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  );
}
