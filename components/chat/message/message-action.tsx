"use client";

import { cn } from "@/lib/utils";
import {
  CheckIcon,
  CopyIcon,
  PencilIcon,
  RefreshCcwIcon,
  ThumbsDownIcon,
  ThumbsUpIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Action, Actions } from "../../elements/actions";

// Custom hook for copy functionality
export function useCopyToClipboard() {
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);

  const handleCopy = async (text: string, messageId: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedMessageId(messageId);
    } catch (err) {
      console.error("Failed to copy text: ", err);
    }
  };

  // Reset copied state after 1 second
  useEffect(() => {
    if (copiedMessageId) {
      const timer = setTimeout(() => {
        setCopiedMessageId(null);
      }, 1000);

      return () => clearTimeout(timer);
    }
  }, [copiedMessageId]);

  return { copiedMessageId, handleCopy };
}

interface MessageActionProps {
  messageRole: "user" | "assistant" | "system";
  messageId: string;
  text: string;
  isLastMessage: boolean;
  isLastPart: boolean;
  onEdit?: () => void;
  onRetry?: () => void;
  className?: string;
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
}: MessageActionProps) {
  const { copiedMessageId, handleCopy } = useCopyToClipboard();

  const onLike = () => {
    toast.info("Liked", {
      description: "You liked the response",
      duration: 1000,
    });
  };

  const onDislike = () => {
    toast.info("Disliked", {
      description: "You disliked the response",
      duration: 1000,
    });
  };

  return (
    <Actions
      className={cn(
        "group flex w-full",
        messageRole !== "user" && "items-start justify-start",
        messageRole === "user" && "items-end justify-end",
        className,
      )}
    >
      {/* Copy Action - Always show */}
      <Action
        className={cn(
          messageRole === "user" &&
            "transition-opacity opacity-0 group-hover:opacity-100",
        )}
        onClick={() => handleCopy(text, messageId)}
        label={copiedMessageId === messageId ? "Copied!" : "Copy"}
      >
        {copiedMessageId === messageId ? (
          <CheckIcon className="size-4" />
        ) : (
          <CopyIcon className="size-4" />
        )}
      </Action>

      {/* Edit Action - Only for user messages */}
      {messageRole === "user" && onEdit && (
        <Action
          className="transition-opacity opacity-0 group-hover:opacity-100"
          onClick={onEdit}
          label="Edit"
        >
          <PencilIcon className="size-4" />
        </Action>
      )}

      {/* Assistant Actions */}
      {messageRole === "assistant" && (
        <>
          {/* Like Action */}
          {onLike && (
            <Action onClick={onLike} label="Like">
              <ThumbsUpIcon className="size-4" />
            </Action>
          )}

          {/* Dislike Action */}
          {onDislike && (
            <Action onClick={onDislike} label="Dislike">
              <ThumbsDownIcon className="size-4" />
            </Action>
          )}

          {/* Retry Action - Only for the last message & last part */}
          {onRetry && isLastMessage && isLastPart && (
            <Action onClick={onRetry} label="Retry">
              <RefreshCcwIcon className="size-4" />
            </Action>
          )}
        </>
      )}
    </Actions>
  );
}

interface ErrorActionsProps {
  errorMessage: string;
  status: "ready" | "error" | "streaming" | "submitted";
  onRetry: () => void;
}

export function ErrorActions({
  errorMessage,
  status,
  onRetry,
}: ErrorActionsProps) {
  const { copiedMessageId, handleCopy } = useCopyToClipboard();
  return (
    <Actions>
      <Action onClick={onRetry} label="Retry">
        <RefreshCcwIcon className="size-4" />
      </Action>
      <Action
        onClick={() => handleCopy(errorMessage, "error")}
        label={copiedMessageId === "error" ? "Copied!" : "Copy"}
        disabled={!(status === "ready" || status === "error")}
      >
        {copiedMessageId === "error" ? (
          <CheckIcon className="size-4" />
        ) : (
          <CopyIcon className="size-4" />
        )}
      </Action>
    </Actions>
  );
}

// Individual action components for more granular control
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
    <Action
      className={className}
      onClick={() => handleCopy(text, messageId)}
      label={copiedMessageId === messageId ? "Copied!" : "Copy"}
    >
      {copiedMessageId === messageId ? (
        <CheckIcon className="size-4" />
      ) : (
        <CopyIcon className="size-4" />
      )}
    </Action>
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
    <Action
      className={cn(
        "transition-opacity opacity-0 group-hover:opacity-100",
        className,
      )}
      onClick={onEdit}
      label="Edit"
    >
      <PencilIcon className="size-4" />
    </Action>
  );
}

export function LikeAction({
  onLike,
  className,
}: {
  onLike: () => void;
  className?: string;
}) {
  return (
    <Action className={className} onClick={onLike} label="Like">
      <ThumbsUpIcon className="size-4" />
    </Action>
  );
}

export function DislikeAction({
  onDislike,
  className,
}: {
  onDislike: () => void;
  className?: string;
}) {
  return (
    <Action className={className} onClick={onDislike} label="Dislike">
      <ThumbsDownIcon className="size-4" />
    </Action>
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
    <Action className={className} onClick={onRetry} label="Retry">
      <RefreshCcwIcon className="size-4" />
    </Action>
  );
}
