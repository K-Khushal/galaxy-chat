import { ChatStatus, UIMessage } from "ai";
import { CopyIcon, PaperclipIcon, RefreshCcwIcon } from "lucide-react";
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
  retryLast,
}: {
  messages: UIMessage[];
  status: ChatStatus;
  retryLast: () => void;
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
                      <Message from={message.role}>
                        <MessageContent>
                          <Response>{part.text}</Response>
                        </MessageContent>
                      </Message>
                      {message.role === "assistant" &&
                        message.id === messages.at(-1)?.id &&
                        i === message.parts.length - 1 && (
                          <Actions className="mt-2">
                            <Action onClick={retryLast} label="Retry">
                              <RefreshCcwIcon className="size-3" />
                            </Action>
                            <Action
                              onClick={() =>
                                navigator.clipboard.writeText(part.text)
                              }
                              label="Copy"
                            >
                              <CopyIcon className="size-3" />
                            </Action>
                          </Actions>
                        )}
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
        {status === "submitted" && <Loader />}
      </ConversationContent>
      <ConversationScrollButton />
    </Conversation>
  );
}
