"use client";

import { ChatInput } from "@/components/chat/chat-input";
import { ChatMessages } from "@/components/chat/chat-messages";
import type { PromptInputMessage } from "@/components/elements/prompt-input";
import { chatModels } from "@/lib/ai/model";
import { filterValidFiles, getChatErrorMessage } from "@/lib/ai/utils";
import { useChat } from "@ai-sdk/react";
import { useState } from "react";
import { toast } from "sonner";

const Chat = () => {
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
    <div className="overscroll-behavior-contain flex h-dvh min-w-0 touch-pan-y flex-col bg-background">
      <ChatMessages
        messages={messages}
        status={status}
        error={error}
        regenerate={regenerate}
      />
      <div className="sticky bottom-0 z-1 mx-auto flex w-full max-w-4xl gap-2 border-t-0 bg-background px-2 pb-3 md:px-4 md:pb-4">
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

export default Chat;
