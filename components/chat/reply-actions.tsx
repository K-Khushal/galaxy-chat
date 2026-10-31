"use client";
import { Check, Copy, Info, RotateCcw } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { ChatMessage } from "@/lib/chat/store";
import { MODELS } from "@/lib/models";
import { textOf } from "./api";
export function ReplyActions({
  message,
  disabled,
  onRegenerate,
}: {
  message: ChatMessage;
  disabled: boolean;
  onRegenerate: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState(false);
  return (
    <>
      {textOf(message).trim() && (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={copied ? "Copied Reply" : "Copy Reply"}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(textOf(message));
              setCopied(true);
              setError(false);
            } catch {
              setError(true);
            }
          }}
        >
          {copied ? <Check /> : <Copy />}
        </Button>
      )}
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Regenerate Reply"
        disabled={disabled}
        onClick={onRegenerate}
      >
        <RotateCcw />
      </Button>
      <Popover>
        <PopoverTrigger
          render={
            <Button variant="ghost" size="icon-sm" aria-label="Reply info" />
          }
        >
          <Info />
        </PopoverTrigger>
        <PopoverContent className="text-xs">
          <dl className="grid gap-2">
            <div>
              <dt>Model</dt>
              <dd>
                {MODELS.find((model) => model.id === message.model)?.label ??
                  message.model ??
                  "Not available"}
              </dd>
            </div>
            <div>
              <dt>Tokens</dt>
              <dd>{message.usage?.totalTokens ?? "Not available"}</dd>
            </div>
            <div>
              <dt>Cost</dt>
              <dd>
                {message.usage?.cost !== undefined
                  ? `$${message.usage.cost.toFixed(6)}`
                  : "Not available"}
              </dd>
            </div>
          </dl>
        </PopoverContent>
      </Popover>
      {error && <output>Could not copy. Select the text and copy it.</output>}
    </>
  );
}
