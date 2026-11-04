"use client";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { DEFAULT_MODEL_ID } from "@/lib/models";
import { errorCopy, needsKey } from "./api";
import { ByokDialog } from "./byok-dialog";
import { Composer } from "./composer";
import { ModelPicker } from "./model-picker";
import { useByokKey } from "./use-byok-key";
import { creditsChanged } from "./use-credits";

/**
 * A Temporary Stop just closes the request, and the server refunds a credit
 * only once it notices; this is how long to wait before looking again.
 */
const STOP_SETTLE_MS = 1500;

/** Draft, history and streamed Replies live only in this page's memory. */
export function TemporaryChat() {
  const { hasKey, setHasKey } = useByokKey();
  const [keyOpen, setKeyOpen] = useState(false);
  const [revision, setRevision] = useState(0);
  const [model, setModel] = useState(DEFAULT_MODEL_ID);
  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/temporary/messages",
        prepareSendMessagesRequest: ({ messages, body }) => ({
          body: {
            model: body?.model,
            messages: messages.map((message) => ({
              role: message.role,
              content: message.parts
                .filter((part) => part.type === "text")
                .map((part) => part.text)
                .join(""),
            })),
          },
        }),
      }),
    [],
  );
  // Cleared on unmount; a later page fetches Credits fresh anyway.
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);
  const chat = useChat({
    transport,
    // A finished stream is already settled: the server spends or refunds
    // before closing it. A Stop or dropped connection settles a moment later.
    onFinish: ({ isAbort, isDisconnect }) => {
      if (!mounted.current) return;
      creditsChanged();
      if (isAbort || isDisconnect) {
        if (settleTimer.current) clearTimeout(settleTimer.current);
        settleTimer.current = setTimeout(creditsChanged, STOP_SETTLE_MS);
      }
    },
  });
  const { stop } = chat;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (settleTimer.current) clearTimeout(settleTimer.current);
      void stop();
    };
  }, [stop]);
  const busy = chat.status === "submitted" || chat.status === "streaming";
  async function send(text: string) {
    if (busy) return false;
    await chat.sendMessage(
      {
        text,
        messageId:
          chat.messages.at(-1)?.role === "user"
            ? chat.messages.at(-1)?.id
            : undefined,
      },
      { body: { model } },
    );
    return true;
  }
  return (
    <div className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col gap-4 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
      <h1 className="sr-only">Temporary chat</h1>
      <p className="text-center text-sm text-muted-foreground">
        Temporary chat · Never saved · Uses Credits or your BYOK key
      </p>
      <div
        className="min-h-0 flex-1 overflow-y-auto"
        role="log"
        aria-label="Temporary Messages"
      >
        {chat.messages.map((message) => (
          <div
            key={message.id}
            className="mb-4 whitespace-pre-wrap break-words"
          >
            <p className="text-sm text-muted-foreground">
              {message.role === "user" ? "You" : "Galaxy"}
            </p>
            {message.parts
              .filter((part) => part.type === "text")
              .map((part) => part.text)
              .join("")}
          </div>
        ))}
      </div>
      {chat.error && <p role="alert">{errorCopy(chat.error)}</p>}
      <Button
        variant="outline"
        disabled={busy}
        onClick={() => {
          chat.setMessages([]);
          chat.clearError();
          setRevision((value) => value + 1);
        }}
      >
        New Temporary chat
      </Button>
      {chat.error && needsKey(chat.error) && (
        <Button variant="link" onClick={() => setKeyOpen(true)}>
          Add your OpenRouter key
        </Button>
      )}
      <Composer
        key={revision}
        chatId="temporary"
        persistDraft={false}
        busy={busy}
        onSend={send}
        onStop={() => void stop()}
        model={model}
        picker={
          <ModelPicker
            model={model}
            onChange={setModel}
            disabled={busy}
            hasKey={hasKey}
            addKey={() => setKeyOpen(true)}
          />
        }
      />
      <ByokDialog
        open={keyOpen}
        onOpenChange={setKeyOpen}
        onSaved={() => setHasKey(true)}
      />
    </div>
  );
}
