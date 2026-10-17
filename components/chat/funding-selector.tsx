"use client";
import type { FundingChoice } from "@/lib/byok/contract";
export function FundingSelector({
  value,
  onChange,
  disabled = false,
}: {
  value: FundingChoice;
  onChange: (value: FundingChoice) => void;
  disabled?: boolean;
}) {
  return (
    <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1">
      <label
        htmlFor="chat-funding"
        className="text-xs font-medium text-muted-foreground"
      >
        Pay with
      </label>
      <select
        id="chat-funding"
        className="min-h-11 max-w-full rounded-md border border-input bg-background px-3 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring md:text-sm"
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value as FundingChoice)}
      >
        <option value="platform">Platform credits</option>
        <option value="openrouter">My OpenRouter key</option>
        <option value="gateway">My Vercel Gateway key</option>
      </select>
      {value !== "platform" && (
        <p className="text-xs text-muted-foreground">
          Provider charges apply · no platform model credits
        </p>
      )}
    </div>
  );
}
