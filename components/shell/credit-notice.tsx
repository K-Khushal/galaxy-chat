import { CirclePause, KeyRound, Wallet } from "lucide-react";
import {
  type CreditStatus,
  creditStatusLabel,
  defaultCreditStatus,
} from "@/lib/ui/credits";

export function CreditNotice({
  status = defaultCreditStatus,
  compact = false,
}: {
  status?: CreditStatus;
  compact?: boolean;
}) {
  const Icon =
    status.state === "byok"
      ? KeyRound
      : status.state === "paused"
        ? CirclePause
        : Wallet;
  return (
    <div
      className={
        compact
          ? "flex min-w-0 items-center gap-2 text-xs text-muted-foreground"
          : "rounded-xl border border-sidebar-border bg-background/50 p-3 text-xs text-muted-foreground"
      }
    >
      <p className="flex items-center gap-2 font-medium">
        <Icon className="size-3.5 shrink-0" aria-hidden="true" />
        {creditStatusLabel(status)}
      </p>
      {!compact && (
        <p className="mt-2 leading-relaxed">
          {status.state === "unavailable"
            ? "A balance appears when metering is connected. Generation is currently paused."
            : status.state === "byok"
              ? "Provider charges apply. Platform credits are not used."
              : status.state === "paused"
                ? status.reason
                : "1 credit = $0.10. Allowance resets at 00:00 UTC, subject to shared funding."}
        </p>
      )}
    </div>
  );
}
