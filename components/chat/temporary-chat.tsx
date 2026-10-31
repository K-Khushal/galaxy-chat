"use client";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { DEFAULT_MODEL_ID } from "@/lib/models";
import { errorCopy } from "./api";
import { ModelPicker } from "./model-picker";

/** Draft, history and streamed Replies live only in this page's memory. */
export function TemporaryChat() {
  const [draft, setDraft] = useState("");
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
  async function send() {
    if (busy || !draft.trim()) return;
    const text = draft.trim();
    setDraft("");
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
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
        className="flex flex-col gap-2"
      >
        <ModelPicker
          model={model}
          onChange={setModel}
          disabled={busy}
          hasKey={true}
          addKey={() => {}}
        />
        <Textarea
          aria-label="Temporary Message draft"
          placeholder="Message Galaxy"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (
              event.key === "Enter" &&
              !event.shiftKey &&
              !event.nativeEvent.isComposing
            ) {
              event.preventDefault();
              void send();
            }
          }}
        />
        {busy ? (
          <Button type="button" onClick={() => void stop()}>
            Stop Reply
          </Button>
        ) : (
          <Button type="submit" disabled={!draft.trim()}>
            Send message
          </Button>
        )}
      </form>
    </div>
  );
}
