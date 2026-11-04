import type { Metadata } from "next";
import { cookies } from "next/headers";
import type { ReactNode } from "react";
import { RecentChats } from "@/components/chat/recent-chats";
import { AccountMenu } from "@/components/shell/account-menu";
import { AppSidebar } from "@/components/shell/app-sidebar";
import { ChatHeader } from "@/components/shell/chat-header";
import { CreditsIndicator } from "@/components/shell/credits-indicator";
import { ViewportHeight } from "@/components/shell/viewport-height";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { requireSignedIn } from "@/lib/auth/gate";

// Everything under /chat is private; crawlers are also kept out by robots.txt.
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function ChatLayout({
  children,
}: {
  children: ReactNode;
}) {
  const [user, cookieStore] = await Promise.all([requireSignedIn(), cookies()]);
  const defaultOpen = cookieStore.get("sidebar_state")?.value !== "false";

  return (
    <TooltipProvider>
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
        <SidebarInset className="h-[var(--app-height,100dvh)] min-w-0 pr-[env(safe-area-inset-right)]">
          <ViewportHeight />
          <ChatHeader />
          <div className="flex min-h-0 flex-1 flex-col">{children}</div>
        </SidebarInset>
      </SidebarProvider>
      <Toaster />
    </TooltipProvider>
  );
}
