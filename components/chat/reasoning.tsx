"use client";
import { useEffect, useState } from "react";
import { Response } from "@/components/elements/response";
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
    <details className="mb-3 text-sm text-muted-foreground">
      <summary className="cursor-pointer rounded-sm py-1 focus-visible:ring-2 focus-visible:ring-ring">
        {thinking
          ? `Thinking for ${seconds}s`
          : seconds
            ? `Thought for ${seconds}s`
            : "Thought process"}
      </summary>
      <div className="mt-2 border-l pl-4">
        <Response>{text}</Response>
      </div>
    </details>
  );
}
