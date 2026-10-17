"use client";
import { Paperclip, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  type AttachmentView,
  attachmentAccept,
  attachmentLimits,
} from "@/lib/attachments/contract";
export function attachmentErrorMessage(id: string) {
  const errors: Record<string, string> = {
    attachments_unavailable:
      "Private file storage is unavailable. Your message can still be sent without files.",
    storage_private_required: "Private file storage needs operator attention.",
    attachment_size_limit:
      "Choose a file under 2 MiB (text and Markdown: 128 KiB).",
    attachment_processing_timeout:
      "This file took too long to process. Try a shorter excerpt.",
    attachment_text_limit:
      "This document contains too much text. Upload a shorter excerpt.",
    attachment_page_limit:
      "PDFs can contain up to 12 pages. Upload a shorter excerpt.",
    attachment_no_text_no_ocr:
      "This PDF has no extractable text. Paste its text instead; OCR is not run automatically.",
    attachment_storage_limit:
      "Your file storage limit has been reached. Delete unused files before uploading.",
    attachment_transfer_limit:
      "The daily file transfer limit has been reached. Try again tomorrow.",
    attachment_processing_limit:
      "Another file is processing. Wait for it to finish before uploading.",
    attachment_type_unsupported:
      "Choose text, Markdown, PDF, PNG, JPEG, or WebP.",
    attachment_content_mismatch: "The file contents do not match its type.",
    attachment_pdf_unreadable:
      "This PDF cannot be read. Try an unencrypted text PDF.",
    attachment_model_unsupported:
      "This model cannot read images. Choose a reviewed image-capable model or attach text.",
    attachment_context_limit:
      "The selected files exceed the context limit. Select fewer files or upload shorter excerpts.",
  };
  return (
    errors[id] ??
    "The file request failed. Try again; your message has not been sent."
  );
}
export type AttachmentPickerProps = {
  chatId: string;
  saved: boolean;
  temporary?: boolean;
  busy?: boolean;
  selected: string[];
  onSelection: (ids: string[]) => void;
  imagesSupported?: boolean;
};
/** Saved invited chats only. Metadata is escaped text; files never render inline. */
export function AttachmentPicker({
  chatId,
  saved,
  temporary = false,
  busy = false,
  selected,
  onSelection,
  imagesSupported = false,
}: AttachmentPickerProps) {
  const [files, setFiles] = useState<AttachmentView[]>([]);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const upload = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const disabled = temporary || !saved;
  const disabledReason = temporary
    ? "Files are unavailable in temporary chats."
    : !saved
      ? "Send the first message before adding private files."
      : "";
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      upload.current?.abort();
    };
  }, []);
  useEffect(() => {
    setFiles([]);
    setMessage("");
    if (disabled) return;
    const controller = new AbortController();
    setLoading(true);
    fetch(`/api/attachments?chatId=${encodeURIComponent(chatId)}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error?.id);
        if (mounted.current) setFiles(body.attachments);
      })
      .catch((error) => {
        if (!controller.signal.aborted && mounted.current)
          setMessage(
            attachmentErrorMessage(error instanceof Error ? error.message : ""),
          );
      })
      .finally(() => {
        if (!controller.signal.aborted && mounted.current) setLoading(false);
      });
    return () => controller.abort();
  }, [chatId, disabled]);
  async function add(file: File) {
    if (disabled || busy || uploading) return;
    const controller = new AbortController();
    upload.current = controller;
    setUploading(true);
    setMessage("");
    try {
      if (file.size > attachmentLimits.fileBytes)
        throw new Error("attachment_size_limit");
      const markdown = /\.(md|markdown)$/i.test(file.name);
      const response = await fetch(
        `/api/attachments?chatId=${encodeURIComponent(chatId)}`,
        {
          method: "POST",
          body: file,
          signal: controller.signal,
          headers: {
            "Content-Type": markdown
              ? "text/markdown"
              : file.type || "application/octet-stream",
            "x-attachment-name": encodeURIComponent(file.name),
          },
        },
      );
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.id);
      if (!mounted.current) return;
      const attachment = body.attachment as AttachmentView;
      setFiles((previous) => [...previous, attachment]);
      if (
        selected.length < attachmentLimits.perMessage &&
        (attachment.kind !== "image" || imagesSupported)
      )
        onSelection([...selected, attachment.id]);
      setMessage(
        attachment.kind === "image" && !imagesSupported
          ? attachmentErrorMessage("attachment_model_unsupported")
          : "Private file ready. Select it to include it in your next message.",
      );
    } catch (error) {
      if (mounted.current)
        setMessage(
          controller.signal.aborted
            ? "Upload cancelled. Any partial file will be cleaned up."
            : attachmentErrorMessage(
                error instanceof Error ? error.message : "",
              ),
        );
    } finally {
      upload.current = null;
      if (mounted.current) setUploading(false);
      if (input.current) input.current.value = "";
    }
  }
  async function remove(id: string) {
    setMessage("");
    try {
      const response = await fetch(
        `/api/attachments?id=${encodeURIComponent(id)}`,
        { method: "DELETE" },
      );
      if (!response.ok) {
        const body = await response.json();
        throw new Error(body.error?.id);
      }
      setFiles((previous) => previous.filter((file) => file.id !== id));
      setMessage(
        "File removed from the conversation. Private storage cleanup is queued; uncertain uploads may need operator reconciliation.",
      );
      onSelection(selected.filter((value) => value !== id));
    } catch (error) {
      setMessage(
        attachmentErrorMessage(error instanceof Error ? error.message : ""),
      );
    }
  }
  return (
    <section aria-label="Private attachments" className="min-w-0 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={input}
          type="file"
          accept={attachmentAccept}
          className="sr-only"
          tabIndex={-1}
          aria-label="Choose a private file"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void add(file);
          }}
        />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={disabled || busy || uploading || loading}
          onClick={() => input.current?.click()}
          className="min-h-11 touch-manipulation"
        >
          <Paperclip className="size-4" />
          Add file
        </Button>
        {uploading ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="min-h-11 touch-manipulation"
            onClick={() => upload.current?.abort()}
          >
            Cancel upload
          </Button>
        ) : null}
        <p className="min-w-0 text-xs text-muted-foreground">
          {disabledReason ||
            "Private · up to 3 files per message · 2 MiB each · PDF: 12 pages · no automatic OCR"}
        </p>
      </div>
      {files.length ? (
        <ul className="space-y-1" aria-label="Files in this conversation">
          {files.map((file) => {
            const unsupported = file.kind === "image" && !imagesSupported;
            const checked = selected.includes(file.id);
            return (
              <li
                key={file.id}
                className="flex min-w-0 items-center gap-2 rounded-lg border border-border px-2 py-1 text-sm"
              >
                <label className="flex min-h-11 min-w-0 flex-1 items-center gap-2">
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={
                      busy ||
                      file.state !== "ready" ||
                      unsupported ||
                      (!checked &&
                        selected.length >= attachmentLimits.perMessage)
                    }
                    onChange={() =>
                      onSelection(
                        checked
                          ? selected.filter((id) => id !== file.id)
                          : [...selected, file.id],
                      )
                    }
                  />
                  <span className="min-w-0 break-words [overflow-wrap:anywhere]">
                    {file.name}
                    <span className="block text-xs text-muted-foreground">
                      {Math.ceil(file.bytes / 1024)} KiB · {file.state}
                      {file.pages ? ` · ${file.pages} pages` : ""}
                      {unsupported ? " · model cannot read images" : ""}
                    </span>
                  </span>
                </label>
                <a
                  href={`/api/attachments?id=${encodeURIComponent(file.id)}&download=1`}
                  className="flex min-h-11 items-center rounded px-2 text-xs underline focus-visible:outline-2"
                  aria-label={`Download ${file.name}`}
                >
                  Download
                </a>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="min-h-11 min-w-11 touch-manipulation"
                  disabled={busy}
                  aria-label={`Delete ${file.name}`}
                  onClick={() => void remove(file.id)}
                >
                  <X className="size-4" />
                </Button>
              </li>
            );
          })}
        </ul>
      ) : null}
      <output aria-live="polite" className="text-xs text-muted-foreground">
        {uploading
          ? "Uploading and extracting text…"
          : loading
            ? "Loading private files…"
            : message}
      </output>
    </section>
  );
}
