import { SidebarActions } from "@/components/sidebar/sidebar-actions";
import { SidebarHistory } from "@/components/sidebar/sidebar-history";
import { SidebarUser } from "@/components/sidebar/sidebar-user";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarRail,
} from "@/components/ui/sidebar";
import type { TypeUserProfile } from "@/lib/types";
import type * as React from "react";

export function AppSidebar({
  user,
  ...props
}: React.ComponentProps<typeof Sidebar> & { user?: TypeUserProfile }) {
  return (
    <Sidebar {...props} collapsible="icon">
      <SidebarHeader>
        <SidebarActions />
      </SidebarHeader>

      <SidebarGroupLabel className="text-[16px] text-muted-foreground px-4">
        Chats
      </SidebarGroupLabel>

      <SidebarContent>
        <SidebarHistory />
      </SidebarContent>
      <SidebarFooter>
        <div className="pb-2">{user ? <SidebarUser user={user} /> : null}</div>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
