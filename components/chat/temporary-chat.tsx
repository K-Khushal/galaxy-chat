"use client";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { RotateCcw } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { InlineAlert } from "@/components/ui/state";
import { DEFAULT_MODEL_ID } from "@/lib/models";
import { cn } from "@/lib/utils";
import { chatMessage, errorCopy, needsKey } from "./api";
import { ByokDialog } from "./byok-dialog";
import { COMPOSER_AREA } from "./chat-skeleton";
import { Composer } from "./composer";
import { Message } from "./message";
import { MessageList } from "./message-list";
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
  const empty = chat.messages.length === 0;
  return (
    // One tree for both states, so the composer keeps focus when the first
    // Message turns the New-Chat-style prompt into a Chat.
    <div
      className={cn(
        "flex min-h-0 flex-1 flex-col",
        empty && "items-center justify-center px-4",
      )}
    >
      {empty ? (
        <div className="w-full max-w-3xl">
          <h1 className="text-center text-display font-semibold">
            Temporary chat
          </h1>
          <p className="mt-1.5 mb-6 text-center text-sm text-muted-foreground">
            Not saved to history.
          </p>
          <div role="log" aria-label="Temporary Messages" />
        </div>
      ) : (
        <MessageList>
          <h1 className="sr-only">Temporary chat</h1>
          <div role="log" aria-label="Temporary Messages">
            {chat.messages.map((message, index) => (
              <Message
                key={message.id}
                message={chatMessage(
                  message,
                  undefined,
                  chat.messages[index - 1]?.id ?? null,
                  model,
                )}
                busy={busy}
                streaming={
                  busy &&
                  index === chat.messages.length - 1 &&
                  message.role === "assistant"
                }
                latest={index === chat.messages.length - 1}
                readOnly
                onEdit={() => false}
                onRegenerate={() => {}}
                onContinue={() => {}}
                onSwitch={() => {}}
              />
            ))}
          </div>
        </MessageList>
      )}
      <div className={cn(empty ? "w-full max-w-3xl pb-[8vh]" : COMPOSER_AREA)}>
        {!empty && (
          <div className="mb-2 flex justify-end">
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => {
                chat.setMessages([]);
                chat.clearError();
                setRevision((value) => value + 1);
              }}
            >
              <RotateCcw />
              New Temporary chat
            </Button>
          </div>
        )}
        {chat.error && (
          <InlineAlert
            className="mb-3"
            action={
              needsKey(chat.error) ? (
                <Button size="sm" onClick={() => setKeyOpen(true)}>
                  Add your OpenRouter key
                </Button>
              ) : undefined
            }
          >
            {errorCopy(chat.error)}
          </InlineAlert>
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
      </div>
      <ByokDialog
        open={keyOpen}
        onOpenChange={setKeyOpen}
        onSaved={() => setHasKey(true)}
      />
    </div>
  );
}
