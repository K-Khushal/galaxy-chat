"use client"

import { SquarePen } from "lucide-react";

import {
    SidebarMenu,
    SidebarMenuButton,
    SidebarMenuItem,
} from "@/components/ui/sidebar";
import { useRouter } from "next/navigation";

export function SidebarActions() {
    const router = useRouter();

    return (
        <SidebarMenu>
            <SidebarMenuItem>
                <SidebarMenuButton onClick={() => {
                    router.push("/chat");
                }}
                    className="cursor-pointer"
                >
                    <SquarePen />
                    <span>New Chat</span>
                </SidebarMenuButton>
            </SidebarMenuItem>
        </SidebarMenu>
    )
}
