"use client";
import { ArrowUp, Paperclip, Square } from "lucide-react";
import { useRef, useState } from "react";
import { ModelSelector } from "@/components/chat/model-selector";
import { UsageNote } from "@/components/shell/usage-note";
import { Button } from "@/components/ui/button";
import type { ChatModel } from "@/lib/ai/model";
import type { AppUsage } from "@/lib/ai/usage";
import {
  type ChatAvailability,
  defaultAvailability,
} from "@/lib/ui/availability";
import { canSendMessage } from "@/lib/ui/composer";

export type ComposerProps = {
  status: "ready" | "submitted" | "streaming" | "error";
  stop: () => void;
  usage?: AppUsage;
  text: string;
  setText: (text: string) => void;
  model: string;
  setModel: (model: string) => void;
  models?: ChatModel[];
  availability?: ChatAvailability;
  onSend: (text: string) => Promise<void> | void;
};

export function ChatInput({
  onSend,
  status,
  stop,
  usage,
  text,
  setText,
  model,
  setModel,
  models,
  availability = defaultAvailability,
}: ComposerProps) {
  const composing = useRef(false);
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const busy = status === "streaming" || status === "submitted";
  const ready = availability.state === "ready" && Boolean(model);
  async function submit() {
    if (!ready || submitting || !canSendMessage(text, busy)) return;
    const draft = text.trim();
    setSubmitting(true);
    setText("");
    inputRef.current?.focus();
    try {
      await onSend(draft);
    } catch {
      if (!inputRef.current?.value) setText(draft);
    } finally {
      setSubmitting(false);
    }
  }
  return (
    <div className="w-full">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
        className="rounded-2xl border border-border bg-card p-2 shadow-sm focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/15"
      >
        <label className="sr-only" htmlFor="chat-composer">
          Message
        </label>
        <textarea
          id="chat-composer"
          ref={inputRef}
          rows={2}
          maxLength={32000}
          aria-describedby="composer-status"
          className="block max-h-48 min-h-20 w-full resize-y rounded-lg bg-transparent px-3 py-3 text-base leading-relaxed outline-none placeholder:text-muted-foreground md:text-sm"
          placeholder="Ask anything, or think out loud…"
          value={text}
          onChange={(event) => setText(event.target.value)}
          onCompositionStart={() => {
            composing.current = true;
          }}
          onCompositionEnd={() => {
            composing.current = false;
          }}
          onKeyDown={(event) => {
            if (
              event.key === "Enter" &&
              !event.shiftKey &&
              !event.nativeEvent.isComposing &&
              !composing.current
            ) {
              event.preventDefault();
              void submit();
            }
          }}
        />
        <div className="flex min-w-0 items-center gap-1">
          <Button
            type="button"
            size="icon"
            variant="ghost"
            disabled
            aria-label="Attachments unavailable"
            title="Attachments are not available yet"
          >
            <Paperclip className="size-4" />
          </Button>
          <div className="min-w-0 flex-1">
            <ModelSelector
              value={model}
              onValueChange={setModel}
              models={models}
              availability={availability}
            />
          </div>
          <Button
            type={busy ? "button" : "submit"}
            size="icon"
            className="rounded-xl"
            aria-label={busy ? "Stop response" : "Send message"}
            disabled={
              !busy && (submitting || !ready || !canSendMessage(text, false))
            }
            onClick={busy ? stop : undefined}
          >
            {busy ? (
              <Square className="size-3.5 fill-current" />
            ) : (
              <ArrowUp className="size-5" />
            )}
          </Button>
        </div>
      </form>
      <div className="flex min-h-10 flex-wrap items-center justify-between gap-x-4 gap-y-1 px-2 pt-2 text-xs text-muted-foreground">
        <p id="composer-status" className="min-w-0 flex-1 leading-relaxed">
          {availability.state === "unavailable"
            ? availability.reason
            : "Enter to send · Shift + Enter for a new line"}
        </p>
        <UsageNote totalTokens={usage?.totalTokens} />
      </div>
    </div>
  );
}
