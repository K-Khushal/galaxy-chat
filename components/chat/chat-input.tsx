import { ChatContext } from "@/components/chat/chat-context";
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
import type { AppUsage } from "@/lib/ai/usage";
import { filterValidFiles } from "@/lib/ai/utils";
import type { TypeUIMessage } from "@/lib/types";
import { cn } from "@/lib/utils";
import type { UseChatHelpers } from "@ai-sdk/react";
import type { ChatStatus, UIMessage } from "ai";
import { GlobeIcon, MicIcon, Paperclip } from "lucide-react";

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

interface ChatInputProps {
  id: string;
  messages: UIMessage[];
  setMessages: UseChatHelpers<TypeUIMessage>["setMessages"];
  sendMessage: UseChatHelpers<TypeUIMessage>["sendMessage"];
  status: ChatStatus;
  stop: () => void;
  usage?: AppUsage;
  text: string;
  setText: (text: string) => void;
  model: string;
  setModel: (model: string) => void;
  useMicrophone: boolean;
  setUseMicrophone: (useMicrophone: boolean) => void;
  useWebSearch: boolean;
  setUseWebSearch: (useWebSearch: boolean) => void;
}

export function ChatInput({
  id,
  messages,
  setMessages,
  sendMessage,
  status,
  stop,
  usage,
  text,
  setText,
  model,
  setModel,
  useMicrophone,
  setUseMicrophone,
  useWebSearch,
  setUseWebSearch,
}: ChatInputProps) {
  const handleSubmit = async (message: PromptInputMessage) => {
    window.history.replaceState({}, "", `/chat/${id}`);

    const hasText = Boolean(message.text?.trim());
    const hasAttachments = Boolean(message.files?.length);

    if (!(hasText || hasAttachments)) {
      return;
    }

    // Filter out files that are still uploading or failed to upload
    // Only include files that have been successfully uploaded to Cloudinary
    const validFiles = filterValidFiles(message.files || []);

    // Use AI SDK v5 pattern - send files directly
    sendMessage({
      text: message.text || "Sent with attachments",
      files: validFiles,
    });
    setText("");
  };

  return (
    <div className={cn("relative flex w-full flex-col gap-4")}>
      <PromptInput
        onSubmit={handleSubmit}
        className="rounded-xl border border-border bg-background p-3 shadow-xs transition-all duration-200 focus-within:border-border hover:border-muted-foreground/50"
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
              disabled={true}
              onClick={() => setUseWebSearch(!useWebSearch)}
              variant={useWebSearch ? "default" : "ghost"}
            >
              <GlobeIcon size={16} />
              <span>Search</span>
            </PromptInputButton>
            <ModelSelector value={model} onValueChange={setModel} />
          </PromptInputTools>
          <div className="flex items-center gap-2">
            <ChatContext {...{ usage }} />
            <PromptInputSubmit
              disabled={
                !(
                  status === "streaming" ||
                  status === "submitted" ||
                  text?.trim()
                )
              }
              status={status}
              onClick={
                status === "streaming" || status === "submitted"
                  ? () => stop()
                  : undefined
              }
            />
          </div>
        </PromptInputToolbar>
      </PromptInput>
    </div>
  );
}
