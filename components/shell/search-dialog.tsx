"use client";
import {
  MessageCircleDashed,
  MessageSquare,
  Monitor,
  Moon,
  Settings,
  SquarePen,
  Sun,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { api } from "@/components/chat/api";
import { Button } from "@/components/ui/button";
import {
  CommandDialog,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Kbd } from "@/components/ui/kbd";
import { SkeletonText } from "@/components/ui/skeleton";
import { EmptyState, InlineAlert } from "@/components/ui/state";

export function SearchDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const { setTheme } = useTheme();
  const [query, setQuery] = useState("");
  const [chats, setChats] = useState<{ id: string; title: string | null }[]>(
    [],
  );
  const [status, setStatus] = useState<"loading" | "ready" | "error">("ready");
  const [retry, setRetry] = useState(0);
  // Retry intentionally restarts the same query.
  // biome-ignore lint/correctness/useExhaustiveDependencies: retry restarts a failed request
  useEffect(() => {
    if (!open) {
      setQuery("");
      return;
    }
    let active = true;
    setChats([]);
    setStatus(query.trim() ? "loading" : "ready");
    const timer = setTimeout(() => {
      if (!query.trim()) return;
      api<{ chats: typeof chats }>(
        `/api/chats/search?q=${encodeURIComponent(query)}`,
      )
        .then((data) => {
          if (active) {
            setChats(data.chats);
            setStatus("ready");
          }
        })
        .catch(() => {
          if (active) setStatus("error");
        });
    }, 250);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [query, open, retry]);
  function navigate(path: string) {
    onOpenChange(false);
    router.push(path);
  }
  const actions = [
    {
      label: "New chat",
      icon: SquarePen,
      action: () => navigate("/chat"),
      hint: "",
    },
    {
      label: "New Temporary chat",
      icon: MessageCircleDashed,
      action: () => navigate("/chat/temporary"),
      hint: "",
    },
    {
      label: "Open Settings",
      icon: Settings,
      action: () => navigate("/chat/settings"),
      hint: "⌘,",
    },
    ...(["system", "light", "dark"] as const).map((theme) => ({
      label: `Theme: ${theme[0]?.toUpperCase()}${theme.slice(1)}`,
      icon: theme === "system" ? Monitor : theme === "light" ? Sun : Moon,
      hint: "",
      action: () => {
        setTheme(theme);
        onOpenChange(false);
      },
    })),
  ].filter(({ label }) =>
    label.toLowerCase().includes(query.trim().toLowerCase()),
  );
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
        placeholder="Search chats"
        maxLength={200}
      />
      <CommandList>
        {query.trim() && status === "loading" && (
          <output aria-label="Searching chats">
            {["70%", "55%", "62%"].map((width) => (
              <div key={width} className="flex h-9 items-center px-2 text-sm">
                <SkeletonText lines={1} widths={[width]} className="w-full" />
              </div>
            ))}
          </output>
        )}
        {query.trim() && status === "error" && (
          <InlineAlert
            action={
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setRetry((n) => n + 1)}
              >
                Try again
              </Button>
            }
          >
            Couldn't search your Chats.
          </InlineAlert>
        )}
        {!!chats.length && status === "ready" && (
          <CommandGroup heading="Chats">
            {chats.map((chat) => (
              <CommandItem
                key={chat.id}
                value={chat.id}
                onSelect={() => navigate(`/chat/${chat.id}`)}
              >
                <MessageSquare />
                {chat.title ?? "New chat"}
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {!!actions.length && (
          <CommandGroup heading="Actions">
            {actions.map(({ label, icon: Icon, action, hint }) => (
              <CommandItem key={label} value={label} onSelect={action}>
                <Icon />
                {label}
                {hint && <Kbd className="ml-auto">{hint}</Kbd>}
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {query.trim() &&
          status === "ready" &&
          !chats.length &&
          !actions.length && (
            <EmptyState size="inline" title="No chats found" />
          )}
      </CommandList>
    </CommandDialog>
  );
}
