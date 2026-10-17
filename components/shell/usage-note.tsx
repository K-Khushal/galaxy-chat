import { formatTokenUsage } from "@/lib/ui/credits";

export function UsageNote({ totalTokens }: { totalTokens?: number }) {
  const label = formatTokenUsage(totalTokens);
  if (!label) {
    return null;
  }
  return <p className="text-muted-foreground text-sm">{label}</p>;
}
