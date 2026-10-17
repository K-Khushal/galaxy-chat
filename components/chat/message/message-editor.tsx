"use client";
import { Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { getTextMessage } from "@/lib/ai/utils";
import type { TypeUIMessage } from "@/lib/types";
export function MessageEditor({
  message,
  setMode,
  onSubmit,
}: {
  message: TypeUIMessage;
  setMode: (mode: string) => void;
  onSubmit: (text: string) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState(getTextMessage(message));
  const [pending, setPending] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    input.current?.focus();
  }, []);
  function close() {
    setMode("read");
    requestAnimationFrame(() =>
      document.getElementById(`edit-action-${message.id}`)?.focus(),
    );
  }
  async function submit() {
    if (pending || !draft.trim()) return;
    setPending(true);
    try {
      if (!(await onSubmit(draft.trim()))) return;
      document.getElementById("chat-composer")?.focus();
      setMode("read");
    } finally {
      setPending(false);
    }
  }
  return (
    <div className="rounded-xl border border-border bg-secondary p-4">
      <label
        htmlFor={`edit-${message.id}`}
        className="mb-2 block text-sm font-medium"
      >
        Edit in a new branch
      </label>
      <textarea
        id={`edit-${message.id}`}
        ref={input}
        value={draft}
        maxLength={2000}
        rows={4}
        className="w-full resize-y rounded-lg bg-background p-3 text-base focus-visible:outline-ring"
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") close();
        }}
      />
      <p className="mt-2 text-xs text-muted-foreground">
        The original conversation stays available in the branch selector.
      </p>
      <div className="mt-3 flex justify-end gap-2">
        <Button variant="outline" disabled={pending} onClick={close}>
          Cancel
        </Button>
        <Button
          aria-busy={pending}
          disabled={pending || !draft.trim()}
          onClick={() => void submit()}
        >
          {pending && (
            <Loader2 aria-hidden="true" className="size-4 animate-spin" />
          )}
          Send as new branch
        </Button>
      </div>
    </div>
  );
}
