"use client";
import { KeyRound } from "lucide-react";
import Link from "next/link";
import { type ReactNode, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import type { ChatMessage } from "@/lib/chat/store";
import { creditsLeft, formatCost } from "@/lib/credits/copy";
import { findModel } from "@/lib/models";
import { cn } from "@/lib/utils";
import { ByokDialog } from "./byok-dialog";
import { useCredits } from "./use-credits";

export type ChatSpend = { credits: number; cost: number };

/**
 * What a Chat has spent so far. Computed over the Messages passed in, which
 * are the visible Versions: a Reply on another Version isn't counted.
 */
export function chatSpend(messages: ChatMessage[]): ChatSpend {
  let credits = 0;
  let cost = 0;
  for (const message of messages) {
    if (message.role !== "assistant") continue;
    if (message.payment === "credits" && message.status !== "failed") credits++;
    if (message.payment === "byok") cost += message.usage?.cost ?? 0;
  }
  return { credits, cost };
}

const credit = (n: number) => `${n} ${n === 1 ? "Credit" : "Credits"}`;

function spentCopy(spend?: ChatSpend) {
  const parts = [
    spend && spend.credits > 0 ? credit(spend.credits) : null,
    spend && spend.cost > 0 ? formatCost(spend.cost) : null,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : "Nothing yet";
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="tabular-nums">{children}</dd>
    </div>
  );
}

/**
 * The label mirrors `choosePayment` (ADR 0003): Credits pay on a Credit model
 * while any remain, then the BYOK key, and with neither the next Message is
 * refused. Purely a display; the server stays the source of truth.
 */
export function UsageMeterView({
  model,
  spend,
  credits,
  hasKey,
  onAddKey,
  open,
  onOpenChange,
}: {
  model: string;
  spend?: ChatSpend;
  credits: number | null;
  hasKey: boolean | null;
  onAddKey?: () => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  if (credits === null)
    return (
      <div className="flex h-8 items-center px-2.5 pointer-coarse:min-h-11">
        <Skeleton className="h-4 w-20" />
      </div>
    );
  const onCredits = !!findModel(model)?.creditModel && credits > 0;
  const keyPays = !onCredits && !!hasKey;
  const empty = !onCredits && !keyPays;
  const cost = spend && spend.cost > 0 ? formatCost(spend.cost) : null;
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className={cn(
              "h-8 rounded-full px-2.5 text-caption tabular-nums text-muted-foreground",
              onCredits && credits <= 2 && "text-warning",
              empty && "text-destructive",
            )}
          />
        }
      >
        {onCredits && creditsLeft(credits)}
        {keyPays && (
          <>
            <KeyRound aria-hidden="true" className="size-3.5" />
            {cost ? (
              <>
                <span className="sr-only">Your key: </span>
                {cost}
              </>
            ) : (
              "Your key"
            )}
          </>
        )}
        {empty && creditsLeft(0)}
      </PopoverTrigger>
      <PopoverContent side="top" align="end" className="w-64 p-3">
        <dl className="grid gap-2 text-sm">
          <Row label="Credits left">{credits}</Row>
          <Row label="This Chat">{spentCopy(spend)}</Row>
          <Row label="OpenRouter key">{hasKey ? "Added" : "Not added"}</Row>
        </dl>
        {hasKey ? (
          <Link
            href="/chat/settings"
            onClick={() => onOpenChange?.(false)}
            className="text-caption text-primary underline-offset-4 outline-none hover:underline focus-visible:underline"
          >
            View usage
          </Link>
        ) : (
          <Button size="sm" className="w-full" onClick={onAddKey}>
            Add OpenRouter key
          </Button>
        )}
      </PopoverContent>
    </Popover>
  );
}

/** What the next Message spends from, beside Send. */
export function UsageMeter({
  model,
  spend,
}: {
  model: string;
  spend?: ChatSpend;
}) {
  const { credits, hasKey } = useCredits();
  const [open, setOpen] = useState(false);
  const [keyOpen, setKeyOpen] = useState(false);
  return (
    <>
      <UsageMeterView
        model={model}
        spend={spend}
        credits={credits}
        hasKey={hasKey}
        open={open}
        onOpenChange={setOpen}
        onAddKey={() => {
          setOpen(false);
          setKeyOpen(true);
        }}
      />
      <ByokDialog open={keyOpen} onOpenChange={setKeyOpen} onSaved={() => {}} />
    </>
  );
}
