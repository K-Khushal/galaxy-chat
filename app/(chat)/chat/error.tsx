"use client";
import { TriangleAlert } from "lucide-react";
import { ChatHeader } from "@/components/shell/chat-header";
import { Button } from "@/components/ui/button";
export default function ChatError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex h-dvh min-w-0 flex-col">
      <ChatHeader title="Conversation unavailable" />
      <div className="m-auto max-w-md px-6 py-12" role="alert">
        <TriangleAlert className="mb-5 size-8 text-muted-foreground" />
        <h1 className="text-2xl font-medium tracking-tight">
          We couldn’t open this conversation.
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          Your connection may have been interrupted. Try loading it again.
        </p>
        <p className="mt-3 break-all text-xs text-muted-foreground">
          Reference: {error.digest ?? "chat_failed"}
        </p>
        <Button className="mt-6" onClick={reset}>
          Try again
        </Button>
      </div>
    </div>
  );
}
