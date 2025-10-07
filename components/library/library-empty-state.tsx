"use client";

import { Button } from "@/components/ui/button";
import { Image, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";

export function LibraryEmptyState() {
  const router = useRouter();

  return (
    <div className="flex flex-col items-center justify-center h-full min-h-[400px] px-4">
      <div className="relative mb-8">
        <div className="w-24 h-24 rounded-full bg-muted flex items-center justify-center">
          <Image className="w-12 h-12 text-muted-foreground" />
        </div>
      </div>

      <div className="text-center max-w-md">
        <h2 className="text-2xl font-semibold mb-2">No media generated yet</h2>
        <p className="text-muted-foreground mb-6">
          Start a conversation with the assistant and ask it to generate images,
          and they'll appear here in a beautiful gallery.
        </p>

        <Button
          onClick={() => router.push("/chat")}
          className="gap-2 cursor-pointer"
        >
          <Sparkles className="w-4 h-4" />
          Start a new chat
        </Button>
      </div>
    </div>
  );
}
