"use client";
import { Check, Copy, Info, RotateCcw } from "lucide-react";
import { type ComponentProps, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { ChatMessage } from "@/lib/chat/store";
import { formatCost } from "@/lib/credits/copy";
import { MODELS } from "@/lib/models";
import { cn } from "@/lib/utils";
import { textOf } from "./api";

/** A ghost icon button whose tooltip says what its accessible name says. */
export function ActionButton({
  label,
  className,
  children,
  ...props
}: { label: string } & Omit<ComponentProps<typeof Button>, "aria-label">) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            className={cn("text-muted-foreground", className)}
            aria-label={label}
            {...props}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

const ICON_SWAP =
  "col-start-1 row-start-1 transition-[opacity,scale,filter] duration-160 ease-out";
const ICON_HIDDEN = "opacity-0 motion-safe:scale-[0.25] motion-safe:blur-[4px]";

function CopyButton({ message }: { message: ChatMessage }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <ActionButton
      label={copied ? "Copied Reply" : "Copy Reply"}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(textOf(message));
          setCopied(true);
          clearTimeout(timer.current);
          timer.current = setTimeout(() => setCopied(false), 2000);
        } catch {
          toast.error("Couldn’t copy. Select the text and copy it.");
        }
      }}
    >
      <span className="grid place-items-center">
        <Copy className={cn(ICON_SWAP, copied && ICON_HIDDEN)} />
        <Check className={cn(ICON_SWAP, !copied && ICON_HIDDEN)} />
      </span>
    </ActionButton>
  );
}

function Detail({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right tabular-nums">{children}</dd>
    </>
  );
}

function ReplyInfo({ message }: { message: ChatMessage }) {
  const model = MODELS.find((entry) => entry.id === message.model);
  const paid =
    message.payment === "credits"
      ? "Credits"
      : message.payment === "byok"
        ? "Your key"
        : "—";
  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger
          render={
            <PopoverTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="text-muted-foreground"
                  aria-label="Reply info"
                />
              }
            />
          }
        >
          <Info />
        </TooltipTrigger>
        <TooltipContent>Reply info</TooltipContent>
      </Tooltip>
      <PopoverContent align="start" className="w-60 p-3">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-caption">
          <Detail label="Model">{model?.label ?? message.model ?? "—"}</Detail>
          <Detail label="Paid with">{paid}</Detail>
          <Detail label="Tokens">{message.usage?.totalTokens ?? "—"}</Detail>
          <Detail label="Cost">
            {message.usage?.cost !== undefined
              ? formatCost(message.usage.cost)
              : "—"}
          </Detail>
        </dl>
      </PopoverContent>
    </Popover>
  );
}

export function ReplyActions({
  message,
  disabled,
  readOnly = false,
  onRegenerate,
}: {
  message: ChatMessage;
  disabled: boolean;
  /** A Temporary chat keeps Copy and Reply info only. */
  readOnly?: boolean;
  onRegenerate: () => void;
}) {
  return (
    <>
      {textOf(message).trim() && <CopyButton message={message} />}
      {!readOnly && (
        <ActionButton
          label="Regenerate Reply"
          disabled={disabled}
          onClick={onRegenerate}
        >
          <RotateCcw />
        </ActionButton>
      )}
      <ReplyInfo message={message} />
    </>
  );
}
