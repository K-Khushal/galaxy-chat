"use client";
import { PanelLeftClose, Plus, Sparkles } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";

export function SidebarActions({ onNewChat }: { onNewChat?: () => void } = {}) {
  const router = useRouter();
  const { toggleSidebar, setOpenMobile, state, isMobile } = useSidebar();
  return (
    <SidebarMenu>
      <SidebarMenuItem className="flex min-h-14 items-center justify-between px-2">
        <div className="flex min-w-0 items-center gap-2.5 group-data-[collapsible=icon]:hidden">
          <Sparkles aria-hidden="true" className="size-5 text-primary" />
          <span className="font-semibold tracking-tight">
            Galaxy
            <span className="ml-1 font-normal text-muted-foreground">Chat</span>
          </span>
        </div>
        <Button
          variant="ghost"
          size="icon"
          aria-label={
            state === "collapsed" && !isMobile
              ? "Open sidebar"
              : "Close sidebar"
          }
          onClick={(event) => toggleSidebar(event.currentTarget)}
        >
          <PanelLeftClose className="size-4" />
        </Button>
      </SidebarMenuItem>
      <SidebarMenuItem className="mt-2">
        <SidebarMenuButton
          tooltip="New conversation"
          className="min-h-11 border border-sidebar-border bg-background/60 font-medium shadow-xs"
          onClick={() => {
            setOpenMobile(false);
            if (onNewChat) onNewChat();
            else {
              router.push("/chat");
              router.refresh();
            }
          }}
        >
          <Plus />
          <span>New conversation</span>
        </SidebarMenuButton>
      </SidebarMenuItem>
      {!onNewChat && (
        <>
          <SidebarMenuItem>
            <SidebarMenuButton asChild className="min-h-11">
              <Link href="/chat/temporary" onClick={() => setOpenMobile(false)}>
                <span>Temporary conversation</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton asChild className="min-h-11">
              <Link href="/chat/context" onClick={() => setOpenMobile(false)}>
                <span>Memory & projects</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </>
      )}
    </SidebarMenu>
  );
}
