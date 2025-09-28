"use client";

import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { Sparkles, SquarePen } from "lucide-react";
import { useRouter } from "next/navigation";

export function SidebarActions() {
  const router = useRouter();
  const { state, toggleSidebar } = useSidebar();

  return (
    <SidebarMenu>
      {/* Logo and Toggle Section */}
      <SidebarMenuItem>
        {state === "collapsed" ? (
          <div className="relative">
            <SidebarMenuButton
              onClick={toggleSidebar}
              className="cursor-pointer justify-center group"
              size="lg"
            >
              <div
                className="bg-primary text-primary-foreground flex w-6 h-6 items-center justify-center rounded-md
              opacity-100 group-hover:opacity-0 transition-opacity duration-100 ease-in-out pointer-events-none"
              >
                <Sparkles className="w-4 h-4" />
              </div>
            </SidebarMenuButton>
            <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-100 ease-in-out pointer-events-none">
              <SidebarTrigger className="px-1 py-1 pointer-events-auto" />
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between px-2 py-2 w-full">
            <div className="flex items-center gap-2">
              <div className="bg-primary text-primary-foreground flex w-6 h-6 items-center justify-center rounded-md">
                <Sparkles className="w-4 h-4" />
              </div>
            </div>
            <SidebarTrigger className="px-1 py-1" />
          </div>
        )}
      </SidebarMenuItem>

      {/* New Chat Button */}
      <SidebarMenuItem className="mt-2">
        <SidebarMenuButton
          onClick={() => {
            router.push("/chat");
          }}
          className="cursor-pointer"
        >
          <SquarePen />
          <span>New Chat</span>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
