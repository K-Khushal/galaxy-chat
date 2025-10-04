import { cn } from "@/lib/utils";
import type { ChatStatus, UIMessage } from "ai";
import {
  AlertCircleIcon,
  CopyIcon,
  PaperclipIcon,
  PencilIcon,
  RefreshCcwIcon,
  ThumbsDownIcon,
  ThumbsUpIcon,
} from "lucide-react";
import Image from "next/image";
import { Fragment } from "react";
import { Action, Actions } from "../elements/actions";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "../elements/conversation";
import { Loader } from "../elements/loader";
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

export function ChatMessages({
  messages,
  status,
  error,
  regenerate,
}: {
  messages: UIMessage[];
  status: ChatStatus;
  error?: Error;
  regenerate?: () => void;
}) {
  return (
    <Conversation className="h-full">
      <ConversationContent>
        {messages.map((message) => (
          <div key={message.id}>
            {message.role === "assistant" &&
              message.parts.filter((part) => part.type === "source-url")
                .length > 0 && (
                <Sources>
                  <SourcesTrigger
                    count={
                      message.parts.filter((part) => part.type === "source-url")
                        .length
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
                          onClick={() =>
                            navigator.clipboard.writeText(part.text)
                          }
                          label="Copy"
                        >
                          <CopyIcon className="size-4" />
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
                            {message.id === messages.at(-1)?.id &&
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
          <Fragment>
            <Message from="system">
              <div className="text-destructive bg-destructive/10 flex flex-row gap-2 overflow-hidden rounded-lg text-sm items-center max-w-[80%] px-4 py-3">
                <AlertCircleIcon className="text-destructive" />
                <Response className="text-destructive">
                  An error occurred.
                </Response>
              </div>
            </Message>
            <Actions>
              <Action onClick={regenerate} label="Retry">
                <RefreshCcwIcon className="size-4" />
              </Action>
              <Action
                onClick={() => navigator.clipboard.writeText(error.message)}
                label="Copy"
                disabled={!(status === "ready" || status === "error")}
              >
                <CopyIcon className="size-4" />
              </Action>
            </Actions>
          </Fragment>
        )}
        {status === "submitted" && <Loader />}
      </ConversationContent>
      <ConversationScrollButton />
    </Conversation>
  );
}
