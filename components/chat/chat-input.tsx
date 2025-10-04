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
  messages: UIMessage[];
  sendMessage: (
    message: { text: string; files?: any[] },
    options?: any,
  ) => void;
  status: ChatStatus;
  stop: () => void;
  onSubmit: (message: PromptInputMessage) => Promise<void>;
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
  messages,
  sendMessage,
  status,
  stop,
  onSubmit,
  text,
  setText,
  model,
  setModel,
  useMicrophone,
  setUseMicrophone,
  useWebSearch,
  setUseWebSearch,
}: ChatInputProps) {
  return (
    <PromptInput
      onSubmit={onSubmit}
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
          <ChatContext />
          <PromptInputSubmit
            disabled={
              !(status === "streaming" || status === "submitted" || text)
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
  );
}
