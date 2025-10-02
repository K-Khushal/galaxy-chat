"use client";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { deleteChatAction } from "@/lib/actions/chat/chat-actions";
import { MessageSquare, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

export interface ChatHistoryItem {
  id: string;
  title: string;
  createdAt: Date;
  updatedAt: Date;
}

interface SidebarHistoryProps {
  chats: ChatHistoryItem[];
  currentChatId?: string;
}

export function SidebarHistory({ chats, currentChatId }: SidebarHistoryProps) {
  const { isMobile } = useSidebar();
  const router = useRouter();
  const [deletingChatId, setDeletingChatId] = useState<string | null>(null);

  const handleDeleteChat = async (chatId: string, chatTitle: string) => {
    if (deletingChatId) return; // Prevent multiple deletions

    // Validate inputs
    if (!chatId || !chatTitle) {
      toast.error("Invalid chat data");
      return;
    }

    setDeletingChatId(chatId);

    try {
      const result = await deleteChatAction(chatId);

      if (result.success) {
        toast.success(`Chat "${chatTitle}" deleted successfully`);

        // If we're currently viewing the deleted chat, redirect to main chat page
        if (currentChatId === chatId) {
          router.push("/chat");
        } else {
          // Refresh the page to update the sidebar
          router.refresh();
        }
      } else {
        toast.error(result.error || "Failed to delete chat");
      }
    } catch (error) {
      console.error("Error deleting chat:", error);
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error occurred";
      toast.error(`Failed to delete chat: ${errorMessage}`);
    } finally {
      setDeletingChatId(null);
    }
  };

  const handleRenameChat = () => {
    // TODO: Implement rename functionality
    toast.info("Rename functionality coming soon!");
  };

  if (chats.length === 0) {
    return (
      <SidebarGroup className="group-data-[collapsible=icon]:hidden">
        <SidebarGroupLabel>Chats</SidebarGroupLabel>
        <div className="px-2 py-4 text-sm text-muted-foreground">
          <div className="mb-2">No chats yet.</div>
          <div className="text-xs">
            Start a conversation by clicking "New Chat" or going to the main
            chat page.
          </div>
        </div>
      </SidebarGroup>
    );
  }

  return (
    <SidebarGroup className="group-data-[collapsible=icon]:hidden">
      <SidebarGroupLabel>Chats</SidebarGroupLabel>
      <SidebarMenu>
        {chats.map((chat) => {
          const isActive = currentChatId === chat.id;
          const isDeleting = deletingChatId === chat.id;

          return (
            <SidebarMenuItem key={chat.id}>
              <DropdownMenu>
                <div className="flex items-center w-full">
                  <Link
                    href={`/chat/${chat.id}`}
                    className="flex-1 min-w-0"
                    prefetch={false}
                  >
                    <SidebarMenuButton
                      isActive={isActive}
                      className="w-full justify-start pr-8 relative group"
                      disabled={isDeleting}
                    >
                      <MessageSquare className="h-4 w-4 shrink-0" />
                      <span className="truncate text-left">{chat.title}</span>
                    </SidebarMenuButton>
                  </Link>

                  <DropdownMenuTrigger asChild>
                    <SidebarMenuButton
                      size="sm"
                      className="absolute right-1 h-6 w-6 p-0 opacity-0 group-hover:opacity-100 data-[state=open]:opacity-100 hover:bg-sidebar-accent"
                      disabled={isDeleting}
                    >
                      <MoreHorizontal className="h-3 w-3" />
                      <span className="sr-only">Chat options</span>
                    </SidebarMenuButton>
                  </DropdownMenuTrigger>
                </div>

                <DropdownMenuContent
                  side={isMobile ? "bottom" : "right"}
                  align={isMobile ? "end" : "start"}
                  className="min-w-48 rounded-lg"
                >
                  <DropdownMenuItem
                    key={`rename-${chat.id}`}
                    onClick={handleRenameChat}
                    disabled={isDeleting}
                  >
                    <Pencil className="h-4 w-4 mr-2" />
                    Rename
                  </DropdownMenuItem>
                  <DropdownMenuSeparator key={`separator-${chat.id}`} />
                  <DropdownMenuItem
                    key={`delete-${chat.id}`}
                    onClick={() => handleDeleteChat(chat.id, chat.title)}
                    disabled={isDeleting}
                    className="text-destructive focus:text-destructive"
                  >
                    <Trash2 className="h-4 w-4 mr-2" />
                    {isDeleting ? "Deleting..." : "Delete"}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </SidebarMenuItem>
          );
        })}
      </SidebarMenu>
    </SidebarGroup>
  );
}
