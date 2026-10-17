export type CreditStatus =
  | { state: "unavailable"; reason: "metering_pending" | "signed_out" }
  | { state: "available"; remainingMicrodollars: number; resetsAt: string }
  | { state: "exhausted"; resetsAt: string }
  | { state: "paused"; reason: string; cause?: "shared" | "busy" }
  | { state: "byok" };

export const defaultCreditStatus: CreditStatus = {
  reason: "metering_pending",
  state: "unavailable",
};

export function creditStatusLabel(status: CreditStatus) {
  switch (status.state) {
    case "available":
      return `${(Math.max(0, status.remainingMicrodollars) / 100_000).toLocaleString("en-US", { maximumFractionDigits: 2 })} credits available`;
    case "exhausted":
      return "Daily allowance used";
    case "paused":
      return status.cause === "busy"
        ? "Request in progress"
        : "Shared funding paused";
    case "byok":
      return "Using your provider key";
    case "unavailable":
      return status.reason === "signed_out"
        ? "Sign in to view usage"
        : "Credits unavailable";
  }
}

export function formatTokenUsage(totalTokens: number | undefined) {
  if (
    typeof totalTokens !== "number" ||
    !Number.isFinite(totalTokens) ||
    totalTokens < 0
  )
    return null;
  return `Last reply: ${Math.floor(totalTokens).toLocaleString("en-US")} tokens`;
}
