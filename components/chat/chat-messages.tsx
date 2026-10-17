"use client";
import type { UseChatHelpers } from "@ai-sdk/react";
import type { ChatStatus } from "ai";
import { ArrowDown, Loader2, Sparkles, TriangleAlert } from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { ErrorActions } from "@/components/chat/message/message-action";
import { MessagePart } from "@/components/chat/message/message-part";
import {
  Source,
  Sources,
  SourcesContent,
  SourcesTrigger,
} from "@/components/elements/sources";
import { EmptyConversation } from "@/components/shell/empty-conversation";
import { Button } from "@/components/ui/button";
import { getChatErrorMessage } from "@/lib/ai/utils";
import type { TypeUIMessage } from "@/lib/types";
import { prefersReducedMotion, scrollBehavior } from "@/lib/ui/motion";

export function ChatMessages({
  messages,
  status,
  error,
  regenerate,
  setMessages,
  onPrompt,
  actionsEnabled = false,
  onEdit,
}: {
  messages: TypeUIMessage[];
  status: ChatStatus;
  error?: Error;
  regenerate: () => void;
  setMessages: UseChatHelpers<TypeUIMessage>["setMessages"];
  onPrompt?: (text: string) => void;
  actionsEnabled?: boolean;
  onEdit?: (messageId: string, text: string) => Promise<boolean>;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  const [atBottom, setAtBottom] = useState(true);
  const previousStatus = useRef(status);
  const [announcement, setAnnouncement] = useState("");
  useEffect(() => {
    if (status === "submitted") setAnnouncement("Preparing a response.");
    else if (status === "streaming") setAnnouncement("Receiving a response.");
    else if (
      status === "ready" &&
      (previousStatus.current === "streaming" ||
        previousStatus.current === "submitted")
    )
      setAnnouncement("Response ended.");
    else if (status === "error") setAnnouncement("");
    previousStatus.current = status;
  }, [status]);
  const scrollToBottom = useCallback((smooth = true) => {
    const container = containerRef.current;
    if (!container) return;
    container.scrollTo({
      top: container.scrollHeight,
      behavior: smooth ? scrollBehavior(prefersReducedMotion()) : "instant",
    });
  }, []);
  useLayoutEffect(() => {
    if (messages.length === 0) {
      containerRef.current?.scrollTo({ top: 0, behavior: "instant" });
      return;
    }
    if (following.current && status) scrollToBottom(false);
  }, [messages, status, scrollToBottom]);
  useEffect(() => {
    const content = contentRef.current;
    if (!content || messages.length === 0) return;
    const observer = new ResizeObserver(() => {
      if (following.current) scrollToBottom(false);
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, [scrollToBottom, messages.length]);
  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <output aria-live="polite" aria-atomic="true" className="sr-only">
        {announcement}
      </output>
      <div
        ref={containerRef}
        role="log"
        aria-live="off"
        // biome-ignore lint/a11y/noNoninteractiveTabindex: The scroll region must be keyboard-scrollable.
        tabIndex={0}
        aria-label="Conversation messages"
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain focus-visible:outline-2 focus-visible:outline-ring"
        onScroll={() => {
          const container = containerRef.current;
          if (!container) return;
          const near =
            container.scrollHeight -
              container.scrollTop -
              container.clientHeight <
            80;
          following.current = near;
          setAtBottom(near);
        }}
      >
        <div
          ref={contentRef}
          className="mx-auto flex min-h-full w-full min-w-0 max-w-3xl flex-col gap-8 px-5 py-8 md:px-8"
        >
          {messages.length === 0 && <EmptyConversation onPrompt={onPrompt} />}
          {messages.map((message) => {
            const sources = message.parts.filter(
              (part) => part.type === "source-url",
            );
            return (
              <article
                key={message.id}
                aria-label={
                  message.role === "user" ? "Your message" : "Galaxy response"
                }
                className="min-w-0"
              >
                {message.role === "assistant" && (
                  <p className="mb-3 flex items-center gap-2 text-xs font-medium text-muted-foreground">
                    <Sparkles
                      className="size-3.5 text-primary"
                      aria-hidden="true"
                    />
                    Galaxy
                  </p>
                )}
                {sources.length > 0 && (
                  <Sources>
                    <SourcesTrigger count={sources.length} />
                    <SourcesContent>
                      {sources.map((part) => (
                        <Source
                          key={part.sourceId}
                          href={part.url}
                          title={part.title ?? part.url}
                        />
                      ))}
                    </SourcesContent>
                  </Sources>
                )}
                {message.parts
                  .filter((part) => part.type === "data-attachments")
                  .map((part) => (
                    <div
                      key="attachment-provenance"
                      className="mb-2 rounded-lg border border-border p-3 text-xs text-muted-foreground"
                    >
                      <p className="font-medium">
                        Files sent with this request
                      </p>
                      <ul>
                        {part.data.sources.map((source) => (
                          <li
                            key={source.id}
                            className="break-words [overflow-wrap:anywhere]"
                          >
                            {source.name}
                            {source.pages ? ` · ${source.pages} pages` : ""} ·
                            source {source.id}
                          </li>
                        ))}
                      </ul>
                      <p className="mt-1">
                        Untrusted source data; citations can refer to the
                        attachment id and PDF page.
                      </p>
                    </div>
                  ))}
                {message.parts.map((part, index) => (
                  <MessagePart
                    key={`${message.id}-${index}`}
                    message={message}
                    partIndex={index}
                    part={part}
                    status={status}
                    isLastMessage={message.id === messages.at(-1)?.id}
                    regenerate={regenerate}
                    setMessages={setMessages}
                    onEdit={onEdit}
                    actionsEnabled={
                      actionsEnabled &&
                      status !== "streaming" &&
                      status !== "submitted"
                    }
                  />
                ))}
              </article>
            );
          })}
          {status === "submitted" && (
            <p className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
              <Loader2 aria-hidden="true" className="size-4 animate-spin" />
              Preparing a response…
            </p>
          )}
          {status === "streaming" && (
            <p className="text-xs text-muted-foreground">
              Response in progress. You can stop it below.
            </p>
          )}
          {error && (
            <div
              role="alert"
              className="rounded-xl border border-destructive/30 bg-destructive/5 p-4"
            >
              <h2 className="flex items-center gap-2 text-sm font-medium">
                <TriangleAlert
                  className="size-4 shrink-0 text-destructive"
                  aria-hidden="true"
                />
                The response could not finish
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                {getChatErrorMessage(error)}
              </p>
              <ErrorActions
                errorMessage={error.message}
                status={status}
                onRetry={regenerate}
                retryEnabled={actionsEnabled}
              />
            </div>
          )}
        </div>
      </div>
      {!atBottom && messages.length > 0 && (
        <Button
          variant="outline"
          className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-popover shadow-md"
          onClick={() => {
            following.current = true;
            scrollToBottom();
          }}
        >
          <ArrowDown className="size-4" />
          Latest message
        </Button>
      )}
    </div>
  );
}
