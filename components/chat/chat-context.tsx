import type { AppUsage } from "@/lib/ai/usage";
import {
  Context,
  ContextCacheUsage,
  ContextContent,
  ContextContentBody,
  ContextContentHeader,
  ContextInputUsage,
  ContextOutputUsage,
  ContextReasoningUsage,
  ContextTrigger,
} from "../elements/context";

export function ChatContext({ usage }: { usage?: AppUsage }) {
  return (
    <Context
      maxTokens={128000}
      usedTokens={usage?.totalTokens ?? 0}
      usage={usage}
      modelId={usage?.modelId ?? "openai:gpt-4"}
    >
      <ContextTrigger />
      <ContextContent>
        <ContextContentHeader />
        <ContextContentBody>
          <ContextInputUsage />
          <ContextOutputUsage />
          <ContextReasoningUsage />
          <ContextCacheUsage />
        </ContextContentBody>
      </ContextContent>
    </Context>
  );
}
