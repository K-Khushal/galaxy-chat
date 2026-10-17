"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { nanoid } from "nanoid";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ChatInput } from "@/components/chat/chat-input";
import { ChatMessages } from "@/components/chat/chat-messages";
import { ChatHeader } from "@/components/shell/chat-header";
import type { AppUsage } from "@/lib/ai/usage";
import { fetchWithErrorHandling, getChatErrorMessage } from "@/lib/ai/utils";
import type { TypeUIMessage } from "@/lib/types";
import { defaultAvailability } from "@/lib/ui/availability";

export default function Chat({
  id,
  chatMessages,
  lastContext,
  title,
}: {
  id: string;
  chatMessages: TypeUIMessage[];
  lastContext?: AppUsage;
  title?: string;
}) {
  const [text, setText] = useState<string>("");
  const [usage, setUsage] = useState<AppUsage | undefined>(lastContext);
  const [model, setModel] = useState("");
  const modelRef = useRef(model);

  const {
    messages,
    setMessages,
    sendMessage,
    status,
    stop,
    error,
    regenerate,
  } = useChat<TypeUIMessage>({
    id,
    messages: chatMessages,
    experimental_throttle: 100,
    generateId: nanoid,
    transport: new DefaultChatTransport({
      api: "/api/chat",
      fetch: fetchWithErrorHandling as typeof fetch,
      prepareSendMessagesRequest: (request) => {
        return {
          body: {
            id: request.id,
            message: request.messages.at(-1),
            model: modelRef.current,
            visibility: "private",
            webSearch: false,
            ...request.body,
          },
        };
      },
    }),
    onData: (data) => {
      if (data.type === "data-usage") {
        setUsage(data.data as AppUsage);
      }
    },
    onFinish: () => {
      // Ensure URL is updated to show the current chat
      window.history.replaceState({}, "", `/chat/${id}`);

      // Dispatch custom event to trigger sidebar update
      window.dispatchEvent(
        new CustomEvent("chat-created", { detail: { chatId: id } }),
      );
    },
    onError: (error) => {
      const errorMessage = getChatErrorMessage(error);
      toast.error("Failed to send message", {
        description: errorMessage,
        closeButton: true,
      });
    },
  });

  const searchParams = useSearchParams();
  const query = searchParams.get("query");

  const [hasAppendedQuery, setHasAppendedQuery] = useState(false);

  useEffect(() => {
    if (query && !hasAppendedQuery) {
      setText(query);
      setHasAppendedQuery(true);
      window.history.replaceState({}, "", `/chat/${id}`);
    }
  }, [query, hasAppendedQuery, id]);

  useEffect(() => {
    modelRef.current = model;
  }, [model]);

  return (
    <div className="flex h-dvh min-h-0 min-w-0 flex-col bg-background">
      <ChatHeader
        title={title ?? "New conversation"}
        onNewChat={() => {
          window.location.assign("/chat");
        }}
      />
      <ChatMessages
        key={id}
        setMessages={setMessages}
        messages={messages}
        status={status}
        error={error}
        regenerate={regenerate}
        onPrompt={(prompt) => {
          setText(prompt);
          document.getElementById("chat-composer")?.focus();
        }}
      />
      <div className="mx-auto w-full max-w-3xl shrink-0 px-3 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:px-6">
        <ChatInput
          onSend={async (draft) => {
            await sendMessage({
              role: "user",
              parts: [{ type: "text", text: draft }],
            });
          }}
          availability={defaultAvailability}
          status={status}
          stop={stop}
          usage={usage}
          text={text}
          setText={setText}
          model={model}
          setModel={setModel}
        />
      </div>
    </div>
  );
}
