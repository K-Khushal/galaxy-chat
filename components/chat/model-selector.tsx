"use client";

import {
  PromptInputModelSelect,
  PromptInputModelSelectContent,
  PromptInputModelSelectItem,
  PromptInputModelSelectTrigger,
  PromptInputModelSelectValue,
} from "@/components/elements/prompt-input";
import { chatModels } from "@/lib/ai/model";
import { cn } from "@/lib/utils";

interface ModelSelectorProps {
  value: string;
  onValueChange: (value: string) => void;
  className?: string;
}

export function ModelSelector({
  value,
  onValueChange,
  className,
}: ModelSelectorProps) {
  return (
    <PromptInputModelSelect onValueChange={onValueChange} value={value}>
      <PromptInputModelSelectTrigger className={cn(className)}>
        <PromptInputModelSelectValue
          className={cn(
            !chatModels.find((m) => m.id === value)?.available &&
              "text-muted-foreground",
          )}
        />
      </PromptInputModelSelectTrigger>
      <PromptInputModelSelectContent>
        {chatModels.map((model) => (
          <PromptInputModelSelectItem
            key={model.id}
            value={model.id}
            disabled={!model.available}
          >
            {model.name}
          </PromptInputModelSelectItem>
        ))}
      </PromptInputModelSelectContent>
    </PromptInputModelSelect>
  );
}
