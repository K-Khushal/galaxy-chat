"use client";
import { Collapsible } from "@base-ui/react/collapsible";
import { Brain, ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";
import { ReplyMarkdown } from "@/components/elements/reply-markdown";
import { cn } from "@/lib/utils";

export function Reasoning({
  text,
  thinking,
}: {
  text: string;
  thinking: boolean;
}) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (!thinking) return;
    const started = Date.now();
    const timer = setInterval(
      () => setSeconds(Math.floor((Date.now() - started) / 1000)),
      1000,
    );
    return () => clearInterval(timer);
  }, [thinking]);
  return (
    <Collapsible.Root className="mb-3">
      <Collapsible.Trigger className="group flex items-center gap-1.5 rounded-md text-caption text-muted-foreground outline-none transition-colors duration-80 hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50">
        <Brain className="size-3.5" />
        <span className={cn(thinking && "text-shimmer")}>
          {thinking
            ? `Thinking for ${seconds}s`
            : seconds
              ? `Thought for ${seconds}s`
              : "Thought process"}
        </span>
        <ChevronRight className="size-3.5 transition-transform duration-160 group-data-panel-open:rotate-90 motion-reduce:transition-none" />
      </Collapsible.Trigger>
      <Collapsible.Panel className="h-(--collapsible-panel-height) overflow-hidden transition-[height] duration-240 ease-out data-starting-style:h-0 data-ending-style:h-0 motion-reduce:transition-none">
        <div className="mt-2 border-l pl-3 text-sm text-muted-foreground">
          <ReplyMarkdown>{text}</ReplyMarkdown>
        </div>
      </Collapsible.Panel>
    </Collapsible.Root>
  );
}
