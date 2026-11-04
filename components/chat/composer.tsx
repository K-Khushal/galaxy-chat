"use client";
import { ArrowUp, Paperclip, Square } from "lucide-react";
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
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  ACCEPT_FILES,
  ACCEPT_IMAGES,
  modelSupport,
  supportsKind,
  unreadableCopy,
} from "@/lib/attachments/rules";
import { DEFAULT_MODEL_ID, findModel } from "@/lib/models";
import { cn } from "@/lib/utils";
import { AttachmentTray } from "./attachment-tray";
import type { StoredAttachment, Uploader } from "./attachment-upload";
import {
  COMPOSER_FRAME,
  COMPOSER_TEXTAREA,
  COMPOSER_TOOLBAR,
  SEND_BUTTON,
} from "./composer-skeleton";
import { type ChatSpend, UsageMeter } from "./usage-meter";
import { useAttachments } from "./use-attachments";

const SWAP =
  "[grid-area:1/1] transition-[opacity,scale,filter] duration-160 ease-out";
const SWAP_HIDDEN = "opacity-0 motion-safe:scale-[0.25] motion-safe:blur-[4px]";

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
  spend,
}: {
  chatId: string;
  persistDraft?: boolean;
  busy?: boolean;
  onSend: (text: string, attachments: StoredAttachment[]) => Promise<boolean>;
  initialDraft?: string;
  /** Files already uploaded, carried over from the new-Chat page. */
  initialAttachments?: StoredAttachment[];
  autoSend?: boolean;
  onStop: () => void;
  picker?: ReactNode;
  /** The model the Message goes to: decides which files can be attached. */
  model?: string;
  upload?: Uploader;
  /** What this Chat has spent so far, for the usage beside Send. */
  spend?: ChatSpend;
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
  function pick(input: HTMLInputElement) {
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
  // At most one line: a file that can't be sent, then an upload problem, then the drop hint.
  const failedItem = files.items.find((item) => item.status === "error");
  const problem = files.notice || failedItem?.error || "";
  return (
    <form
      aria-label="Message Galaxy"
      data-dragging={dragging || undefined}
      className={COMPOSER_FRAME}
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
      {unreadable ? (
        <output
          id={`${id}-unreadable`}
          className="px-2 text-caption text-destructive"
        >
          {unreadableCopy(support, unreadable.name)}
        </output>
      ) : problem ? (
        <p role="alert" className="px-2 text-caption text-destructive">
          {problem}
        </p>
      ) : dragging ? (
        <p className="px-2 text-caption text-muted-foreground">
          Drop files to attach them.
        </p>
      ) : null}
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
        className={COMPOSER_TEXTAREA}
      />
      <div className={COMPOSER_TOOLBAR}>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="Add attachment"
                className="rounded-full text-muted-foreground"
                onClick={() => fileInput.current?.click()}
              />
            }
          >
            <Paperclip />
          </TooltipTrigger>
          <TooltipContent>
            {support.vision ? "Add photos and files" : "Add files"}
          </TooltipContent>
        </Tooltip>
        <input
          ref={fileInput}
          type="file"
          multiple
          accept={[ACCEPT_IMAGES, ACCEPT_FILES].join(",")}
          tabIndex={-1}
          aria-hidden="true"
          className="hidden"
          onChange={(e) => pick(e.currentTarget)}
        />
        {picker}
        <div className="flex-1" />
        <UsageMeter model={model} spend={spend} />
        <Button
          type={busy ? "button" : "submit"}
          onClick={busy ? onStop : undefined}
          size="icon-sm"
          aria-label={busy ? "Stop Reply" : "Send message"}
          disabled={!busy && !canSend}
          aria-describedby={unreadable ? `${id}-unreadable` : undefined}
          className={cn(
            SEND_BUTTON,
            busy && "bg-foreground text-background hover:bg-foreground/90",
          )}
        >
          {/* Both glyphs share one cell so the button never resizes. */}
          <span className="grid place-items-center">
            <ArrowUp
              aria-hidden="true"
              className={cn(SWAP, busy && SWAP_HIDDEN)}
            />
            <Square
              aria-hidden="true"
              className={cn(SWAP, "size-3 fill-current", !busy && SWAP_HIDDEN)}
            />
          </span>
        </Button>
      </div>
    </form>
  );
}
