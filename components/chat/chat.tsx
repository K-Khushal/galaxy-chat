"use client";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  api,
  type ChatView,
  chatMessage,
  errorCopy,
  needsKey,
  textOf,
} from "./api";
import { ByokDialog } from "./byok-dialog";
import { Composer } from "./composer";
import { Message } from "./message";
import { MessageList } from "./message-list";
import { ModelPicker } from "./model-picker";
import { useByokKey } from "./use-byok-key";
import { useGalaxyChat } from "./use-galaxy-chat";
export function Chat({ initial }: { initial: ChatView }) {
  const chat = useGalaxyChat(initial);
  const { hasKey, setHasKey } = useByokKey();
  const [keyOpen, setKeyOpen] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const wasBusy = useRef(false);
  const previousReply = useRef("");
  useEffect(() => {
    if (!wasBusy.current && chat.busy) {
      const reply = chat.messages.at(-1);
      previousReply.current = reply ? reply.id + textOf(reply) : "";
      setAnnouncement("");
    }
    if (wasBusy.current && !chat.busy) {
      const reply = chat.messages.at(-1);
      if (
        reply?.role === "assistant" &&
        reply.id + textOf(reply) !== previousReply.current
      )
        setAnnouncement(
          textOf(reply).slice(0, 100) ||
            "Reply ended before any text was written.",
        );
    }
    wasBusy.current = chat.busy;
  }, [chat.busy, chat.messages]);
  async function send(text: string) {
    const ok = await chat.send(text);
    if (ok) {
      const transferred = sessionStorage.getItem(
        `galaxy:send:${initial.chat.id}`,
      );
      if (
        transferred &&
        localStorage.getItem("galaxy:draft:new")?.trim() === transferred.trim()
      )
        localStorage.removeItem("galaxy:draft:new");
      sessionStorage.removeItem(`galaxy:send:${initial.chat.id}`);
    }
    return ok;
  }
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
          const row = chatMessage(
            message,
            saved,
            chat.messages[index - 1]?.id ?? null,
            chat.model,
          );
          return (
            <Message
              key={`${index}-${message.role}`}
              message={row}
              busy={chat.busy}
              streaming={
                chat.busy &&
                index === chat.messages.length - 1 &&
                message.role === "assistant"
              }
              onEdit={(text) => chat.edit(row, text)}
              onRegenerate={() => void chat.regenerate(row)}
              onContinue={() => void chat.continueReply(row)}
              onSwitch={(id) => void chat.switchVersion(id)}
            />
          );
        })}
      </MessageList>
      <output className="sr-only" aria-live="polite">
        {announcement}
      </output>
      <div className="mx-auto w-full max-w-3xl px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        {chat.error && (
          <div
            role="alert"
            className="mb-3 flex flex-wrap items-center gap-2 text-sm"
          >
            <p>{errorCopy(chat.error)}</p>
            {needsKey(chat.error) && (
              <Button variant="link" onClick={() => setKeyOpen(true)}>
                Add your OpenRouter key
              </Button>
            )}
          </div>
        )}
        <Composer
          chatId={initial.chat.id}
          busy={chat.busy}
          onSend={send}
          autoSend={
            typeof window !== "undefined" &&
            !!sessionStorage.getItem(`galaxy:send:${initial.chat.id}`)
          }
          initialDraft={
            typeof window === "undefined"
              ? undefined
              : (sessionStorage.getItem(`galaxy:send:${initial.chat.id}`) ??
                undefined)
          }
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
    <output
      aria-label="Loading Chat"
      className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 p-4"
    >
      <div className="ml-auto h-14 w-2/3 rounded-3xl bg-muted motion-safe:animate-pulse" />
      <div className="h-28 w-full rounded-xl bg-muted motion-safe:animate-pulse" />
      <div className="mt-auto h-28 rounded-3xl border bg-card" />
    </output>
  );
}
