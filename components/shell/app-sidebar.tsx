"use client";

import {
  PanelLeft,
  Plus,
  Search,
  Settings,
  Shield,
  Sparkles,
} from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { type ReactNode, useEffect, useState } from "react";
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

// The command palette (cmdk) loads the first time it is wanted.
const loadSearchDialog = () => import("@/components/shell/search-dialog");
const SearchDialog = dynamic(
  () => loadSearchDialog().then((m) => m.SearchDialog),
  { ssr: false },
);

/**
 * The sidebar frame. `footer` is the slot for the account menu and the
 * Credits indicator; `chats` fills the "Chats" group.
 */
export function AppSidebar({
  footer,
  chats,
}: {
  footer: ReactNode;
  /** The Chat list. Defaults to an empty-state hint. */
  chats?: ReactNode;
}) {
  const pathname = usePathname();
  const { toggleSidebar, state } = useSidebar();
  const [searchOpen, setSearchOpen] = useState(false);
  // Stays mounted after the first open so it can animate closed.
  const [searchWanted, setSearchWanted] = useState(false);
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setSearchWanted(true);
        setSearchOpen((open) => !open);
      }
    };
    document.addEventListener("keydown", listener);
    return () => document.removeEventListener("keydown", listener);
  }, []);

  return (
    <>
      <Sidebar collapsible="icon">
        <SidebarHeader className="flex-row items-center justify-between gap-2 p-2 group-data-[collapsible=icon]:flex-col group-data-[collapsible=icon]:justify-start">
          <Link
            href="/chat"
            className="flex h-8 min-w-0 items-center gap-2 rounded-lg px-2 pointer-coarse:min-h-11 font-medium tracking-tight outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
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
                    tooltip="New Temporary chat"
                    isActive={pathname === "/chat/temporary"}
                    render={<Link href="/chat/temporary" />}
                  >
                    <Shield />
                    <span>New Temporary chat</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    tooltip="Search"
                    onPointerEnter={() => void loadSearchDialog()}
                    onFocus={() => void loadSearchDialog()}
                    onClick={() => {
                      setSearchWanted(true);
                      setSearchOpen(true);
                    }}
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
              {chats ?? (
                <p className="px-2 py-1.5 text-sm text-muted-foreground">
                  Your chats will appear here.
                </p>
              )}
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>

        <SidebarFooter className="gap-1 p-2">
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                tooltip="Settings"
                render={<Link href="/chat/settings" />}
              >
                <Settings />
                <span>Settings</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
          {footer}
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>
      {searchWanted && (
        <SearchDialog open={searchOpen} onOpenChange={setSearchOpen} />
      )}
    </>
  );
}
