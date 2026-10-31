"use client";
import { useState } from "react";
import { Textarea } from "@/components/ui/textarea";
/** Deliberately page memory only, including the draft. M3 has no Temporary Generation API. */
export function TemporaryChat() {
  const [draft, setDraft] = useState("");
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center gap-4 p-4">
      <p className="text-center text-sm text-muted-foreground">
        Temporary chat · Never saved
      </p>
      <h1 className="text-center text-2xl font-medium">
        Temporary chats aren’t ready yet
      </h1>
      <p className="text-center text-sm text-muted-foreground">
        You can draft a Message here, but sending is unavailable. Temporary
        chats will still spend Credits when sending is available.
      </p>
      <Textarea
        aria-label="Temporary Message draft"
        placeholder="Draft a Message"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
      />
    </div>
  );
}
