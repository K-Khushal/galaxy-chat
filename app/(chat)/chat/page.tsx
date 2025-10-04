"use client";

import { ChatInput } from "@/components/chat/chat-input";
import { ChatMessages } from "@/components/chat/chat-messages";
import type { PromptInputMessage } from "@/components/elements/prompt-input";
import { chatModels } from "@/lib/ai/model";
import { filterValidFiles, getChatErrorMessage } from "@/lib/ai/utils";
import { useChat } from "@ai-sdk/react";
import { useState } from "react";
import { toast } from "sonner";

const models = [
  {
    name: "Grok 4 Fast",
    value: "x-ai/grok-4-fast:free",
  },
  {
    name: "Deepseek R1",
    value: "deepseek/deepseek-r1:free",
  },
  {
    name: "GPT OSS 120B",
    value: "openai/gpt-oss-120b:free",
  },
  {
    name: "Gemini 2.0 Flash Exp",
    value: "google/gemini-2.0-flash-exp:free",
  },
  {
    name: "Z AI GLM 4.5 Air",
    value: "z-ai/glm-4.5-air:free",
  },
  {
    name: "Mistral Small",
    value: "mistralai/mistral-small-3.2-24b-instruct:free",
  },
];

const ChatBotDemo = () => {
  const [text, setText] = useState<string>("");
  const [model, setModel] = useState<string>(
    chatModels.find((m) => m.available)?.id || "",
  );
  const [useMicrophone, setUseMicrophone] = useState<boolean>(false);
  const [useWebSearch, setUseWebSearch] = useState<boolean>(false);

  const { messages, sendMessage, status, stop, error, regenerate } = useChat({
    onError: (error) => {
      console.error("Chat API error:", error);
      const errorMessage = getChatErrorMessage(error);
      toast.error("Failed to send message", {
        description: errorMessage,
        closeButton: true,
      });
    },
  });

  const handleSubmit = async (message: PromptInputMessage) => {
    const hasText = Boolean(message.text?.trim());
    const hasAttachments = Boolean(message.files?.length);

    if (!(hasText || hasAttachments)) {
      return;
    }

    // Filter out files that are still uploading or failed to upload
    // Only include files that have been successfully uploaded to Cloudinary
    const validFiles = filterValidFiles(message.files || []);

    // Use AI SDK v5 pattern - send files directly
    sendMessage(
      {
        text: message.text || "Sent with attachments",
        files: validFiles,
      },
      {
        body: {
          model: model,
          webSearch: useWebSearch,
        },
      },
    );
    setText("");
  };

  // console.log(messages);

  return (
    <div className="max-w-4xl mx-auto p-6 relative size-full h-full overscroll-none">
      <div className="flex flex-col h-full">
        <ChatMessages
          messages={messages}
          status={status}
          error={error}
          regenerate={regenerate}
        />
      </div>
      <div className="sticky bottom-0 pb-4 bg-background">
        <ChatInput
          messages={messages}
          sendMessage={sendMessage}
          status={status}
          stop={stop}
          onSubmit={handleSubmit}
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
};

export default ChatBotDemo;
