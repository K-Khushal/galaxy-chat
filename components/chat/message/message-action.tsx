"use client";
import { Check, Copy, Pencil, RefreshCcw } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
export function useCopyToClipboard() {
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  useEffect(() => {
    if (!copiedMessageId) return;
    const timer = setTimeout(() => setCopiedMessageId(null), 1800);
    return () => clearTimeout(timer);
  }, [copiedMessageId]);
  async function handleCopy(text: string, id: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedMessageId(id);
    } catch {
      toast.error("Copy failed. Select the text and copy it manually.");
    }
  }
  return { copiedMessageId, handleCopy };
}
export function MessageActions({
  messageRole,
  messageId,
  text,
  isLastMessage,
  isLastPart,
  onEdit,
  onRetry,
  className,
}: {
  messageRole: "user" | "assistant" | "system";
  messageId: string;
  text: string;
  isLastMessage: boolean;
  isLastPart: boolean;
  onEdit?: () => void;
  onRetry?: () => void;
  className?: string;
}) {
  const { copiedMessageId, handleCopy } = useCopyToClipboard();
  return (
    <div
      className={cn(
        "mt-1 flex gap-1",
        messageRole === "user" && "justify-end",
        className,
      )}
    >
      <Button
        variant="ghost"
        size="icon"
        className="text-muted-foreground"
        aria-label={
          copiedMessageId === messageId ? "Message copied" : "Copy message"
        }
        onClick={() => void handleCopy(text, messageId)}
      >
        {copiedMessageId === messageId ? <Check /> : <Copy />}
      </Button>
      {messageRole === "user" && onEdit && (
        <Button
          variant="ghost"
          size="icon"
          aria-label="Edit message"
          onClick={onEdit}
        >
          <Pencil />
        </Button>
      )}
      {messageRole === "assistant" &&
        onRetry &&
        isLastMessage &&
        isLastPart && (
          <Button
            variant="ghost"
            size="icon"
            aria-label="Regenerate response"
            onClick={onRetry}
          >
            <RefreshCcw />
          </Button>
        )}
      <output className="sr-only">
        {copiedMessageId === messageId ? "Copied to clipboard" : ""}
      </output>
    </div>
  );
}
export function ErrorActions({
  errorMessage,
  status,
  onRetry,
  retryEnabled = false,
}: {
  errorMessage: string;
  status: "ready" | "error" | "streaming" | "submitted";
  onRetry: () => void;
  retryEnabled?: boolean;
}) {
  const { copiedMessageId, handleCopy } = useCopyToClipboard();
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      <Button
        variant="outline"
        disabled={
          !retryEnabled || status === "streaming" || status === "submitted"
        }
        onClick={onRetry}
      >
        <RefreshCcw />
        Retry response
      </Button>
      <Button
        variant="ghost"
        onClick={() => void handleCopy(errorMessage, "error")}
      >
        <Copy />
        {copiedMessageId === "error" ? "Copied" : "Copy error"}
      </Button>
    </div>
  );
}

export function CopyAction({
  text,
  messageId,
  className,
}: {
  text: string;
  messageId: string;
  className?: string;
}) {
  const { copiedMessageId, handleCopy } = useCopyToClipboard();
  return (
    <Button
      variant="ghost"
      size="icon"
      className={className}
      aria-label={
        copiedMessageId === messageId ? "Message copied" : "Copy message"
      }
      onClick={() => void handleCopy(text, messageId)}
    >
      {copiedMessageId === messageId ? <Check /> : <Copy />}
    </Button>
  );
}
export function EditAction({
  onEdit,
  className,
}: {
  onEdit: () => void;
  className?: string;
}) {
  return (
    <Button
      variant="ghost"
      size="icon"
      className={className}
      aria-label="Edit message"
      onClick={onEdit}
    >
      <Pencil />
    </Button>
  );
}
export function RetryAction({
  onRetry,
  className,
}: {
  onRetry: () => void;
  className?: string;
}) {
  return (
    <Button
      variant="ghost"
      size="icon"
      className={className}
      aria-label="Retry response"
      onClick={onRetry}
    >
      <RefreshCcw />
    </Button>
  );
}
