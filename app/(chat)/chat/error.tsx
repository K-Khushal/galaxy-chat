"use client";

import { Button } from "@/components/ui/button";

export default function ChatError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex h-screen flex-col items-center justify-center gap-4">
      <h2>Something went wrong</h2>
      <p>Error ID: {error.digest ?? "chat_failed"}</p>
      <Button className="cursor-pointer" onClick={() => reset()} type="button">
        Try again
      </Button>
    </div>
  );
}
