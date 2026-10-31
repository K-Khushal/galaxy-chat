"use client";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { api } from "@/components/chat/api";
import {
  CommandDialog,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
export function SearchDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const { resolvedTheme, setTheme } = useTheme();
  const [query, setQuery] = useState("");
  const [chats, setChats] = useState<{ id: string; title: string | null }[]>(
    [],
  );
  const [status, setStatus] = useState("");
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        onOpenChange(!open);
      }
    };
    document.addEventListener("keydown", listener);
    return () => document.removeEventListener("keydown", listener);
  }, [open, onOpenChange]);
  useEffect(() => {
    if (!open) {
      setQuery("");
      return;
    }
    let active = true;
    setChats([]);
    setStatus(query.trim() ? "Searching…" : "");
    const timer = setTimeout(() => {
      if (!query.trim()) return;
      api<{ chats: typeof chats }>(
        `/api/chats/search?q=${encodeURIComponent(query)}`,
      )
        .then((data) => {
          if (active) {
            setChats(data.chats);
            setStatus(data.chats.length ? "" : "No chats found.");
          }
        })
        .catch(() => {
          if (active) setStatus("Could not search chats. Try again.");
        });
    }, 250);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [query, open]);
  function navigate(path: string) {
    onOpenChange(false);
    router.push(path);
  }
  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Search chats"
      description="Search Chat titles and Messages, or choose an action."
      shouldFilter={false}
    >
      <CommandInput
        value={query}
        onValueChange={setQuery}
        placeholder="Search chats or choose an action"
        maxLength={200}
      />
      <CommandList>
        {status && (
          <output className="p-3 text-sm text-muted-foreground">
            {status}
          </output>
        )}
        <CommandGroup heading="Chats">
          {chats.map((chat) => (
            <CommandItem
              key={chat.id}
              value={chat.id}
              onSelect={() => navigate(`/chat/${chat.id}`)}
            >
              {chat.title ?? "New chat"}
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandGroup heading="Actions">
          <CommandItem onSelect={() => navigate("/chat")}>New chat</CommandItem>
          <CommandItem onSelect={() => navigate("/chat/temporary")}>
            New Temporary chat
          </CommandItem>
          <CommandItem
            onSelect={() => {
              setTheme(resolvedTheme === "dark" ? "light" : "dark");
              onOpenChange(false);
            }}
          >
            Toggle theme
          </CommandItem>
          <CommandItem onSelect={() => navigate("/chat/settings")}>
            Open Settings
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
