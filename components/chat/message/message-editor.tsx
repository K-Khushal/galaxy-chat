"use client";

import { deleteChatMessages } from "@/app/(chat)/action";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { getTextMessage } from "@/lib/ai/utils";
import type { TypeUIMessage } from "@/lib/types";
import type { UseChatHelpers } from "@ai-sdk/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

export type MessageEditorProps = {
  message: TypeUIMessage;
  setMode: (text: string) => void;
  setMessages: UseChatHelpers<TypeUIMessage>["setMessages"];
  regenerate: () => void;
};

export function MessageEditor({
  message,
  setMode,
  setMessages,
  regenerate,
}: MessageEditorProps) {
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  const [draftContent, setDraftContent] = useState<string>(
    getTextMessage(message),
  );
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const adjustHeight = useCallback(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight + 2}px`;
    }
  }, []);

  useEffect(() => {
    if (textareaRef.current) {
      adjustHeight();
    }
  }, [adjustHeight]);

  const handleInput = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    setDraftContent(event.target.value);
    adjustHeight();
  };

  const handleSendMessage = async () => {
    if (draftContent.trim() === "" || isSubmitting) {
      return;
    }

    setIsSubmitting(true);

    try {
      await deleteChatMessages(message.id);

      setMessages((messages) => {
        const index = messages.findIndex((m) => m.id === message.id);

        if (index !== -1) {
          const updatedMessage: TypeUIMessage = {
            ...message,
            parts: [{ type: "text", text: draftContent }],
          };

          return [...messages.slice(0, index), updatedMessage];
        }

        return messages;
      });

      setMode("view");
      regenerate();
    } catch (error) {
      toast.error("Failed to edit message", {
        description: error as string,
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      handleSendMessage();
    }
  };

  return (
    <div className="relative w-full">
      {/* Light gray container with rounded corners */}
      <div className="relative rounded-xl bg-secondary p-4">
        <Textarea
          className="w-full resize-none overflow-hidden bg-transparent text-base outline-none focus-visible:ring-0 border-0 shadow-none min-h-[60px]"
          data-testid="message-editor"
          onChange={handleInput}
          onKeyDown={handleKeyDown}
          ref={textareaRef}
          value={draftContent}
          placeholder="Type your message..."
        />

        {/* Buttons positioned at bottom-right */}
        <div className="absolute bottom-4 right-4 flex flex-row gap-2">
          <Button
            className="h-8 px-3 py-2 rounded-lg cursor-pointer"
            onClick={() => {
              setMode("view");
            }}
            variant="outline"
          >
            Cancel
          </Button>
          <Button
            className="h-8 px-3 py-2 rounded-lg cursor-pointer"
            data-testid="message-editor-send-button"
            disabled={isSubmitting}
            onClick={handleSendMessage}
            variant="default"
          >
            {isSubmitting ? "Sending..." : "Send"}
          </Button>
        </div>
      </div>
    </div>
  );
}
