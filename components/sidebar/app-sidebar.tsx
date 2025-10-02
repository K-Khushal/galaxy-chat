"use client";

import { SidebarActions } from "@/components/sidebar/sidebar-actions";
import {
  type ChatHistoryItem,
  SidebarHistory,
} from "@/components/sidebar/sidebar-history";
import { SidebarUser } from "@/components/sidebar/sidebar-user";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarRail,
} from "@/components/ui/sidebar";
import type { TypeSidebarUser } from "@/lib/types";
import { useParams } from "next/navigation";
import type * as React from "react";

interface AppSidebarProps extends React.ComponentProps<typeof Sidebar> {
  user?: TypeSidebarUser;
  chats: ChatHistoryItem[];
}

export function AppSidebar({ user, chats, ...props }: AppSidebarProps) {
  const params = useParams();
  const currentChatId = params?.id as string | undefined;

  return (
    <Sidebar {...props} collapsible="icon">
      <SidebarHeader>
        <SidebarActions />
      </SidebarHeader>
      <SidebarContent>
        <SidebarHistory chats={chats} currentChatId={currentChatId} />
      </SidebarContent>
      <SidebarFooter>
        <div className="pb-2">{user ? <SidebarUser user={user} /> : null}</div>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
