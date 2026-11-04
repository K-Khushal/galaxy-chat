"use client";
import { ArrowDown } from "lucide-react";
import type { ReactNode } from "react";
import { StickToBottom, useStickToBottomContext } from "use-stick-to-bottom";
import { Button } from "@/components/ui/button";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { cn } from "@/lib/utils";
import { MESSAGE_FRAME } from "./chat-skeleton";

function Jump() {
  const { isAtBottom, scrollToBottom } = useStickToBottomContext();
  // Stays mounted so it can fade out too; inert keeps it out of reach while hidden.
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label="Jump to latest"
      inert={isAtBottom}
      className={cn(
        "absolute bottom-3 left-1/2 size-8 -translate-x-1/2 rounded-full bg-popover shadow-md ring-1 ring-border hover:bg-popover",
        "transition-[opacity,scale] duration-160 ease-out",
        isAtBottom && "opacity-0 motion-safe:scale-[0.9]",
      )}
      onClick={() => scrollToBottom()}
    >
      <ArrowDown />
    </Button>
  );
}
export function MessageList({ children }: { children: ReactNode }) {
  const reduced = useReducedMotion();
  return (
    <StickToBottom
      className="relative min-h-0 flex-1"
      resize={reduced ? "instant" : "smooth"}
      initial="instant"
    >
      <StickToBottom.Content className={MESSAGE_FRAME}>
        {children}
      </StickToBottom.Content>
      <Jump />
    </StickToBottom>
  );
}
