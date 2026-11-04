"use client";
import { Pencil, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ReplyMarkdown } from "@/components/elements/reply-markdown";
import { Button } from "@/components/ui/button";
import { InlineAlert } from "@/components/ui/state";
import type { ChatMessage } from "@/lib/chat/store";
import { cn } from "@/lib/utils";
import { textOf } from "./api";
import { attachmentParts, MessageAttachments } from "./message-attachments";
import { Reasoning } from "./reasoning";
import { ActionButton, ReplyActions } from "./reply-actions";
import { VersionSwitcher } from "./version-switcher";

const FAILED_COPY = {
  byok: "Something went wrong before Galaxy could reply. No Credits were used; check OpenRouter for any provider charges.",
  credits:
    "Something went wrong before Galaxy could reply. You weren’t charged.",
};

export function Message({
  message,
  busy,
  streaming,
  latest = false,
  readOnly = false,
  onEdit,
  onRegenerate,
  onContinue,
  onSwitch,
}: {
  message: ChatMessage;
  busy: boolean;
  streaming: boolean;
  /** The last Message of the Chat: its action bar stays visible on a fine pointer. */
  latest?: boolean;
  /** A Temporary chat: Copy and Reply info only. */
  readOnly?: boolean;
  onEdit: (text: string) => boolean | Promise<boolean>;
  onRegenerate: () => void;
  onContinue: () => void;
  onSwitch: (id: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(textOf(message));
  const buttonRef = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef(false);
  function closeEdit() {
    restoreFocus.current = true;
    setEditing(false);
  }
  const editRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (editing) editRef.current?.focus();
    else if (restoreFocus.current) {
      buttonRef.current?.focus();
      restoreFocus.current = false;
    }
  }, [editing]);
  const user = message.role === "user";
  const body = textOf(message);
  // A Message of only files has no bubble to show.
  const filesOnly = user && !body && attachmentParts(message.parts).length > 0;
  const files = user ? <MessageAttachments parts={message.parts} /> : null;
  const reasoning = message.parts
    .filter((p) => p.type === "reasoning")
    .map((p) => p.text)
    .join("\n");
  // Nothing to read yet: show that the Reply is on its way.
  const pending = streaming && !user && !body && !reasoning;
  const showBar = !(readOnly && user);
  return (
    <article
      aria-label={user ? "Your Message" : "Reply"}
      className={cn(
        "group min-w-0 py-3 transition-[opacity,translate] duration-240 ease-out starting:opacity-0 motion-safe:starting:translate-y-1",
        user && "flex flex-col items-end",
      )}
    >
      {files}
      {editing ? (
        <form
          className="grid w-full gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (text.trim()) {
              const result = onEdit(text.trim());
              if (typeof result !== "boolean")
                void result.then((ok) => {
                  if (ok) closeEdit();
                });
              else if (result) closeEdit();
            }
          }}
        >
          <label className="sr-only" htmlFor={`edit-${message.id}`}>
            Edit Message
          </label>
          <textarea
            ref={editRef}
            id={`edit-${message.id}`}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") closeEdit();
            }}
            className="min-h-28 w-full rounded-[1.25rem] border border-input bg-card p-3 text-message outline-none transition-[border-color,box-shadow] duration-160 ease-out focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          />
          <div className="flex justify-end gap-2">
            <Button type="button" size="sm" variant="ghost" onClick={closeEdit}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={!text.trim() || busy}>
              Save and send
            </Button>
          </div>
        </form>
      ) : filesOnly ? null : (
        <div
          className={
            user
              ? "max-w-[85%] rounded-[1.25rem] bg-user-bubble px-4 py-2.5 text-message text-user-bubble-foreground whitespace-pre-wrap break-words"
              : "w-full text-message"
          }
        >
          {reasoning && (
            <Reasoning
              text={reasoning}
              thinking={
                streaming &&
                message.parts.some(
                  (p) => p.type === "reasoning" && p.state === "streaming",
                )
              }
            />
          )}
          {user ? (
            body
          ) : pending ? (
            <span className="text-shimmer text-sm">Thinking</span>
          ) : (
            <ReplyMarkdown isAnimating={streaming}>{body}</ReplyMarkdown>
          )}
          {streaming && body && (
            <span
              className="ml-1 inline-block size-2 rounded-full bg-muted-foreground align-middle motion-safe:animate-pulse"
              aria-hidden="true"
            />
          )}
        </div>
      )}
      {!streaming && !user && message.status === "failed" && (
        <InlineAlert
          className="mt-2"
          action={
            readOnly ? undefined : (
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={onRegenerate}
              >
                Regenerate
              </Button>
            )
          }
        >
          {message.payment === "byok" ? FAILED_COPY.byok : FAILED_COPY.credits}
        </InlineAlert>
      )}
      {!streaming && !user && message.status === "interrupted" && (
        <InlineAlert
          tone="warning"
          className="mt-2"
          action={
            readOnly ? undefined : (
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={onContinue}
              >
                Continue
              </Button>
            )
          }
        >
          Interrupted
        </InlineAlert>
      )}
      {!streaming && !user && message.status === "stopped" && (
        <p className="mt-2 flex items-center gap-1.5 text-caption text-muted-foreground">
          <Square className="size-3 fill-current" aria-hidden="true" />
          Stopped
        </p>
      )}
      {showBar && (
        <div
          className={cn(
            "mt-1 flex h-8 items-center gap-0.5 transition-opacity duration-80",
            user && "justify-end",
            // Touch has no hover, so every bar shows there; with a fine pointer
            // only the last Reply's does until its row is hovered or focused.
            !(latest && !user) &&
              "pointer-fine:opacity-0 pointer-fine:group-focus-within:opacity-100 pointer-fine:group-hover:opacity-100",
          )}
        >
          {streaming ? null : (
            <>
              {user ? (
                <ActionButton
                  ref={buttonRef}
                  label="Edit Message"
                  className="aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
                  aria-disabled={busy}
                  onClick={() => {
                    if (busy) return;
                    setText(body);
                    setEditing(true);
                  }}
                >
                  <Pencil />
                </ActionButton>
              ) : (
                <ReplyActions
                  message={message}
                  disabled={busy}
                  readOnly={readOnly}
                  onRegenerate={onRegenerate}
                />
              )}
              {!readOnly && (
                <VersionSwitcher
                  versions={message.versions}
                  disabled={busy}
                  onSwitch={onSwitch}
                />
              )}
            </>
          )}
        </div>
      )}
    </article>
  );
}
