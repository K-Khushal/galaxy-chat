import type { Kv } from "@/lib/redis";

export type RateLimitKind =
  | "send"
  | "byok"
  | "presign"
  | "emailCodeIp"
  | "emailCodeAddress";

/** True when the request is allowed. Each `subject` has its own counter. */
export type RateLimit = (
  kind: RateLimitKind,
  subject: string,
) => Promise<boolean>;

export const RATE_LIMITS: Record<
  RateLimitKind,
  { limit: number; windowMs: number }
> = {
  // Sending, editing, regenerating or continuing a Message (per User).
  send: { limit: 20, windowMs: 60_000 },
  // Saving or testing a BYOK key (per User).
  byok: { limit: 10, windowMs: 10 * 60_000 },
  // Upload URLs for Attachments (per User).
  presign: { limit: 60, windowMs: 10 * 60_000 },
  // Sign-in code requests, per client IP and per hashed email address.
  emailCodeIp: { limit: 3, windowMs: 60_000 },
  emailCodeAddress: { limit: 3, windowMs: 60_000 },
};

/** A fixed-window limit per subject, counted in Redis. */
export function redisRateLimit(
  kv: Kv,
  now: () => number = Date.now,
): RateLimit {
  return async (kind, subject) => {
    const { limit, windowMs } = RATE_LIMITS[kind];
    const window = Math.floor(now() / windowMs);
    const key = `galaxy:ratelimit:${kind}:${subject}:${window}`;
    return (await kv.incrWindow(key, windowMs)) <= limit;
  };
}
