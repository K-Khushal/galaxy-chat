"use client";

import { motion } from "framer-motion";
import { Forward, LoaderIcon, MoreHorizontal, Trash2 } from "lucide-react";
import Link from "next/link";
import { useParams, usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import useSWRInfinite from "swr/infinite";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSkeleton,
  useSidebar,
} from "@/components/ui/sidebar";
import { fetchJson } from "@/lib/ai/utils";
import type { ChatHistory } from "@/lib/types";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { TextEffect } from "../ui/text-effect";

export function SidebarHistory() {
  const router = useRouter();
  const { id } = useParams();
  const pathname = usePathname();
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [query, setQuery] = useState("");
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameTitle, setRenameTitle] = useState("");
  const [renamePending, setRenamePending] = useState(false);
  const { isMobile } = useSidebar();

  const {
    data: paginatedChatHistory,
    setSize,
    isValidating,
    isLoading,
    mutate,
  } = useSWRInfinite<ChatHistory>(
    (pageIndex, previousPageData) =>
      getPaginatedChatHistory(pageIndex, previousPageData, query),
    fetchJson,
    {
      fallbackData: [] as ChatHistory[],
    },
  );

  const hasReachedEnd = paginatedChatHistory
    ? paginatedChatHistory.some((page) => page.hasMore === false)
    : false;

  const hasEmptyChatHistory = paginatedChatHistory
    ? paginatedChatHistory.every((page) => page.chats.length === 0)
    : false;

  // Listen for chat creation events to trigger sidebar update
  useEffect(() => {
    const handleChatCreated = () => {
      mutate(); // Revalidate the sidebar data
    };

    window.addEventListener("chat-created", handleChatCreated);
    return () => window.removeEventListener("chat-created", handleChatCreated);
  }, [mutate]);

  // Get current chat ID from params or pathname as fallback
  const currentChatId = id || pathname.split("/").pop();

  const handleDelete = () => {
    const deletePromise = fetch(`/api/chat?id=${deleteId}`, {
      method: "DELETE",
    });

    toast.promise(deletePromise, {
      loading: "Deleting chat...",
      closeButton: true,
      success: () => {
        mutate((chatHistories) => {
          if (chatHistories) {
            return chatHistories.map((chatHistory) => ({
              ...chatHistory,
              chats: chatHistory.chats.filter((chat) => chat.id !== deleteId),
            }));
          }
        });

        return "Chat deleted successfully";
      },
      error: "Failed to delete chat",
    });

    setShowDeleteDialog(false);

    if (deleteId === currentChatId) {
      router.push("/chat");
    }
  };

  async function saveRename() {
    if (!renameId || renameTitle.trim().length === 0) {
      return;
    }
    setRenamePending(true);
    try {
      const response = await fetch("/api/chat", {
        body: JSON.stringify({ id: renameId, title: renameTitle.trim() }),
        headers: { "content-type": "application/json" },
        method: "PATCH",
      });
      if (!response.ok) {
        toast.error("Could not rename conversation");
        return;
      }
      setRenameId(null);
      await mutate();
    } catch {
      toast.error("Could not rename conversation");
    } finally {
      setRenamePending(false);
    }
  }

  return (
    <>
      <SidebarGroup className="group-data-[collapsible=icon]:hidden">
        <SidebarGroupContent>
          <div className="px-2 pb-2">
            <label className="sr-only" htmlFor="history-search">
              Search conversations
            </label>
            <Input
              id="history-search"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search titles"
              value={query}
            />
          </div>
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
              .map((item) => {
                return (
                  <SidebarMenuItem key={item.id}>
                    <SidebarMenuButton
                      asChild
                      isActive={item.id === currentChatId}
                    >
                      <Link href={`/chat/${item.id}`}>
                        {/* <span>{item.title}</span> */}
                        <TextEffect per="char" preset="fade">
                          {item.title}
                        </TextEffect>
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
                        <DropdownMenuItem
                          onSelect={() => {
                            setRenameId(item.id);
                            setRenameTitle(item.title);
                          }}
                        >
                          <span>Rename</span>
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          onSelect={() => {
                            setDeleteId(item.id);
                            setShowDeleteDialog(true);
                          }}
                          variant="destructive"
                          className="cursor-pointer"
                        >
                          <Trash2 className="text-muted-foreground" />
                          <span>Delete</span>
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </SidebarMenuItem>
                );
              })}
          </SidebarMenu>
        </SidebarGroupContent>
        <motion.div
          onViewportEnter={() => {
            if (!isValidating && !hasReachedEnd) {
              setSize((size) => size + 1);
            }
          }}
        />
        {!isLoading &&
          !hasEmptyChatHistory &&
          (hasReachedEnd ? (
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
          ))}
      </SidebarGroup>

      <AlertDialog onOpenChange={setShowDeleteDialog} open={showDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. This will permanently delete your
              chat and remove it from our servers.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="cursor-pointer">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="cursor-pointer"
            >
              Continue
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <Dialog
        onOpenChange={(open) => {
          if (!open) {
            setRenameId(null);
          }
        }}
        open={renameId !== null}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename conversation</DialogTitle>
          </DialogHeader>
          <label htmlFor="conversation-title">Title</label>
          <Input
            id="conversation-title"
            onChange={(event) => setRenameTitle(event.target.value)}
            value={renameTitle}
          />
          <DialogFooter>
            <Button
              disabled={renamePending || renameTitle.trim().length === 0}
              onClick={() => void saveRename()}
              type="button"
            >
              Save title
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

const PAGE_SIZE = 15;

export function getPaginatedChatHistory(
  pageIndex: number,
  previousPageData: ChatHistory | null,
  query = "",
) {
  if (previousPageData && previousPageData.hasMore === false) {
    return null;
  }

  const search = new URLSearchParams();
  search.set("limit", String(PAGE_SIZE));
  const trimmed = query.trim();
  if (trimmed.length > 0) {
    search.set("q", trimmed);
  }

  if (pageIndex === 0) {
    return `/api/history?${search.toString()}`;
  }

  const firstChatFromPage = previousPageData?.chats.at(-1);

  if (!firstChatFromPage) {
    return null;
  }

  search.set("ending_before", firstChatFromPage.id);
  return `/api/history?${search.toString()}`;
}
