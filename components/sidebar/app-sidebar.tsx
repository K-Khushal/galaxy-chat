import { SidebarActions } from "@/components/sidebar/sidebar-actions";
import { SidebarHistory } from "@/components/sidebar/sidebar-history";
import { SidebarUser } from "@/components/sidebar/sidebar-user";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarRail,
} from "@/components/ui/sidebar";
import type { TypeUserProfile } from "@/lib/types";
import type * as React from "react";

// This is sample data.
const data = {
  navMain: [
    {
      title: "Getting Started",
      url: "#",
      items: [
        {
          title: "Edit",
          url: "#",
        },
        {
          title: "Delete",
          url: "#",
        },
      ],
    },
  ],
};

export function AppSidebar({
  user,
  ...props
}: React.ComponentProps<typeof Sidebar> & { user?: TypeUserProfile }) {
  return (
    <Sidebar {...props} collapsible="icon">
      <SidebarHeader>
        <SidebarActions />
      </SidebarHeader>
      <SidebarContent>
        <SidebarHistory items={data.navMain} />
      </SidebarContent>
      <SidebarFooter>
        <div className="pb-2">{user ? <SidebarUser user={user} /> : null}</div>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
