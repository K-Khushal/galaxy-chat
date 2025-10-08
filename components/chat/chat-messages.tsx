import { TextShimmer } from "@/components/ui/text-shimmer";
import type { TypeUIMessage } from "@/lib/types";
import type { UseChatHelpers } from "@ai-sdk/react";
import type { ChatStatus } from "ai";
import { AlertCircleIcon, ArrowDownIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Conversation, ConversationContent } from "../elements/conversation";
import { Message } from "../elements/message";
import { Response } from "../elements/response";
import {
  Source,
  Sources,
  SourcesContent,
  SourcesTrigger,
} from "../elements/sources";
import { ChatGreeting } from "./chat-greeting";
import { ErrorActions } from "./message/message-action";
import { MessagePart } from "./message/message-part";

export function ChatMessages({
  messages,
  status,
  error,
  regenerate,
  setMessages,
}: {
  messages: TypeUIMessage[];
  status: ChatStatus;
  error?: Error;
  regenerate: () => void;
  setMessages: UseChatHelpers<TypeUIMessage>["setMessages"];
}) {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);

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
              {message.parts.map((part, i) => (
                <MessagePart
                  key={`${message.id}-${i}`}
                  message={message}
                  partIndex={i}
                  part={part}
                  status={status}
                  isLastMessage={message.id === messages.at(-1)?.id}
                  regenerate={regenerate}
                  setMessages={setMessages}
                />
              ))}
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
                <ErrorActions
                  errorMessage={error.message}
                  status={status}
                  onRetry={regenerate || (() => {})}
                />
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
