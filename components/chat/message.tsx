"use client";
import { Pencil } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { Response } from "@/components/elements/response";
import { Button } from "@/components/ui/button";
import type { ChatMessage } from "@/lib/chat/store";
import { textOf } from "./api";
import { Reasoning } from "./reasoning";
import { ReplyActions } from "./reply-actions";
import { VersionSwitcher } from "./version-switcher";
export function Message({
  message,
  busy,
  streaming,
  onEdit,
  onRegenerate,
  onContinue,
  onSwitch,
}: {
  message: ChatMessage;
  busy: boolean;
  streaming: boolean;
  onEdit: (text: string) => boolean | Promise<boolean>;
  onRegenerate: () => void;
  onContinue: () => void;
  onSwitch: (id: string) => void;
}) {
  const reduced = useReducedMotion();
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
  const reasoning = message.parts
    .filter((p) => p.type === "reasoning")
    .map((p) => p.text)
    .join("\n");
  return (
    <motion.article
      aria-label={user ? "Your Message" : "Reply"}
      className={`group min-w-0 py-4 ${user ? "flex flex-col items-end" : ""}`}
      initial={reduced ? false : { opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: reduced ? 0 : 0.18 }}
    >
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
            className="min-h-28 rounded-xl border bg-card p-3 text-message outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={closeEdit}>
              Cancel
            </Button>
            <Button type="submit" disabled={!text.trim() || busy}>
              Save and send
            </Button>
          </div>
        </form>
      ) : (
        <div
          className={
            user
              ? "max-w-[85%] whitespace-pre-wrap break-words rounded-3xl bg-user-bubble px-4 py-2.5 text-message text-user-bubble-foreground"
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
            textOf(message)
          ) : (
            <Response isAnimating={streaming}>{textOf(message)}</Response>
          )}
          {streaming && (
            <span
              className="inline-block size-1.5 rounded-full bg-muted-foreground motion-safe:animate-pulse"
              aria-hidden="true"
            />
          )}
        </div>
      )}
      {!streaming && message.status !== "complete" && !user && (
        <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
          <span>
            {message.status === "failed"
              ? message.payment === "byok"
                ? "Something went wrong before Galaxy could reply. No Credits were used; check OpenRouter for any provider charges."
                : "Something went wrong before Galaxy could reply. You weren’t charged."
              : message.status === "stopped"
                ? "Stopped"
                : "Interrupted"}
          </span>
          {message.status === "interrupted" && (
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={onContinue}
            >
              Continue
            </Button>
          )}
        </div>
      )}
      <div className="mt-1 flex min-h-8 items-center gap-0.5 opacity-100 transition-opacity duration-150 pointer-fine:opacity-0 pointer-fine:group-hover:opacity-100 pointer-fine:group-focus-within:opacity-100">
        {user ? (
          <Button
            variant="ghost"
            size="icon-sm"
            ref={buttonRef}
            aria-label="Edit Message"
            aria-disabled={busy}
            onClick={() => {
              if (busy) return;
              setText(textOf(message));
              setEditing(true);
            }}
          >
            <Pencil />
          </Button>
        ) : (
          <ReplyActions
            message={message}
            disabled={busy}
            onRegenerate={onRegenerate}
          />
        )}
        <VersionSwitcher
          versions={message.versions}
          disabled={busy}
          onSwitch={onSwitch}
        />
      </div>
    </motion.article>
  );
}
