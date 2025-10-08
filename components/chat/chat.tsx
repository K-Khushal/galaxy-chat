"use client";

import { ChatInput } from "@/components/chat/chat-input";
import { ChatMessages } from "@/components/chat/chat-messages";
import { chatModels } from "@/lib/ai/model";
import type { AppUsage } from "@/lib/ai/usage";
import { fetchWithErrorHandling, getChatErrorMessage } from "@/lib/ai/utils";
import type { TypeUIMessage } from "@/lib/types";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { unstable_serialize, useSWRConfig } from "swr";
import { v4 as uuidv4 } from "uuid";
import { getPaginatedChatHistory } from "../sidebar/sidebar-history";

export default function Chat({
  id,
  chatMessages,
  lastContext,
}: {
  id: string;
  chatMessages: TypeUIMessage[];
  lastContext?: AppUsage;
}) {
  const { mutate } = useSWRConfig();
  const [text, setText] = useState<string>("");
  const [usage, setUsage] = useState<AppUsage | undefined>(lastContext);
  const [model, setModel] = useState<string>(
    chatModels.find((m) => m.available)?.id || "",
  );
  const modelRef = useRef(model);
  const [useMicrophone, setUseMicrophone] = useState<boolean>(false);
  const [useWebSearch, setUseWebSearch] = useState<boolean>(false);

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
    generateId: uuidv4,
    transport: new DefaultChatTransport({
      api: "/api/chat",
      fetch: fetchWithErrorHandling,
      prepareSendMessagesRequest: (request) => {
        return {
          body: {
            id: request.id,
            message: request.messages.at(-1),
            model: modelRef.current,
            visibility: "private",
            webSearch: useWebSearch,
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
      mutate(unstable_serialize(getPaginatedChatHistory));
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
      sendMessage({
        role: "user" as const,
        parts: [{ type: "text", text: query }],
      });

      setHasAppendedQuery(true);
      window.history.replaceState({}, "", `/chat/${id}`);
    }
  }, [query, sendMessage, hasAppendedQuery, id]);

  useEffect(() => {
    modelRef.current = model;
  }, [model]);

  return (
    <div className="overscroll-behavior-contain flex h-dvh min-w-0 touch-pan-y flex-col bg-background">
      <ChatMessages
        setMessages={setMessages}
        messages={messages}
        status={status}
        error={error}
        regenerate={regenerate}
      />
      <div className="sticky bottom-0 z-1 mx-auto flex w-full max-w-4xl gap-2 border-t-0 bg-background px-2 pb-3 md:px-4 md:pb-4">
        <ChatInput
          id={id}
          messages={messages}
          setMessages={setMessages}
          sendMessage={sendMessage}
          status={status}
          stop={stop}
          usage={usage}
          text={text}
          setText={setText}
          model={model}
          setModel={setModel}
          useMicrophone={useMicrophone}
          setUseMicrophone={setUseMicrophone}
          useWebSearch={useWebSearch}
          setUseWebSearch={setUseWebSearch}
        />
      </div>
    </div>
  );
}
