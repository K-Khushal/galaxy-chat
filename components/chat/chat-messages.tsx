import { TextShimmer } from "@/components/ui/text-shimmer";
import type { TypeUIMessage } from "@/lib/types";
import { cn } from "@/lib/utils";
import type { ChatStatus } from "ai";
import {
  AlertCircleIcon,
  ArrowDownIcon,
  CheckIcon,
  CopyIcon,
  PaperclipIcon,
  PencilIcon,
  RefreshCcwIcon,
  ThumbsDownIcon,
  ThumbsUpIcon,
} from "lucide-react";
import Image from "next/image";
import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { Action, Actions } from "../elements/actions";
import { Conversation, ConversationContent } from "../elements/conversation";
import { Message, MessageContent } from "../elements/message";
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from "../elements/reasoning";
import { Response } from "../elements/response";
import {
  Source,
  Sources,
  SourcesContent,
  SourcesTrigger,
} from "../elements/sources";
import { ChatGreeting } from "./chat-greeting";

export function ChatMessages({
  messages,
  status,
  error,
  regenerate,
}: {
  messages: TypeUIMessage[];
  status: ChatStatus;
  error?: Error;
  regenerate?: () => void;
}) {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  const checkIfAtBottom = useCallback(() => {
    if (!containerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
    const isNearBottom = scrollTop + clientHeight >= scrollHeight - 100;
    setIsAtBottom(isNearBottom);
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    container.addEventListener("scroll", checkIfAtBottom);
    checkIfAtBottom();

    return () => container.removeEventListener("scroll", checkIfAtBottom);
  }, [checkIfAtBottom]);

  // Auto-scroll only when at bottom and content changes
  useEffect(() => {
    if (isAtBottom) {
      scrollToBottom();
    }
  }, [isAtBottom, scrollToBottom]);

  // Handle copy feedback
  const handleCopy = async (text: string, messageId: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedMessageId(messageId);

      // Reset the copied state after 2 seconds
      setTimeout(() => {
        setCopiedMessageId(null);
      }, 1000);
    } catch (err) {
      console.error("Failed to copy text: ", err);
    }
  };

  return (
    <div
      ref={containerRef}
      className="overscroll-behavior-contain -webkit-overflow-scrolling-touch flex-1 touch-pan-y overflow-y-scroll"
    >
      <Conversation className="mx-auto flex min-w-0 max-w-4xl flex-col gap-4 md:gap-6">
        <ConversationContent className="flex flex-col gap-4 px-2 py-4 md:gap-6 md:px-4">
          {messages.length === 0 && <ChatGreeting />}
          {messages.map((message) => (
            <div key={message.id}>
              {message.role === "assistant" &&
                message.parts.filter((part) => part.type === "source-url")
                  .length > 0 && (
                  <Sources>
                    <SourcesTrigger
                      count={
                        message.parts.filter(
                          (part) => part.type === "source-url",
                        ).length
                      }
                    />
                    {message.parts
                      .filter((part) => part.type === "source-url")
                      .map((part, i) => (
                        <SourcesContent key={`${message.id}-${i}`}>
                          <Source
                            key={`${message.id}-${i}`}
                            href={part.url}
                            title={part.url}
                          />
                        </SourcesContent>
                      ))}
                  </Sources>
                )}
              {message.parts.map((part, i) => {
                switch (part.type) {
                  case "text":
                    return (
                      <Fragment key={`${message.id}-${i}`}>
                        <Message from={message.role} className="py-1">
                          <MessageContent>
                            <Response>{part.text}</Response>
                          </MessageContent>
                        </Message>
                        <Actions
                          className={cn(
                            "group flex w-full",
                            message.role !== "user" &&
                              "items-start justify-start",
                            message.role === "user" && "items-end justify-end",
                          )}
                          // className="group flex w-full items-end justify-end gap-2 py-4"
                        >
                          {/* Always show */}
                          <Action
                            className={cn(
                              message.role === "user" &&
                                "transition-opacity opacity-0 group-hover:opacity-100",
                            )}
                            onClick={() => handleCopy(part.text, message.id)}
                            label={
                              copiedMessageId === message.id
                                ? "Copied!"
                                : "Copy"
                            }
                          >
                            {copiedMessageId === message.id ? (
                              <CheckIcon className="size-4" />
                            ) : (
                              <CopyIcon className="size-4" />
                            )}
                          </Action>

                          {message.role === "user" && (
                            <Action
                              className="transition-opacity opacity-0 group-hover:opacity-100"
                              label="Edit"
                            >
                              <PencilIcon className="size-4" />
                            </Action>
                          )}

                          {message.role === "assistant" && (
                            <>
                              <Action label="Like">
                                <ThumbsUpIcon className="size-4" />
                              </Action>
                              <Action label="Dislike">
                                <ThumbsDownIcon className="size-4" />
                              </Action>
                              {/* Retry only for the last message & last part */}
                              {regenerate &&
                                message.id === messages.at(-1)?.id &&
                                i === message.parts.length - 1 && (
                                  <Action onClick={regenerate} label="Retry">
                                    <RefreshCcwIcon className="size-4" />
                                  </Action>
                                )}
                            </>
                          )}
                        </Actions>
                      </Fragment>
                    );
                  case "file":
                    return (
                      <Message from={message.role} key={`${message.id}-${i}`}>
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
                        key={`${message.id}-${i}`}
                        className="w-full"
                        isStreaming={
                          status === "streaming" &&
                          i === message.parts.length - 1 &&
                          message.id === messages.at(-1)?.id
                        }
                      >
                        <ReasoningTrigger />
                        <ReasoningContent>{part.text}</ReasoningContent>
                      </Reasoning>
                    );
                  default:
                    return null;
                }
              })}
            </div>
          ))}
          {error && (
            <Message from="system">
              <div className="flex flex-col max-w-[80%] gap-1">
                <div className="text-destructive bg-destructive/10 flex flex-row gap-2 overflow-hidden rounded-lg text-sm items-center px-4 py-3">
                  <AlertCircleIcon className="text-destructive" />
                  <Response className="text-destructive">
                    An error occurred.
                  </Response>
                </div>
                <Actions>
                  <Action onClick={regenerate} label="Retry">
                    <RefreshCcwIcon className="size-4" />
                  </Action>
                  <Action
                    onClick={() => handleCopy(error.message, "error")}
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
              </div>
            </Message>
          )}
          {status === "submitted" && (
            <div className="flex flex-row items-center justify-start ml-2">
              <TextShimmer className="font-mono text-sm" duration={1}>
                Generating...
              </TextShimmer>
            </div>
          )}
          <div ref={messagesEndRef} />
        </ConversationContent>
      </Conversation>

      {!isAtBottom && (
        <button
          aria-label="Scroll to bottom"
          className="-translate-x-1/2 absolute bottom-40 left-1/2 z-10 rounded-full border bg-background p-2 shadow-lg transition-colors hover:bg-muted"
          onClick={scrollToBottom}
          type="button"
        >
          <ArrowDownIcon className="size-4" />
        </button>
      )}
    </div>
  );
}
