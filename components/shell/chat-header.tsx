"use client";
import { LockKeyhole, SquarePen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SidebarTrigger } from "@/components/ui/sidebar";

export function ChatHeader({
  title = "New conversation",
  onNewChat,
}: {
  title?: string;
  onNewChat?: () => void;
}) {
  return (
    <header className="flex h-[calc(4rem+env(safe-area-inset-top))] shrink-0 items-center gap-3 border-b border-border/60 px-3 pt-[env(safe-area-inset-top)] md:px-6">
      <SidebarTrigger className="md:hidden" />
      <span
        className="min-w-0 flex-1 truncate text-sm font-medium"
        title={title}
      >
        {title}
      </span>
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <LockKeyhole aria-hidden="true" className="size-3.5" />
        <span className="hidden sm:inline">Private conversation</span>
      </span>
      {onNewChat && (
        <Button
          variant="ghost"
          size="icon"
          aria-label="New conversation"
          onClick={onNewChat}
          className="md:hidden"
        >
          <SquarePen />
        </Button>
      )}
    </header>
  );
}
