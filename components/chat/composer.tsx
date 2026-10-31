"use client";
import { ArrowUp, Plus, Square } from "lucide-react";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
export function Composer({
  chatId,
  busy = false,
  onSend,
  onStop,
  picker,
  initialDraft,
  autoSend = false,
}: {
  chatId: string;
  busy?: boolean;
  onSend: (text: string) => Promise<boolean>;
  initialDraft?: string;
  autoSend?: boolean;
  onStop: () => void;
  picker?: ReactNode;
}) {
  const [draft, setDraft] = useState("");
  const [loaded, setLoaded] = useState(false);
  const sending = useRef(false);
  const transferredDraft = useRef(initialDraft);
  const id = useId();
  useEffect(() => {
    try {
      setDraft(
        localStorage.getItem(`galaxy:draft:${chatId}`) ??
          transferredDraft.current ??
          "",
      );
    } catch {}
    setLoaded(true);
  }, [chatId]);
  useEffect(() => {
    if (loaded)
      try {
        localStorage.setItem(`galaxy:draft:${chatId}`, draft);
      } catch {}
  }, [chatId, draft, loaded]);
  const send = useCallback(async () => {
    if (busy || sending.current || !draft.trim()) return;
    sending.current = true;
    const submitted = draft;
    try {
      if (await onSend(submitted.trim())) {
        setDraft((current) => (current === submitted ? "" : current));
      }
    } catch {
      /* Keep the draft available for retry. */
    } finally {
      sending.current = false;
    }
  }, [busy, draft, onSend]);
  const started = useRef(false);
  useEffect(() => {
    if (loaded && autoSend && !started.current) {
      started.current = true;
      void send();
    }
  }, [loaded, autoSend, send]);
  return (
    <form
      aria-label="Message Galaxy"
      className="flex w-full flex-col gap-1 rounded-3xl border border-input bg-card p-2 shadow-xs focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/20"
      onSubmit={(e) => {
        e.preventDefault();
        send();
      }}
    >
      <label htmlFor={id} className="sr-only">
        Message
      </label>
      <textarea
        id={id}
        value={draft}
        rows={1}
        placeholder="Message Galaxy"
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            send();
          }
        }}
        className="field-sizing-content max-h-48 min-h-10 w-full resize-none bg-transparent px-3 py-2 text-message outline-none placeholder:text-muted-foreground"
      />
      <div className="flex items-center gap-1">
        <Popover>
          <PopoverTrigger
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
          </PopoverTrigger>
          <PopoverContent>Attachments are coming soon.</PopoverContent>
        </Popover>
        {picker}
        <div className="flex-1" />
        <Button
          type={busy ? "button" : "submit"}
          onClick={busy ? onStop : undefined}
          size="icon"
          aria-label={busy ? "Stop Reply" : "Send message"}
          disabled={!busy && !draft.trim()}
          className="rounded-full"
        >
          {busy ? <Square className="size-3 fill-current" /> : <ArrowUp />}
        </Button>
      </div>
    </form>
  );
}
