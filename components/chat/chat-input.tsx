import { ModelSelector } from "@/components/chat/model-selector";
import {
  PromptInput,
  PromptInputAttachment,
  PromptInputAttachments,
  PromptInputBody,
  PromptInputButton,
  type PromptInputMessage,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputToolbar,
  PromptInputTools,
  usePromptInputAttachments,
} from "@/components/elements/prompt-input";
import { chatModels } from "@/lib/ai/model";
import { useChat } from "@ai-sdk/react";
import type { FileUIPart } from "ai";
import { GlobeIcon, MicIcon, Paperclip } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

function AddAttachmentButton() {
  const attachments = usePromptInputAttachments();

  return (
    <PromptInputButton
      onClick={(e) => {
        e.preventDefault();
        attachments.openFileDialog();
      }}
      variant="ghost"
    >
      <Paperclip size={16} />
      <span className="sr-only">Add photos</span>
    </PromptInputButton>
  );
}

export function ChatInput() {
  const [text, setText] = useState<string>("");
  const [model, setModel] = useState<string>(
    chatModels.find((m) => m.available)?.id || "",
  );

  const [useMicrophone, setUseMicrophone] = useState<boolean>(false);
  const [useWebSearch, setUseWebSearch] = useState<boolean>(false);

  const { messages, sendMessage, status } = useChat({
    onError: (error) => {
      console.error("Chat API error:", error);

      // Handle specific error types based on OpenRouter error patterns
      let errorMessage =
        "An error occurred while processing your request. Please try again.";

      if (
        error.message.includes("No endpoints found that support image input")
      ) {
        errorMessage =
          "The selected model doesn't support image input. Please try a different model or remove the image.";
      } else if (
        error.message.includes("model is too busy") ||
        error.message.includes("rate limit") ||
        error.message.includes("busy")
      ) {
        errorMessage =
          "The model is currently busy. Please try again in a moment.";
      } else if (
        error.message.includes("API key") ||
        error.message.includes("unauthorized")
      ) {
        errorMessage = "API configuration error. Please contact support.";
      } else if (
        error.message.includes("network") ||
        error.message.includes("fetch") ||
        error.message.includes("timeout")
      ) {
        errorMessage =
          "Network error. Please check your connection and try again.";
      } else if (
        error.message.includes("quota") ||
        error.message.includes("limit")
      ) {
        errorMessage = "Usage limit reached. Please try again later.";
      } else if (
        error.message.includes("invalid") ||
        error.message.includes("malformed")
      ) {
        errorMessage =
          "Invalid request. Please check your input and try again.";
      }

      toast.error("Failed to send message", {
        description: errorMessage,
        closeButton: true,
      });
    },
  });

  const filterValidFiles = (files: FileUIPart[]) => {
    return files.filter((file) => {
      // Check if file has a valid URL (not a blob URL)
      const hasValidUrl = file.url && !file.url.startsWith("blob:");

      // Check upload status if available
      const uploadStatus = (file as { uploadStatus?: string }).uploadStatus;
      const isUploaded = !uploadStatus || uploadStatus === "completed";

      return hasValidUrl && isUploaded;
    });
  };

  const retryLast = () => {
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    if (!lastUser) return;

    // Extract text and files from the last user message
    const text = lastUser.parts?.find((p) => p.type === "text")?.text || "";
    const files = lastUser.parts?.filter((p) => p.type === "file") || [];

    sendMessage({ text, files }, { body: { model, webSearch: useWebSearch } });
  };

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

  console.log(messages);

  return (
    <PromptInput
      onSubmit={handleSubmit}
      className="mt-4"
      globalDrop
      multiple
      accept="image/*"
    >
      <PromptInputBody>
        <PromptInputAttachments>
          {(attachment) => <PromptInputAttachment data={attachment} />}
        </PromptInputAttachments>
        <PromptInputTextarea
          onChange={(e) => setText(e.target.value)}
          value={text}
        />
      </PromptInputBody>
      <PromptInputToolbar>
        <PromptInputTools>
          <AddAttachmentButton />
          <PromptInputButton
            disabled={true}
            onClick={() => setUseMicrophone(!useMicrophone)}
            variant={useMicrophone ? "default" : "ghost"}
          >
            <MicIcon size={16} />
            <span className="sr-only">Microphone</span>
          </PromptInputButton>
          <PromptInputButton
            onClick={() => setUseWebSearch(!useWebSearch)}
            variant={useWebSearch ? "default" : "ghost"}
          >
            <GlobeIcon size={16} />
            <span>Search</span>
          </PromptInputButton>
          <ModelSelector value={model} onValueChange={setModel} />
        </PromptInputTools>
        <PromptInputSubmit disabled={!text && !status} status={status} />
      </PromptInputToolbar>
    </PromptInput>
  );
}
