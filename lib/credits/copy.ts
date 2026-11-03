// Client-safe Credits copy. Keep server-only imports out of this file.

export const creditsLeft = (n: number) =>
  `${n} ${n === 1 ? "Credit" : "Credits"} left`;

/** A reported cost in USD: cents from $0.01, two significant digits below. */
export function formatCost(usd: number): string {
  if (usd === 0) return "$0";
  if (usd >= 0.01) return `$${usd.toFixed(2)}`;
  return `$${usd.toLocaleString("en-US", { maximumSignificantDigits: 2 })}`;
}
