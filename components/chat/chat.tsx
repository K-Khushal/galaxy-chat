"use client";
import type { UIMessage } from "ai";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { preloadResponse } from "@/components/elements/preload-response";
import { Button } from "@/components/ui/button";
import { ErrorState, InlineAlert } from "@/components/ui/state";
import type { ChatMessage } from "@/lib/chat/store";
import {
  api,
  type ChatView,
  chatMessage,
  errorCopy,
  needsKey,
  textOf,
} from "./api";
import type { StoredAttachment } from "./attachment-upload";
import { ByokDialog } from "./byok-dialog";
import { ChatSkeleton, COMPOSER_AREA } from "./chat-skeleton";
import { Composer } from "./composer";
import { Message } from "./message";
import { MessageList } from "./message-list";
import { ModelPicker } from "./model-picker";
import { chatSpend } from "./usage-meter";
import { useByokKey } from "./use-byok-key";
import { useGalaxyChat } from "./use-galaxy-chat";

type Actions = Pick<
  ReturnType<typeof useGalaxyChat>,
  "edit" | "regenerate" | "continueReply" | "switchVersion"
>;
type RowProps = {
  message: UIMessage;
  saved: ChatMessage | undefined;
  parentId: string | null;
  model: string;
  busy: boolean;
  streaming: boolean;
  latest: boolean;
  actions: Actions;
};

/**
 * One Message of the list. Streaming replaces only the last Message object, so
 * every other row keeps the same props and skips rendering for each token.
 */
const MessageRow = memo(function MessageRow({
  message,
  saved,
  parentId,
  model,
  busy,
  streaming,
  latest,
  actions,
}: RowProps) {
  const row = useMemo(
    () => chatMessage(message, saved, parentId, model),
    [message, saved, parentId, model],
  );
  return (
    <Message
      message={row}
      busy={busy}
      streaming={streaming}
      latest={latest}
      onEdit={(text) => actions.edit(row, text)}
      onRegenerate={() => void actions.regenerate(row)}
      onContinue={() => void actions.continueReply(row)}
      onSwitch={(id) => void actions.switchVersion(id)}
    />
  );
});

/** Files uploaded on the new-Chat page, carried over with its first Message. */
function transferredAttachments(chatId: string): StoredAttachment[] {
  try {
    const saved = JSON.parse(
      sessionStorage.getItem(`galaxy:attach:${chatId}`) ?? "[]",
    );
    return Array.isArray(saved) ? saved : [];
  } catch {
    return [];
  }
}
export function Chat({ initial }: { initial: ChatView }) {
  const [transfer] = useState(() =>
    typeof window === "undefined"
      ? undefined
      : (sessionStorage.getItem(`galaxy:send:${initial.chat.id}`) ?? undefined),
  );
  const [transferFiles] = useState(() =>
    typeof window === "undefined"
      ? undefined
      : transferredAttachments(initial.chat.id),
  );
  const chat = useGalaxyChat(initial);
  // Rows get these once, so a token that changes `chat` does not re-render them.
  const latest = useRef(chat);
  latest.current = chat;
  const actions = useMemo<Actions>(
    () => ({
      edit: (row, text) => latest.current.edit(row, text),
      regenerate: (row) => latest.current.regenerate(row),
      continueReply: (row) => latest.current.continueReply(row),
      switchVersion: (id) => latest.current.switchVersion(id),
    }),
    [],
  );
  const saved = useMemo(
    () => new Map(chat.view.messages.map((m) => [m.id, m])),
    [chat.view.messages],
  );
  const empty = chat.messages.length === 0;
  useEffect(() => {
    // A Chat with no Messages is about to get its first Reply.
    if (empty) preloadResponse();
  }, [empty]);
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
  async function send(text: string, files: StoredAttachment[]) {
    const ok = await chat.send(text, files);
    if (ok) sessionStorage.removeItem(`galaxy:attach:${initial.chat.id}`);
    return ok;
  }
  return (
    <>
      <MessageList>
        {chat.messages.length ? (
          <h1 className="sr-only">{initial.chat.title ?? "Chat"}</h1>
        ) : (
          <h1 className="pt-[20vh] pb-6 text-center text-display font-semibold">
            What can I help with?
          </h1>
        )}
        {chat.messages.map((message, index) => (
          <MessageRow
            key={`${index}-${message.role}`}
            message={message}
            saved={saved.get(message.id)}
            parentId={chat.messages[index - 1]?.id ?? null}
            model={chat.model}
            busy={chat.busy}
            streaming={
              chat.busy &&
              index === chat.messages.length - 1 &&
              message.role === "assistant"
            }
            latest={index === chat.messages.length - 1}
            actions={actions}
          />
        ))}
      </MessageList>
      <output className="sr-only" aria-live="polite">
        {announcement}
      </output>
      <div className={COMPOSER_AREA}>
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
          chatId={initial.chat.id}
          model={chat.model}
          busy={chat.busy}
          onSend={send}
          autoSend={transfer !== undefined}
          initialAttachments={transferFiles}
          initialDraft={transfer}
          spend={chatSpend(chat.view.messages)}
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
      <ErrorState
        size="inline"
        className="p-6"
        title="Couldn’t load this Chat"
        description={errorCopy(error)}
      />
    );
  return view ? <Chat key={id} initial={view} /> : <ChatSkeleton />;
}
