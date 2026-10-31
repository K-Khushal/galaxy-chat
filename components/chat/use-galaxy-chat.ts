"use client";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { attachmentIdFromUrl, attachmentUrl } from "@/lib/attachments/rules";
import type { ChatMessage } from "@/lib/chat/store";
import { api, type ChatView } from "./api";
import type { UploadedAttachment } from "./attachment-upload";

type FilePart = {
  type: "file";
  mediaType: string;
  filename?: string;
  url: string;
};

const fileParts = (files: UploadedAttachment[]): FilePart[] =>
  files.map((file) => ({
    type: "file",
    mediaType: file.contentType,
    filename: file.filename,
    url: attachmentUrl(file.id),
  }));

/** The stored file parts of a Message that point at Attachments. */
const savedFileParts = (message: ChatMessage): FilePart[] =>
  message.parts.filter(
    (part): part is FilePart =>
      part.type === "file" && attachmentIdFromUrl(part.url) !== null,
  );

export function useGalaxyChat(initial: ChatView) {
  const [view, setView] = useState(initial);
  const [actionError, setActionError] = useState<Error>();
  const [pending, setPending] = useState(false);
  const [model, setModel] = useState(initial.chat.model);
  const id = initial.chat.id;
  const reloadRef = useRef<() => Promise<void>>(async () => {});
  const accepted = useRef(false);
  const accept = useRef<((ok: boolean) => void) | undefined>(undefined);
  const performing = useRef(false);
  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: `/api/chats/${id}/messages`,
        fetch: Object.assign(
          async (url: RequestInfo | URL, options?: RequestInit) => {
            const response = await fetch(url, options);
            if (options?.method === "POST" && response.ok) {
              accepted.current = true;
              accept.current?.(true);
            }
            return response;
          },
          { preconnect: fetch.preconnect },
        ),
        prepareSendMessagesRequest: ({ body }) => ({ body: body ?? {} }),
        prepareReconnectToStreamRequest: () => ({
          api: `/api/chats/${id}/stream`,
        }),
      }),
    [id],
  );
  const chat = useChat<UIMessage>({
    id,
    messages: initial.messages,
    transport,
    resume: !!initial.generation,
    onFinish: () => {
      window.dispatchEvent(new Event("galaxy-account-changed"));
      void reloadRef.current();
    },
  });
  const { setMessages } = chat;
  const reload = useCallback(async () => {
    try {
      const next = await api<ChatView>(`/api/chats/${id}`);
      setView(next);
      // Finish can arrive before the producer's final database write.
      if (!next.generation) setMessages(next.messages);
      window.dispatchEvent(new Event("galaxy:chats"));
    } catch (error) {
      setActionError(error as Error);
    }
  }, [id, setMessages]);
  reloadRef.current = reload;
  useEffect(() => {
    if (!view.generation) return;
    const timer = setInterval(() => void reload(), 1000);
    return () => clearInterval(timer);
  }, [view.generation, reload]);
  const busy =
    pending ||
    chat.status === "streaming" ||
    chat.status === "submitted" ||
    !!view.generation;
  async function perform(
    body: object,
    sent?: { text: string; files: FilePart[] },
    parentId?: string | null,
    continuing = false,
  ) {
    if (busy || performing.current) return false;
    performing.current = true;
    accepted.current = false;
    setActionError(undefined);
    chat.clearError();
    setPending(true);
    const before = chat.messages;
    if (parentId !== undefined) {
      const index =
        parentId === null ? -1 : before.findIndex((m) => m.id === parentId);
      setMessages(before.slice(0, index + 1));
    }
    const acceptance = new Promise<boolean>((resolve) => {
      accept.current = resolve;
    });
    async function execute() {
      try {
        if (sent !== undefined)
          await chat.sendMessage(
            {
              role: "user",
              parts: [
                ...sent.files,
                ...(sent.text
                  ? [{ type: "text" as const, text: sent.text }]
                  : []),
              ],
            },
            { body },
          );
        else if (continuing) await chat.sendMessage(undefined, { body });
        else await chat.regenerate({ body });
        if (accepted.current) await reload();
        else setMessages(before);
      } catch (error) {
        setActionError(error as Error);
        if (accepted.current) await reload();
        else setMessages(before);
      } finally {
        setPending(false);
        performing.current = false;
        accept.current = undefined;
      }
      return accepted.current;
    }
    return Promise.race([execute(), acceptance]);
  }
  return {
    messages: chat.messages,
    view,
    model,
    setModel,
    busy,
    error: actionError ?? chat.error,
    send: (text: string, files: UploadedAttachment[] = []) =>
      perform(
        {
          trigger: "submit-message",
          parentId: chat.messages.at(-1)?.id ?? null,
          parts: text ? [{ type: "text", text }] : [],
          attachmentIds: files.map((file) => file.id),
          model,
        },
        { text, files: fileParts(files) },
      ),
    // An edit keeps the Message's files.
    edit: (message: ChatMessage, text: string) =>
      perform(
        {
          trigger: "submit-message",
          parentId: message.parentId,
          parts: [{ type: "text", text }],
          attachmentIds: savedFileParts(message).flatMap(
            (part) => attachmentIdFromUrl(part.url) ?? [],
          ),
          model,
        },
        { text, files: savedFileParts(message) },
        message.parentId,
      ),
    regenerate: (message: ChatMessage) =>
      perform(
        { trigger: "regenerate-message", messageId: message.id, model },
        undefined,
        message.parentId,
      ),
    continueReply: (message: ChatMessage) =>
      perform(
        { trigger: "continue-message", messageId: message.id },
        undefined,
        message.id,
        true,
      ),
    stop: async () => {
      try {
        await api(`/api/chats/${id}/stop`, {});
      } catch (error) {
        setActionError(error as Error);
      }
    },
    switchVersion: async (messageId: string) => {
      if (busy) return;
      setPending(true);
      try {
        const next = await api<ChatView>(`/api/chats/${id}/version`, {
          messageId,
        });
        setView(next);
        setMessages(next.messages);
      } catch (error) {
        setActionError(error as Error);
      } finally {
        setPending(false);
      }
    },
  };
}
