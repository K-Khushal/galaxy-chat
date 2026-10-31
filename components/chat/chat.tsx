"use client";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { ChatMessage } from "@/lib/chat/store";
import { api, type ChatView, errorCopy } from "./api";
import { ByokDialog } from "./byok-dialog";
import { Composer } from "./composer";
import { Message } from "./message";
import { MessageList } from "./message-list";
import { ModelPicker } from "./model-picker";
import { useGalaxyChat } from "./use-galaxy-chat";
export function Chat({ initial }: { initial: ChatView }) {
  const chat = useGalaxyChat(initial);
  const [hasKey, setHasKey] = useState(false);
  const [keyOpen, setKeyOpen] = useState(false);
  const reduced = useReducedMotion();
  const sent = useRef(false);
  useEffect(() => {
    if (sent.current) return;
    sent.current = true;
    const text = sessionStorage.getItem(`galaxy:send:${initial.chat.id}`);
    if (text) {
      sessionStorage.removeItem(`galaxy:send:${initial.chat.id}`);
      void chat.send(text);
    }
  }, [chat, initial.chat.id]);
  useEffect(() => {
    api<{ key: unknown }>("/api/byok")
      .then((data) => setHasKey(!!data.key))
      .catch(() => {});
  }, []);
  return (
    <>
      <MessageList>
        {!chat.messages.length && (
          <h1 className="pt-[20vh] pb-6 text-center text-3xl font-medium tracking-tight">
            What can I help with?
          </h1>
        )}
        {chat.messages.map((message, index) => {
          const saved = chat.view.messages.find((m) => m.id === message.id);
          const row: ChatMessage = {
            ...(saved ?? {
              parentId: chat.messages[index - 1]?.id ?? null,
              status: "complete",
              model: chat.model,
              payment: null,
              usage: null,
              error: null,
              createdAt: "",
              versions: { ids: [message.id], index: 0 },
            }),
            ...message,
            role: message.role === "user" ? "user" : "assistant",
          };
          return (
            <AnimatePresence
              key={`${index}-${message.role}`}
              mode="wait"
              initial={false}
            >
              <motion.div
                key={message.id}
                initial={reduced ? false : { opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: reduced ? 0 : 0.12 }}
              >
                <Message
                  message={row}
                  busy={chat.busy}
                  streaming={
                    chat.busy &&
                    index === chat.messages.length - 1 &&
                    message.role === "assistant"
                  }
                  onEdit={(text) => void chat.edit(row, text)}
                  onRegenerate={() => void chat.regenerate(row)}
                  onContinue={() => void chat.continueReply(row)}
                  onSwitch={(id) => void chat.switchVersion(id)}
                />
              </motion.div>
            </AnimatePresence>
          );
        })}
      </MessageList>
      <output className="sr-only" aria-live="polite">
        {chat.busy
          ? "Writing Reply"
          : chat.messages.at(-1)?.role === "assistant"
            ? "Reply ready"
            : ""}
      </output>
      <div className="mx-auto w-full max-w-3xl px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        {chat.error && (
          <div
            role="alert"
            className="mb-3 flex flex-wrap items-center gap-2 text-sm"
          >
            <p>{errorCopy(chat.error)}</p>
            <Button variant="link" onClick={() => setKeyOpen(true)}>
              Add your OpenRouter key
            </Button>
          </div>
        )}
        <Composer
          chatId={initial.chat.id}
          busy={chat.busy}
          onSend={(text) => void chat.send(text)}
          onStop={() => void chat.stop()}
          picker={
            <ModelPicker
              model={chat.model}
              onChange={chat.setModel}
              hasKey={hasKey}
              addKey={() => setKeyOpen(true)}
              disabled={chat.busy}
            />
          }
        />
      </div>
      <ByokDialog
        open={keyOpen}
        onOpenChange={setKeyOpen}
        onSaved={() => setHasKey(true)}
      />
    </>
  );
}
export function ChatLoader({ id }: { id: string }) {
  const [view, setView] = useState<ChatView>();
  const [error, setError] = useState<Error>();
  useEffect(() => {
    let active = true;
    api<ChatView>(`/api/chats/${id}`)
      .then((data) => {
        if (active) setView(data);
      })
      .catch((error) => {
        if (active) setError(error);
      });
    return () => {
      active = false;
    };
  }, [id]);
  if (error)
    return (
      <p role="alert" className="p-6">
        {errorCopy(error)}
      </p>
    );
  return view ? (
    <Chat key={id} initial={view} />
  ) : (
    <output className="p-6 text-muted-foreground">Loading Chat…</output>
  );
}
