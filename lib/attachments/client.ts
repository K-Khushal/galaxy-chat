import type { FundingChoice } from "../byok/contract";
import type { ContextSelection } from "../context/contract";
import type { AttachmentContextView, AttachmentView } from "./contract";
export type AttachmentClient = {
  list: (chatId: string, signal?: AbortSignal) => Promise<AttachmentView[]>;
  upload: (
    chatId: string,
    file: File,
    signal?: AbortSignal,
  ) => Promise<AttachmentView>;
  remove: (id: string) => Promise<void>;
  downloadURL: (id: string) => string;
  preview: (
    input: {
      chatId: string;
      ids: string[];
      model: string;
      funding: FundingChoice;
      context?: ContextSelection;
    },
    signal?: AbortSignal,
  ) => Promise<AttachmentContextView>;
};
async function read(response: Response) {
  const body = await response.json();
  if (!response.ok)
    throw new Error(body.error?.id ?? "attachment_request_failed");
  return body;
}
export const attachmentClient: AttachmentClient = {
  list: async (chatId, signal) =>
    (
      await read(
        await fetch(`/api/attachments?chatId=${encodeURIComponent(chatId)}`, {
          cache: "no-store",
          signal,
        }),
      )
    ).attachments,
  upload: async (chatId, file, signal) => {
    const fallback: Record<string, string> = {
      txt: "text/plain",
      pdf: "application/pdf",
      png: "image/png",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      webp: "image/webp",
    };
    const markdown = /\.(md|markdown)$/i.test(file.name);
    return (
      await read(
        await fetch(`/api/attachments?chatId=${encodeURIComponent(chatId)}`, {
          method: "POST",
          body: file,
          signal,
          headers: {
            "Content-Type": markdown
              ? "text/markdown"
              : file.type ||
                fallback[file.name.split(".").at(-1)?.toLowerCase() ?? ""] ||
                "application/octet-stream",
            "x-attachment-name": encodeURIComponent(file.name),
          },
        }),
      )
    ).attachment;
  },
  remove: async (id) => {
    await read(
      await fetch(`/api/attachments?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      }),
    );
  },
  downloadURL: (id) =>
    `/api/attachments?id=${encodeURIComponent(id)}&download=1`,
  preview: async (input, signal) =>
    (
      await read(
        await fetch("/api/context", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action: "preview",
            selection: input.context ?? { projectId: null, memoryIds: [] },
            attachments: {
              chatId: input.chatId,
              ids: input.ids,
              model: input.model,
              funding: input.funding,
            },
          }),
          signal,
        }),
      )
    ).attachments,
};
