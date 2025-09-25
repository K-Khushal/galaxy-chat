import { SidebarActions } from "@/components/chat/sidebar-actions"
import { SidebarHistory } from "@/components/chat/sidebar-history"
import { SidebarUser } from "@/components/chat/sidebar-user"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar"
import type { TypeSidebarUser } from "@/lib/types"
import { Sparkles } from "lucide-react"
import Link from "next/link"
import * as React from "react"

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
    }
  ],
}

export function AppSidebar({ user, ...props }: React.ComponentProps<typeof Sidebar> & { user?: TypeSidebarUser }) {
  return (
    <Sidebar {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <Link href="#" aria-label="Go to home" className="flex items-center gap-2 self-center font-medium cursor-default">
                <div className="bg-primary text-primary-foreground flex size-6 items-center justify-center rounded-md">
                  <Sparkles className="size-4" />
                </div>
                Galaxy Chat
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <SidebarActions />
      </SidebarHeader>
      <SidebarContent>
        <SidebarHistory items={data.navMain} />
      </SidebarContent>
      <SidebarFooter>
        <div className="pb-2">
          {user ? <SidebarUser user={user} /> : null}
        </div>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
