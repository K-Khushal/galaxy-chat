"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { Button } from "@/components/ui/button";

function generateConversationId(): string {
  // In a real app this should come from the backend. For now, a simple client id.
  return Math.random().toString(36).slice(2, 10);
}

export function StartConversationButton() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);

  const handleStart = useCallback(() => {
    try {
      setIsLoading(true);
      const id = generateConversationId();
      router.push(`/chat/${id}`);
    } finally {
      setIsLoading(false);
    }
  }, [router]);

  return (
    <Button onClick={handleStart} disabled={isLoading}>
      {isLoading ? "Starting..." : "Start a conversation"}
    </Button>
  );
}
