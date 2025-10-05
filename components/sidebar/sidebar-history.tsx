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
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSkeleton,
  useSidebar,
} from "@/components/ui/sidebar";
import { fetchJson } from "@/lib/ai/utils";
import type { ChatHistory } from "@/lib/types";
import { motion } from "framer-motion";
import {
  Forward,
  LoaderIcon,
  type LucideIcon,
  MoreHorizontal,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import useSWRInfinite from "swr/infinite";

export function SidebarHistory({
  items,
}: {
  items: {
    title: string;
    url: string;
    icon?: LucideIcon;
    isActive?: boolean;
    items?: {
      title: string;
      url: string;
    }[];
  }[];
}) {
  const router = useRouter();
  const { id } = useParams();
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const { isMobile } = useSidebar();

  const {
    data: paginatedChatHistory,
    setSize,
    isValidating,
    isLoading,
    mutate,
  } = useSWRInfinite<ChatHistory>(getPaginatedChatHistory, fetchJson, {
    fallbackData: [],
  });

  const hasReachedEnd = paginatedChatHistory
    ? paginatedChatHistory.some((page) => page.hasMore === false)
    : false;

  const hasEmptyChatHistory = paginatedChatHistory
    ? paginatedChatHistory.every((page) => page.chats.length === 0)
    : false;

  return (
    <SidebarGroup className="group-data-[collapsible=icon]:hidden">
      <SidebarGroupLabel className="text-sm">Chats</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {isLoading &&
            [1, 2, 3, 4, 5].map((index) => (
              <SidebarMenuItem key={index}>
                <SidebarMenuSkeleton />
              </SidebarMenuItem>
            ))}
          {hasEmptyChatHistory && (
            <div className="mt-2 flex w-full flex-row items-center justify-center gap-2 px-2 text-sm text-zinc-500">
              Your conversations will appear here once you start chatting!
            </div>
          )}
          {paginatedChatHistory
            ?.flatMap((item) => item.chats)
            .map((item) => (
              <SidebarMenuItem key={item.id}>
                <SidebarMenuButton asChild isActive={item.id === id}>
                  <Link href={`/chat/${item.id}`}>
                    <span>{item.title}</span>
                  </Link>
                </SidebarMenuButton>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <SidebarMenuAction showOnHover className="ring-0">
                      <MoreHorizontal />
                      <span className="sr-only">More</span>
                    </SidebarMenuAction>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    className="w-32 rounded-lg"
                    side={isMobile ? "bottom" : "right"}
                    align={isMobile ? "end" : "start"}
                  >
                    <DropdownMenuItem>
                      <Forward className="text-muted-foreground" />
                      <span>Share</span>
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      variant="destructive"
                      className="cursor-pointer"
                    >
                      <Trash2 className="text-muted-foreground" />
                      <span>Delete</span>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </SidebarMenuItem>
            ))}
        </SidebarMenu>
      </SidebarGroupContent>
      <motion.div
        onViewportEnter={() => {
          if (!isValidating && !hasReachedEnd) {
            setSize((size) => size + 1);
          }
        }}
      />
      {hasReachedEnd ? (
        <div className="mt-4 flex w-full flex-row items-center justify-center gap-2 px-2 text-sm text-zinc-500">
          You have reached the end of your chat history.
        </div>
      ) : (
        <div className="mt-4 flex flex-row items-center gap-2 p-2 text-zinc-500 dark:text-zinc-400 text-sm">
          <div className="animate-spin">
            <LoaderIcon size={16} />
          </div>
          <div>Loading Chats...</div>
        </div>
      )}
    </SidebarGroup>
  );
}

const PAGE_SIZE = 15;

export function getPaginatedChatHistory(
  pageIndex: number,
  previousPageData: ChatHistory,
) {
  if (previousPageData && previousPageData.hasMore === false) {
    return null;
  }

  if (pageIndex === 0) {
    return `/api/history?limit=${PAGE_SIZE}`;
  }

  const firstChatFromPage = previousPageData.chats.at(-1);

  if (!firstChatFromPage) {
    return null;
  }

  return `/api/history?ending_before=${firstChatFromPage.id}&limit=${PAGE_SIZE}`;
}
