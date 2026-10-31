"use client";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { DEFAULT_MODEL_ID } from "@/lib/models";
import { errorCopy, needsKey } from "./api";
import { ByokDialog } from "./byok-dialog";
import { Composer } from "./composer";
import { ModelPicker } from "./model-picker";
import { useByokKey } from "./use-byok-key";

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
  const chat = useChat({ transport });
  const { stop } = chat;
  useEffect(
    () => () => {
      void stop();
    },
    [stop],
  );
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
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 p-4">
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
