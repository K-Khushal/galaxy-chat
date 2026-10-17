import { UsageNote } from "@/components/shell/usage-note";
import type { AppUsage } from "@/lib/ai/usage";

export function ChatContext({ usage }: { usage?: AppUsage }) {
  return <UsageNote totalTokens={usage?.totalTokens} />;
}
