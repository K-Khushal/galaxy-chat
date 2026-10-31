"use client";
import { ArrowDown } from "lucide-react";
import { useReducedMotion } from "motion/react";
import type { ReactNode } from "react";
import { StickToBottom, useStickToBottomContext } from "use-stick-to-bottom";
import { Button } from "@/components/ui/button";

function Jump() {
  const { isAtBottom, scrollToBottom } = useStickToBottomContext();
  return (
    !isAtBottom && (
      <Button
        className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full shadow-sm"
        variant="outline"
        size="sm"
        onClick={() => scrollToBottom()}
      >
        <ArrowDown />
        Jump to latest
      </Button>
    )
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
      <StickToBottom.Content className="mx-auto w-full max-w-3xl px-4 pb-6">
        {children}
      </StickToBottom.Content>
      <Jump />
    </StickToBottom>
  );
}
