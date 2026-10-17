import type { CreditStatus } from "./credits";
/** F06 authenticated GET /api/credits response. No funding is inferred from a balance. */
export type PlatformCreditView = {
  funding: "platform";
  state:
    | "disabled"
    | "available"
    | "daily_exhausted"
    | "shared_exhausted"
    | "busy";
  configured: boolean;
  allowanceMicrodollars: number;
  remainingMicrodollars: number;
  creditMicrodollars: number;
  resetsAt: string;
  reason?: string;
};
export function toCreditStatus(view: PlatformCreditView): CreditStatus {
  if (!view.configured || view.state === "disabled")
    return { state: "unavailable", reason: "metering_pending" };
  switch (view.state) {
    case "daily_exhausted":
      return { state: "exhausted", resetsAt: view.resetsAt };
    case "shared_exhausted":
      return {
        state: "paused",
        reason:
          "The shared allowance is currently exhausted. No platform-funded requests are available.",
      };
    case "busy":
      return {
        state: "paused",
        reason:
          "A request is already using your allowance. Wait for it to finish.",
      };
    case "available":
      return {
        state: "available",
        remainingMicrodollars: view.remainingMicrodollars,
        resetsAt: view.resetsAt,
      };
  }
}
