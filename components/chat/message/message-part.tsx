"use client";

import type { TypeUIMessage } from "@/lib/types";
import type { UseChatHelpers } from "@ai-sdk/react";
import type { ChatStatus } from "ai";
import { PaperclipIcon } from "lucide-react";
import Image from "next/image";
import { Fragment, lazy, Suspense, useState } from "react";
import { Message, MessageContent } from "../../elements/message";
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from "../../elements/reasoning";
import { Response } from "../../elements/response";
import { MessageActions } from "./message-action";

// Lazy load MessageEditor to prevent Mongoose model access before connection
const MessageEditor = lazy(() =>
  import("./message-editor").then((module) => ({
    default: module.MessageEditor,
  })),
);

interface MessagePartProps {
  message: TypeUIMessage;
  partIndex: number;
  part: {
    type: string;
    text?: string;
    url?: string;
    filename?: string;
    mediaType?: string;
    [key: string]: unknown;
  }; // UIMessagePart from AI SDK
  status: ChatStatus;
  isLastMessage: boolean;
  regenerate: () => void;
  setMessages: UseChatHelpers<TypeUIMessage>["setMessages"];
}

export function MessagePart({
  message,
  partIndex,
  part,
  status,
  isLastMessage,
  regenerate,
  setMessages,
}: MessagePartProps) {
  const isLastPart = partIndex === message.parts.length - 1;

  const [mode, setMode] = useState<string>("read");

  switch (part.type) {
    case "text":
      if (mode === "edit") {
        return (
          <Fragment key={`${message.id}-${partIndex}`}>
            <Suspense fallback={<div>Loading editor...</div>}>
              <MessageEditor
                message={message}
                setMode={setMode}
                setMessages={setMessages}
                regenerate={regenerate}
              />
            </Suspense>
          </Fragment>
        );
      } else {
        return (
          <Fragment key={`${message.id}-${partIndex}`}>
            <Message from={message.role} className="py-1">
              <MessageContent variant="flat">
                <Response>{part.text || ""}</Response>
              </MessageContent>
            </Message>
            <MessageActions
              messageRole={message.role}
              messageId={message.id}
              text={part.text || ""}
              isLastMessage={isLastMessage}
              isLastPart={isLastPart}
              onRetry={regenerate}
              onEdit={() => setMode("edit")}
            />
          </Fragment>
        );
      }

    case "file":
      return (
        <Message from={message.role} key={`${message.id}-${partIndex}`}>
          {part.mediaType?.startsWith("image/") && part.url ? (
            <Image
              alt={part.filename || "attachment"}
              className="size-full rounded-md object-cover h-14 w-14 border"
              height={56}
              src={part.url}
              width={56}
              unoptimized={part.url.startsWith("blob:")}
            />
          ) : (
            <div className="flex size-full items-center justify-center text-muted-foreground">
              <PaperclipIcon className="size-4" />
            </div>
          )}
        </Message>
      );

    case "reasoning":
      return (
        <Reasoning
          key={`${message.id}-${partIndex}`}
          className="w-full"
          isStreaming={status === "streaming" && isLastPart && isLastMessage}
        >
          <ReasoningTrigger />
          <ReasoningContent>{part.text || ""}</ReasoningContent>
        </Reasoning>
      );

    default:
      return null;
  }
}

// Individual part components for more granular control
export function TextPart({
  message,
  part,
  partIndex,
  isLastMessage,
  isLastPart,
  regenerate,
}: {
  message: TypeUIMessage;
  part: { type: "text"; text: string };
  partIndex: number;
  isLastMessage: boolean;
  isLastPart: boolean;
  regenerate?: () => void;
}) {
  return (
    <Fragment key={`${message.id}-${partIndex}`}>
      <Message from={message.role} className="py-1">
        <MessageContent>
          <Response>{part.text || ""}</Response>
        </MessageContent>
      </Message>
      <MessageActions
        messageRole={message.role}
        messageId={message.id}
        text={part.text || ""}
        isLastMessage={isLastMessage}
        isLastPart={isLastPart}
        onRetry={regenerate}
      />
    </Fragment>
  );
}

export function FilePart({
  message,
  part,
  partIndex,
}: {
  message: TypeUIMessage;
  part: {
    type: "file";
    url?: string;
    filename?: string;
    mediaType?: string;
  };
  partIndex: number;
}) {
  return (
    <Message from={message.role} key={`${message.id}-${partIndex}`}>
      {part.mediaType?.startsWith("image/") && part.url ? (
        <Image
          alt={part.filename || "attachment"}
          className="size-full rounded-md object-cover h-14 w-14 border"
          height={56}
          src={part.url}
          width={56}
          unoptimized={part.url.startsWith("blob:")}
        />
      ) : (
        <div className="flex size-full items-center justify-center text-muted-foreground">
          <PaperclipIcon className="size-4" />
        </div>
      )}
    </Message>
  );
}

export function ReasoningPart({
  message,
  part,
  partIndex,
  status,
  isLastMessage,
  isLastPart,
}: {
  message: TypeUIMessage;
  part: { type: "reasoning"; text: string };
  partIndex: number;
  status: ChatStatus;
  isLastMessage: boolean;
  isLastPart: boolean;
}) {
  return (
    <Reasoning
      key={`${message.id}-${partIndex}`}
      className="w-full"
      isStreaming={status === "streaming" && isLastPart && isLastMessage}
    >
      <ReasoningTrigger />
      <ReasoningContent>{part.text}</ReasoningContent>
    </Reasoning>
  );
}
