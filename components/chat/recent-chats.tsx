"use client";
import {
  Archive,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
  Trash2,
} from "lucide-react";
import { LazyMotion, m } from "motion/react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  SidebarMenu,
  SidebarMenuButton,
  useSidebar,
} from "@/components/ui/sidebar";
import { SkeletonText } from "@/components/ui/skeleton";
import { EmptyState, InlineAlert } from "@/components/ui/state";
import { chatGroup, sortedChats } from "@/lib/chat/groups";
import type { ChatSummary } from "@/lib/chat/store";
import { spring } from "@/lib/motion";
import { api } from "./api";
export function RecentChats() {
  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<string>();
  const [title, setTitle] = useState("");
  const [deleting, setDeleting] = useState<ChatSummary>();
  const [pending, setPending] = useState<string>();
  const mutating = useRef(false);
  const cancelledRename = useRef(false);
  const pathname = usePathname();
  const router = useRouter();
  const { isMobile, setOpenMobile } = useSidebar();

  useEffect(() => {
    let active = true;
    const load = () => {
      if (mutating.current) return;
      void api<{ chats: ChatSummary[] }>("/api/chats")
        .then((data) => {
          if (active && !mutating.current) {
            setChats(data.chats);
            setLoaded(true);
            setError("");
          }
        })
        .catch(() => {
          if (active) setError("Couldn't load your Chats.");
        });
    };
    load();
    window.addEventListener("galaxy:chats", load);
    return () => {
      active = false;
      window.removeEventListener("galaxy:chats", load);
    };
  }, []);
  async function mutate(chat: ChatSummary, patch?: Partial<ChatSummary>) {
    if (mutating.current) return;
    mutating.current = true;
    setPending(chat.id);
    setError("");
    setChats((rows) =>
      patch
        ? (rows.some((row) => row.id === chat.id) ? rows : [...rows, chat])
            .map((row) =>
              row.id === chat.id
                ? { ...row, ...patch, updatedAt: new Date().toISOString() }
                : row,
            )
            .filter((row) => !row.archived)
        : rows.filter((row) => row.id !== chat.id),
    );
    try {
      await api(
        `/api/chats/${chat.id}`,
        patch ?? {},
        patch ? "PATCH" : "DELETE",
      );
      if (patch?.archived)
        toast("Chat archived.", {
          action: {
            label: "Undo",
            onClick: () => void mutate(chat, { archived: false }),
          },
        });
      if ((!patch || patch.archived) && pathname === `/chat/${chat.id}`)
        router.push("/chat");
    } catch {
      setChats((rows) => [...rows.filter((row) => row.id !== chat.id), chat]);
      setError("Could not update this Chat. Try again.");
    } finally {
      mutating.current = false;
      setPending(undefined);
    }
  }
  let previous = "";
  return (
    <>
      {error && (
        <InlineAlert
          tone="error"
          action={
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setError("");
                window.dispatchEvent(new Event("galaxy:chats"));
              }}
            >
              Try again
            </Button>
          }
        >
          {error}
        </InlineAlert>
      )}
      <LazyMotion
        features={() => import("./motion-features").then((f) => f.default)}
      >
        <SidebarMenu>
          {sortedChats(chats).map((chat) => {
            const group = chatGroup(chat);
            const heading = group !== previous;
            previous = group;
            return (
              <m.li
                layout
                transition={spring.moderate}
                key={chat.id}
                className="list-none"
              >
                {heading && (
                  <h3 className="px-2 pt-4 pb-1 text-xs font-medium text-muted-foreground">
                    {group}
                  </h3>
                )}
                <div
                  className="group/row relative flex items-center"
                  data-active={pathname === `/chat/${chat.id}`}
                  data-pending={pending === chat.id}
                >
                  {editing === chat.id ? (
                    <form
                      className="min-w-0 flex-1"
                      onSubmit={(event) => {
                        event.preventDefault();
                        if (!cancelledRename.current && title.trim()) {
                          cancelledRename.current = true;
                          setEditing(undefined);
                          void mutate(chat, { title: title.trim() });
                        }
                      }}
                    >
                      <Input
                        className="h-8 text-sm"
                        aria-label="Chat title"
                        autoFocus
                        maxLength={200}
                        value={title}
                        onChange={(event) => setTitle(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Escape") {
                            cancelledRename.current = true;
                            setEditing(undefined);
                          }
                        }}
                        onBlur={() => {
                          setEditing(undefined);
                          if (
                            !cancelledRename.current &&
                            title.trim() &&
                            title.trim() !== chat.title
                          )
                            void mutate(chat, { title: title.trim() });
                        }}
                      />
                    </form>
                  ) : (
                    <SidebarMenuButton
                      className="h-8 pr-9 group-data-[pending=true]/row:opacity-60"
                      isActive={pathname === `/chat/${chat.id}`}
                      render={<Link href={`/chat/${chat.id}`} />}
                      onClick={() => {
                        if (isMobile) setOpenMobile(false);
                      }}
                    >
                      <span className="truncate">
                        {chat.title ?? "New chat"}
                      </span>
                    </SidebarMenuButton>
                  )}
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      render={
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          className="absolute right-0 pointer-fine:size-7 pointer-fine:opacity-0 pointer-fine:group-hover/row:opacity-100 pointer-fine:group-focus-within/row:opacity-100 pointer-fine:group-data-[active=true]/row:opacity-100 pointer-fine:data-popup-open:opacity-100 enabled:active:scale-100"
                          disabled={!!pending}
                          aria-label={`Actions for ${chat.title ?? "New chat"}`}
                        />
                      }
                    >
                      <MoreHorizontal className="size-4" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent>
                      <DropdownMenuItem
                        disabled={!!pending}
                        onClick={() => {
                          cancelledRename.current = false;
                          setEditing(chat.id);
                          setTitle(chat.title ?? "");
                        }}
                      >
                        <Pencil />
                        Rename
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        disabled={!!pending}
                        onClick={() =>
                          void mutate(chat, { pinned: !chat.pinned })
                        }
                      >
                        {chat.pinned ? <PinOff /> : <Pin />}
                        {chat.pinned ? "Unpin" : "Pin"}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        disabled={!!pending}
                        onClick={() => void mutate(chat, { archived: true })}
                      >
                        <Archive />
                        Archive
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        variant="destructive"
                        disabled={!!pending}
                        onClick={() => setDeleting(chat)}
                      >
                        <Trash2 />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </m.li>
            );
          })}
        </SidebarMenu>
      </LazyMotion>
      {chats.length === 500 && (
        <p className="px-2 text-xs text-muted-foreground">
          Showing 500 Chats. Search to find older Chats.
        </p>
      )}
      {!loaded && !error && (
        <div aria-hidden="true">
          {["70%", "55%", "62%", "48%", "66%", "52%"].map((width) => (
            <div key={width} className="flex h-8 items-center px-2 text-sm">
              <SkeletonText lines={1} widths={[width]} className="w-full" />
            </div>
          ))}
        </div>
      )}
      {loaded && !chats.length && !error && (
        <EmptyState size="inline" title="No chats yet" />
      )}

      <AlertDialog
        open={!!deleting}
        onOpenChange={(open) => {
          if (!open) setDeleting(undefined);
        }}
      >
        <AlertDialogContent>
          <AlertDialogTitle>Delete this Chat?</AlertDialogTitle>
          <AlertDialogDescription>
            This permanently deletes the Chat and its Messages.
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (deleting) void mutate(deleting);
                setDeleting(undefined);
              }}
            >
              Delete Chat
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
