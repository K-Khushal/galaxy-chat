"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import type { ChatSummary } from "@/lib/chat/store";
import { api } from "./api";
export function RecentChats() {
  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [failed, setFailed] = useState(false);
  const pathname = usePathname();
  const { isMobile, setOpenMobile } = useSidebar();
  useEffect(() => {
    let active = true;
    const load = () =>
      api<{ chats: ChatSummary[] }>("/api/chats")
        .then((data) => {
          if (active) {
            setChats(data.chats.slice(0, 30));
            setFailed(false);
          }
        })
        .catch(() => {
          if (active) setFailed(true);
        });
    void load();
    window.addEventListener("galaxy:chats", load);
    return () => {
      active = false;
      window.removeEventListener("galaxy:chats", load);
    };
  }, []);
  return (
    <SidebarMenu>
      {chats.map((chat) => (
        <SidebarMenuItem key={chat.id}>
          <SidebarMenuButton
            isActive={pathname === `/chat/${chat.id}`}
            render={<Link href={`/chat/${chat.id}`} />}
            onClick={() => {
              if (isMobile) setOpenMobile(false);
            }}
          >
            <span className="truncate">{chat.title ?? "New Chat"}</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      ))}
      {!chats.length && (
        <p className="px-2 py-1.5 text-sm text-muted-foreground">
          {failed
            ? "Could not load Chats. Refresh to try again."
            : "Your chats will appear here."}
        </p>
      )}
    </SidebarMenu>
  );
}
