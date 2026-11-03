"use client";

import { PanelLeft, Search, SquarePen } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { type ReactNode, useEffect, useState } from "react";
import { GalaxyMark } from "@/components/icons/brand";
import { Kbd } from "@/components/ui/kbd";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar";
import { EmptyState } from "@/components/ui/state";

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
  const router = useRouter();
  const [apple, setApple] = useState(true);
  const { toggleSidebar, state } = useSidebar();
  const [searchOpen, setSearchOpen] = useState(false);
  // Stays mounted after the first open so it can animate closed.
  const [searchWanted, setSearchWanted] = useState(false);
  useEffect(() => {
    setApple(/Mac|iPhone|iPad|iPod/.test(navigator.platform));
    const listener = (event: KeyboardEvent) => {
      if (event.key === "," && (event.metaKey || event.ctrlKey)) {
        const target = document.activeElement;
        if (
          (target instanceof HTMLInputElement ||
            target instanceof HTMLTextAreaElement) &&
          target.selectionStart !== target.selectionEnd
        )
          return;
        if (
          target instanceof HTMLElement &&
          target.isContentEditable &&
          document.getSelection()?.toString()
        )
          return;
        event.preventDefault();
        router.push("/chat/settings");
      }
      if (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setSearchWanted(true);
        setSearchOpen((open) => !open);
      }
    };
    document.addEventListener("keydown", listener);
    return () => document.removeEventListener("keydown", listener);
  }, [router]);

  return (
    <>
      <Sidebar collapsible="icon">
        <SidebarHeader className="flex-row items-center justify-between gap-2 p-2 group-data-[collapsible=icon]:flex-col group-data-[collapsible=icon]:justify-start">
          <Link
            href="/chat"
            className="flex h-8 min-w-0 items-center gap-2 rounded-lg px-2 pointer-coarse:min-h-11 text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
          >
            <GalaxyMark className="size-5 shrink-0 text-primary" />
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
                    <SquarePen />
                    <span>New chat</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    aria-label="Search"
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
                    <Kbd
                      aria-hidden="true"
                      className="ml-auto group-data-[collapsible=icon]:hidden"
                    >
                      {apple ? "⌘K" : "Ctrl K"}
                    </Kbd>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>

          <SidebarGroup className="group-data-[collapsible=icon]:hidden">
            <SidebarGroupContent>
              {chats ?? <EmptyState size="inline" title="No chats yet" />}
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>

        <SidebarFooter className="gap-1 p-2">{footer}</SidebarFooter>
        <SidebarRail />
      </Sidebar>
      {searchWanted && (
        <SearchDialog open={searchOpen} onOpenChange={setSearchOpen} />
      )}
    </>
  );
}
