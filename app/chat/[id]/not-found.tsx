"use client";
import { SearchX } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/state";

// Rendered inside the shell, so the sidebar stays. A button rather than a link
// named "New chat" keeps the sidebar's link the only one.
export default function ChatNotFound() {
  const router = useRouter();
  return (
    <div className="flex flex-1 items-center justify-center pb-[8vh]">
      <EmptyState
        size="page"
        icon={<SearchX />}
        title="Chat not found"
        description="It may have been deleted."
        action={
          <Button variant="outline" onClick={() => router.push("/chat")}>
            Start a new Chat
          </Button>
        }
      />
    </div>
  );
}
