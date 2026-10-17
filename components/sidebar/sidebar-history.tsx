"use client";

import { Loader2, MoreHorizontal, Pencil, Search, Trash2 } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import useSWRInfinite from "swr/infinite";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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

export type HistoryPreview = {
  pages: ChatHistory[];
  activeId?: string;
  loading?: boolean;
  error?: boolean;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onRename: (id: string, title: string) => void;
};

export function SidebarHistory({ preview }: { preview?: HistoryPreview } = {}) {
  const router = useRouter();
  const params = useParams();
  const { isMobile, setOpenMobile } = useSidebar();
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [previewCount, setPreviewCount] = useState(1);
  const [editing, setEditing] = useState<{ id: string; title: string } | null>(
    null,
  );
  const [deleting, setDeleting] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const returnFocus = useRef<HTMLButtonElement | null>(null);
  function rememberOpener(id: string) {
    returnFocus.current = document.getElementById(
      `history-actions-${id}`,
    ) as HTMLButtonElement | null;
  }
  function restoreFocus(event: Event) {
    event.preventDefault();
    if (returnFocus.current?.isConnected) returnFocus.current.focus();
    else document.getElementById("history-search")?.focus();
  }
  const { data, error, isLoading, isValidating, setSize, mutate } =
    useSWRInfinite<ChatHistory>(
      (index, previous) =>
        preview ? null : getPaginatedChatHistory(index, previous, search),
      fetchJson,
    );
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(query.trim());
      setPreviewCount(1);
    }, 200);
    return () => clearTimeout(timer);
  }, [query]);
  useEffect(() => {
    if (preview) return;
    const refresh = () => {
      void mutate();
    };
    window.addEventListener("chat-created", refresh);
    return () => window.removeEventListener("chat-created", refresh);
  }, [mutate, preview]);

  const pages = preview
    ? search
      ? [
          {
            chats: preview.pages
              .flatMap((page) => page.chats)
              .filter((chat) =>
                chat.title.toLowerCase().includes(search.toLowerCase()),
              ),
            hasMore: false,
          },
        ]
      : preview.pages.slice(0, previewCount)
    : data;
  const chats = pages?.flatMap((page) => page.chats) ?? [];
  const loading = preview ? preview.loading : isLoading;
  const failed = preview ? preview.error : Boolean(error);
  const hasMore = preview
    ? !search && previewCount < preview.pages.length
    : pages?.at(-1)?.hasMore;
  const activeId = preview?.activeId ?? params.id;

  async function save(action: "rename" | "delete") {
    const id = action === "rename" ? editing?.id : deleting;
    if (!id || pending) return;
    setPending(true);
    try {
      if (preview) {
        if (action === "rename" && editing)
          preview.onRename(id, editing.title.trim());
        else preview.onDelete(id);
      } else {
        const response = await fetch(
          action === "delete"
            ? `/api/chat?id=${encodeURIComponent(id)}`
            : "/api/chat",
          {
            method: action === "delete" ? "DELETE" : "PATCH",
            ...(action === "rename"
              ? {
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({ id, title: editing?.title.trim() }),
                }
              : {}),
          },
        );
        if (!response.ok) throw new Error("Request failed");
        await mutate();
        if (action === "delete" && id === activeId) router.push("/chat");
      }
      setEditing(null);
      setDeleting(null);
      toast.success(
        action === "rename" ? "Conversation renamed" : "Conversation deleted",
      );
    } catch {
      toast.error(
        action === "rename"
          ? "Could not rename conversation. Try again."
          : "Could not delete conversation. Try again.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <SidebarGroup className="group-data-[collapsible=icon]:hidden">
        <SidebarGroupContent>
          <div className="relative mb-4">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute top-3.5 left-3 size-4 text-muted-foreground"
            />
            <label className="sr-only" htmlFor="history-search">
              Search conversations
            </label>
            <Input
              id="history-search"
              className="bg-background/50 pl-9 shadow-none"
              placeholder="Search conversations"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              type="search"
              maxLength={200}
            />
          </div>
          <p className="mb-2 px-2 text-xs font-medium text-muted-foreground">
            Conversations
          </p>
          <SidebarMenu aria-label="Conversation history">
            {loading &&
              [1, 2, 3, 4].map((key) => (
                <SidebarMenuItem key={key}>
                  <SidebarMenuSkeleton />
                </SidebarMenuItem>
              ))}
            {!loading && failed && (
              <li
                className="p-2 text-sm text-muted-foreground"
                aria-live="polite"
              >
                History could not load.
                <Button
                  variant="link"
                  onClick={() =>
                    preview
                      ? toast.info(
                          "Preview history error. Choose another state to restore fixture history.",
                        )
                      : void mutate()
                  }
                >
                  Try again
                </Button>
              </li>
            )}
            {!loading && !failed && chats.length === 0 && (
              <li className="px-2 py-4 text-sm leading-relaxed text-muted-foreground">
                {search
                  ? "No conversations match this search."
                  : "Your conversations will appear here."}
              </li>
            )}
            {chats.map((chat) => (
              <SidebarMenuItem key={chat.id}>
                <SidebarMenuButton
                  asChild
                  isActive={chat.id === activeId}
                  className="min-h-11 pr-12"
                >
                  {preview ? (
                    <button
                      type="button"
                      onClick={() => {
                        preview.onSelect(chat.id);
                        setOpenMobile(false);
                      }}
                      aria-current={chat.id === activeId ? "page" : undefined}
                    >
                      <span>{chat.title}</span>
                    </button>
                  ) : (
                    <Link
                      href={`/chat/${chat.id}`}
                      onClick={() => setOpenMobile(false)}
                      aria-current={chat.id === activeId ? "page" : undefined}
                      title={chat.title}
                    >
                      <span>{chat.title}</span>
                    </Link>
                  )}
                </SidebarMenuButton>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <SidebarMenuAction
                      className="top-0 right-0 size-11"
                      id={`history-actions-${chat.id}`}
                      aria-label={`Actions for ${chat.title}`}
                    >
                      <MoreHorizontal />
                    </SidebarMenuAction>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    side={isMobile ? "bottom" : "right"}
                    align="start"
                  >
                    <DropdownMenuItem
                      onSelect={() => {
                        rememberOpener(chat.id);
                        setEditing({ id: chat.id, title: chat.title });
                      }}
                    >
                      <Pencil />
                      Rename
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      variant="destructive"
                      onSelect={() => {
                        rememberOpener(chat.id);
                        setDeleting(chat.id);
                      }}
                    >
                      <Trash2 />
                      Delete conversation
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
          {!loading && hasMore && (
            <Button
              className="mt-3 w-full"
              variant="ghost"
              aria-busy={isValidating}
              disabled={isValidating}
              onClick={() =>
                preview
                  ? setPreviewCount((count) => count + 1)
                  : void setSize((size) => size + 1)
              }
            >
              {isValidating && (
                <Loader2 aria-hidden="true" className="animate-spin" />
              )}
              Load more conversations
            </Button>
          )}
        </SidebarGroupContent>
      </SidebarGroup>
      <Dialog
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open && !pending) setEditing(null);
        }}
      >
        <DialogContent onCloseAutoFocus={restoreFocus}>
          <DialogHeader>
            <DialogTitle>Rename conversation</DialogTitle>
            <DialogDescription>
              Choose a title you can find later.
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              void save("rename");
            }}
          >
            <label className="text-sm font-medium" htmlFor="conversation-title">
              Title
            </label>
            <Input
              id="conversation-title"
              autoComplete="off"
              maxLength={120}
              value={editing?.title ?? ""}
              onChange={(event) =>
                setEditing((item) =>
                  item ? { ...item, title: event.target.value } : item,
                )
              }
            />
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={pending}
                onClick={() => setEditing(null)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                aria-busy={pending}
                disabled={pending || !editing?.title.trim()}
              >
                <span
                  className="flex size-4 items-center justify-center"
                  aria-hidden="true"
                >
                  {pending && <Loader2 className="size-4 animate-spin" />}
                </span>
                Save title
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open && !pending) setDeleting(null);
        }}
      >
        <DialogContent onCloseAutoFocus={restoreFocus}>
          <DialogHeader>
            <DialogTitle>Delete conversation?</DialogTitle>
            <DialogDescription>
              This permanently removes the conversation and its messages. You
              cannot undo this.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={pending}
              onClick={() => setDeleting(null)}
              autoFocus
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              aria-busy={pending}
              disabled={pending}
              onClick={() => void save("delete")}
            >
              <span
                className="flex size-4 items-center justify-center"
                aria-hidden="true"
              >
                {pending && <Loader2 className="size-4 animate-spin" />}
              </span>
              Delete conversation
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function getPaginatedChatHistory(
  pageIndex: number,
  previousPageData: ChatHistory | null,
  query = "",
) {
  if (previousPageData?.hasMore === false) return null;
  const search = new URLSearchParams({ limit: "15" });
  if (query.trim()) search.set("q", query.trim());
  if (pageIndex > 0) {
    const last = previousPageData?.chats.at(-1);
    if (!last) return null;
    search.set("ending_before", last.id);
  }
  return `/api/history?${search.toString()}`;
}
