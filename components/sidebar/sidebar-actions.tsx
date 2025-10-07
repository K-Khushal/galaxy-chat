"use client";

import GalaxyChat from "@/components/svg/galaxy-chat";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { Image, SquarePen } from "lucide-react";
import { useRouter } from "next/navigation";

export function SidebarActions() {
  const router = useRouter();
  const { state } = useSidebar();

  return (
    <SidebarMenu>
      {/* Logo and Toggle Section */}
      <SidebarMenuItem
        className={`flex items-center justify-between px-2 py-2 w-full group`}
      >
        <div className="flex items-center relative w-6 h-6 justify-center">
          <GalaxyChat
            className={`w-6 h-6 transition-opacity -ml-0.5 ${
              state === "collapsed"
                ? "opacity-100 group-hover:opacity-0"
                : "opacity-100"
            }`}
          />
          <SidebarTrigger
            className={`absolute inset-0 w-6 h-6 transition-opacity -ml-0.5 ${
              state === "collapsed"
                ? "opacity-0 group-hover:opacity-100"
                : "opacity-0"
            }`}
          />
        </div>
        <SidebarTrigger
          className={`px-1 py-1 transition-opacity ${
            state === "expanded" ? "opacity-100" : "opacity-0"
          }`}
        />
      </SidebarMenuItem>

      {/* New Chat Button */}
      <SidebarMenuItem className="mt-2">
        <SidebarMenuButton
          onClick={() => {
            router.push("/chat");
            router.refresh();
          }}
          className="cursor-pointer"
        >
          <SquarePen />
          <span>New Chat</span>
        </SidebarMenuButton>
      </SidebarMenuItem>

      {/* Library Button */}
      <SidebarMenuItem>
        <SidebarMenuButton
          onClick={() => {
            router.push("/chat/library");
            router.refresh();
          }}
          className="cursor-pointer"
        >
          <Image />
          <span>Library</span>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
