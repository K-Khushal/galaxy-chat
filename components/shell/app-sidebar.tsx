"use client";

import { PanelLeft, Plus, Search, Settings, Sparkles } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { type ReactNode, useState } from "react";
import { SearchDialog } from "@/components/shell/search-dialog";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar";

/**
 * The sidebar frame. `footer` is the slot for the account menu and the
 * Credits indicator; the chat list fills the "Chats" group in a later
 * milestone.
 */
export function AppSidebar({ footer }: { footer: ReactNode }) {
  const pathname = usePathname();
  const { toggleSidebar, state } = useSidebar();
  const [searchOpen, setSearchOpen] = useState(false);

  return (
    <>
      <Sidebar collapsible="icon">
        <SidebarHeader className="flex-row items-center justify-between gap-2 p-2 group-data-[collapsible=icon]:flex-col group-data-[collapsible=icon]:justify-start">
          <Link
            href="/chat"
            className="flex h-8 min-w-0 items-center gap-2 rounded-lg px-2 font-medium tracking-tight outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
          >
            <Sparkles className="size-4 shrink-0 text-sidebar-primary" />
            <span className="truncate group-data-[collapsible=icon]:sr-only">
              Galaxy
            </span>
          </Link>
          <SidebarMenuButton
            className="size-8 w-auto justify-center p-0 pointer-coarse:size-11 group-data-[collapsible=icon]:size-8"
            aria-label={
              state === "expanded" ? "Collapse sidebar" : "Expand sidebar"
            }
            tooltip={
              state === "expanded" ? "Collapse sidebar" : "Expand sidebar"
            }
            onClick={toggleSidebar}
          >
            <PanelLeft />
          </SidebarMenuButton>
        </SidebarHeader>

        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    tooltip="New chat"
                    isActive={pathname === "/chat"}
                    render={<Link href="/chat" />}
                  >
                    <Plus />
                    <span>New chat</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    tooltip="Search"
                    onClick={() => setSearchOpen(true)}
                  >
                    <Search />
                    <span>Search</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>

          <SidebarGroup className="group-data-[collapsible=icon]:hidden">
            <SidebarGroupLabel>Chats</SidebarGroupLabel>
            <SidebarGroupContent>
              <p className="px-2 py-1.5 text-sm text-muted-foreground">
                Your chats will appear here.
              </p>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>

        <SidebarFooter className="gap-1 p-2">
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton tooltip="Settings (coming soon)" aria-disabled>
                <Settings />
                <span>Settings</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
          {footer}
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>
      <SearchDialog open={searchOpen} onOpenChange={setSearchOpen} />
    </>
  );
}
