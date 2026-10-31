"use client";
import {
  ArrowUp,
  FileText,
  Image as ImageIcon,
  Plus,
  Square,
} from "lucide-react";
import {
  type ClipboardEvent,
  type DragEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ACCEPT_FILES,
  ACCEPT_IMAGES,
  modelSupport,
  supportsKind,
  unreadableCopy,
  visionOffCopy,
} from "@/lib/attachments/rules";
import { DEFAULT_MODEL_ID, findModel } from "@/lib/models";
import { AttachmentTray } from "./attachment-tray";
import type { UploadedAttachment, Uploader } from "./attachment-upload";
import { useAttachments } from "./use-attachments";
export function Composer({
  chatId,
  busy = false,
  onSend,
  onStop,
  picker,
  initialDraft,
  initialAttachments,
  autoSend = false,
  persistDraft = true,
  model = DEFAULT_MODEL_ID,
  upload,
}: {
  chatId: string;
  persistDraft?: boolean;
  busy?: boolean;
  onSend: (text: string, attachments: UploadedAttachment[]) => Promise<boolean>;
  initialDraft?: string;
  /** Files already uploaded, carried over from the new-Chat page. */
  initialAttachments?: UploadedAttachment[];
  autoSend?: boolean;
  onStop: () => void;
  picker?: ReactNode;
  /** The model the Message goes to: decides which files can be attached. */
  model?: string;
  upload?: Uploader;
}) {
  const catalog = findModel(model);
  const support = modelSupport(
    catalog?.capabilities ?? null,
    catalog?.label ?? model,
  );
  const files = useAttachments({
    support,
    upload,
    initial: initialAttachments,
  });
  const imageInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [draft, setDraft] = useState("");
  const [loaded, setLoaded] = useState(false);
  const sending = useRef(false);
  const transferredDraft = useRef(initialDraft);
  const id = useId();
  useEffect(() => {
    try {
      const restored =
        (persistDraft
          ? localStorage.getItem(`galaxy:draft:${chatId}`)
          : null) ??
        transferredDraft.current ??
        "";
      setDraft(restored);
      // Persist the restored draft before consuming the one-shot transfer.
      if (persistDraft && transferredDraft.current !== undefined) {
        localStorage.setItem(`galaxy:draft:${chatId}`, restored);
        // The new-Chat draft was handed off to this Chat; never let it return.
        localStorage.removeItem("galaxy:draft:new");
        sessionStorage.removeItem(`galaxy:send:${chatId}`);
      }
    } catch {}
    setLoaded(true);
  }, [chatId, persistDraft]);
  useEffect(() => {
    if (loaded && persistDraft)
      try {
        localStorage.setItem(`galaxy:draft:${chatId}`, draft);
      } catch {}
  }, [chatId, draft, loaded, persistDraft]);
  const { ready, uploading, failed, clear } = files;
  const hasContent = !!draft.trim() || ready.length > 0;
  // A file attached under one model can outlive a switch to another.
  const unreadable = files.items.find(
    (item) => item.status !== "error" && !supportsKind(support, item.kind),
  );
  const canSend = hasContent && !uploading && !failed && !unreadable;
  const send = useCallback(async () => {
    if (busy || sending.current || !canSend) return;
    sending.current = true;
    const submitted = draft;
    try {
      if (await onSend(submitted.trim(), ready)) {
        setDraft((current) => (current === submitted ? "" : current));
        clear();
      }
    } catch {
      /* Keep the draft available for retry. */
    } finally {
      sending.current = false;
    }
  }, [busy, canSend, draft, onSend, ready, clear]);
  const started = useRef(false);
  useEffect(() => {
    if (loaded && autoSend && !started.current) {
      started.current = true;
      void send();
    }
  }, [loaded, autoSend, send]);
  const hasFiles = (event: DragEvent) =>
    event.dataTransfer?.types?.includes("Files") ?? false;
  function pick(input: HTMLInputElement | null) {
    if (!input) return;
    files.add([...(input.files ?? [])]);
    // So choosing the same file again still fires a change.
    input.value = "";
  }
  function paste(event: ClipboardEvent) {
    const pasted = [...event.clipboardData.files];
    // Text that arrives with a file (copied from a document) stays a text paste.
    if (pasted.length === 0 || event.clipboardData.getData("text/plain"))
      return;
    event.preventDefault();
    files.add(pasted);
  }
  return (
    <form
      aria-label="Message Galaxy"
      data-dragging={dragging || undefined}
      className="flex w-full flex-col gap-1 rounded-3xl border border-input bg-card p-2 shadow-xs focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/20 data-dragging:border-ring data-dragging:ring-3 data-dragging:ring-ring/20"
      onSubmit={(e) => {
        e.preventDefault();
        send();
      }}
      onDragEnter={(e) => {
        if (hasFiles(e)) setDragging(true);
      }}
      onDragOver={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
          setDragging(false);
        }
      }}
      onDrop={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        setDragging(false);
        files.add([...e.dataTransfer.files]);
      }}
    >
      <AttachmentTray items={files.items} onRemove={files.remove} />
      {(files.notice || dragging) && (
        <p
          role={dragging ? undefined : "alert"}
          className={`px-3 pt-1 text-xs ${dragging ? "text-muted-foreground" : "text-destructive"}`}
        >
          {dragging ? "Drop files to attach them." : files.notice}
        </p>
      )}
      {unreadable && (
        <output
          id={`${id}-unreadable`}
          className="px-3 pt-1 text-xs text-destructive"
        >
          {unreadableCopy(support, unreadable.name)}
        </output>
      )}
      <label htmlFor={id} className="sr-only">
        Message
      </label>
      <textarea
        id={id}
        value={draft}
        rows={1}
        placeholder="Message Galaxy"
        onChange={(e) => setDraft(e.target.value)}
        onPaste={paste}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            send();
          }
        }}
        className="field-sizing-content max-h-48 min-h-10 w-full resize-none bg-transparent px-3 py-2 text-message outline-none placeholder:text-muted-foreground"
      />
      <div className="flex items-center gap-1">
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Add attachment"
                className="rounded-full"
              />
            }
          >
            <Plus />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" side="top" className="w-72">
            <DropdownMenuItem
              disabled={!support.vision}
              onClick={() => imageInput.current?.click()}
            >
              <ImageIcon />
              <span className="grid">
                <span>Add photos</span>
                <span className="text-xs text-muted-foreground">
                  {support.vision
                    ? "PNG, JPEG, WebP or GIF"
                    : `${visionOffCopy(support)} Choose another model to attach photos.`}
                </span>
              </span>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => fileInput.current?.click()}>
              <FileText />
              <span className="grid">
                <span>Add files</span>
                <span className="text-xs text-muted-foreground">
                  PDFs, text and code, up to 10 MB each
                </span>
              </span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <input
          ref={imageInput}
          type="file"
          multiple
          accept={ACCEPT_IMAGES}
          tabIndex={-1}
          aria-hidden="true"
          className="hidden"
          onChange={(e) => pick(e.currentTarget)}
        />
        <input
          ref={fileInput}
          type="file"
          multiple
          accept={ACCEPT_FILES}
          tabIndex={-1}
          aria-hidden="true"
          className="hidden"
          onChange={(e) => pick(e.currentTarget)}
        />
        {picker}
        <div className="flex-1" />
        <Button
          type={busy ? "button" : "submit"}
          onClick={busy ? onStop : undefined}
          size="icon"
          aria-label={busy ? "Stop Reply" : "Send message"}
          disabled={!busy && !canSend}
          aria-describedby={unreadable ? `${id}-unreadable` : undefined}
          className="rounded-full"
        >
          {busy ? <Square className="size-3 fill-current" /> : <ArrowUp />}
        </Button>
      </div>
    </form>
  );
}
