"use client";
import { Archive, MoreHorizontal, Pencil, Pin, Trash } from "lucide-react";
import { LayoutGroup, motion, useReducedMotion } from "motion/react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
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
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  SidebarMenu,
  SidebarMenuButton,
  useSidebar,
} from "@/components/ui/sidebar";
import { chatGroup, sortedChats } from "@/lib/chat/groups";
import type { ChatSummary } from "@/lib/chat/store";
import { api } from "./api";
export function RecentChats() {
  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<string>();
  const [title, setTitle] = useState("");
  const [deleting, setDeleting] = useState<ChatSummary>();
  const [pending, setPending] = useState<string>();
  const mutating = useRef(false);
  const pathname = usePathname();
  const router = useRouter();
  const { isMobile, setOpenMobile } = useSidebar();
  const reduced = useReducedMotion();
  useEffect(() => {
    let active = true;
    const load = () => {
      if (mutating.current) return;
      void api<{ chats: ChatSummary[] }>("/api/chats")
        .then((data) => {
          if (active && !mutating.current) {
            setChats(data.chats);
            setError("");
          }
        })
        .catch(() => {
          if (active) setError("Could not load chats. Refresh to try again.");
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
        ? rows
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
        <p role="alert" className="px-2 text-sm text-destructive">
          {error}
        </p>
      )}
      <LayoutGroup>
        <SidebarMenu>
          {sortedChats(chats).map((chat) => {
            const group = chatGroup(chat);
            const heading = group !== previous;
            previous = group;
            return (
              <motion.li
                layout={!reduced}
                transition={{ duration: reduced ? 0 : 0.18 }}
                key={chat.id}
                className="list-none"
              >
                {heading && (
                  <h3 className="px-2 pt-4 pb-1 text-xs text-muted-foreground">
                    {group}
                  </h3>
                )}
                <div className="flex items-center">
                  {editing === chat.id ? (
                    <form
                      className="min-w-0 flex-1"
                      onSubmit={(event) => {
                        event.preventDefault();
                        if (title.trim()) {
                          setEditing(undefined);
                          void mutate(chat, { title: title.trim() });
                        }
                      }}
                    >
                      <Input
                        aria-label="Chat title"
                        autoFocus
                        maxLength={200}
                        value={title}
                        onChange={(event) => setTitle(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Escape") setEditing(undefined);
                        }}
                        onBlur={() => setEditing(undefined)}
                      />
                    </form>
                  ) : (
                    <SidebarMenuButton
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
                          size="icon"
                          disabled={!!pending}
                          aria-label={`Actions for ${chat.title ?? "New chat"}`}
                        />
                      }
                    >
                      <MoreHorizontal className="size-4" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent>
                      <DropdownMenuItem
                        onClick={() => {
                          setEditing(chat.id);
                          setTitle(chat.title ?? "");
                        }}
                      >
                        <Pencil />
                        Rename
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() =>
                          void mutate(chat, { pinned: !chat.pinned })
                        }
                      >
                        <Pin />
                        {chat.pinned ? "Unpin" : "Pin"}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => void mutate(chat, { archived: true })}
                      >
                        <Archive />
                        Archive
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => setDeleting(chat)}>
                        <Trash />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </motion.li>
            );
          })}
        </SidebarMenu>
      </LayoutGroup>
      {!chats.length && !error && (
        <p className="px-2 py-1.5 text-sm text-muted-foreground">
          Your chats will appear here.
        </p>
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
