import type { Kv } from "@/lib/redis";

export type RateLimitKind = "send" | "byok";

/** True when the request is allowed. */
export type RateLimit = (
  kind: RateLimitKind,
  userId: string,
) => Promise<boolean>;

export const RATE_LIMITS: Record<
  RateLimitKind,
  { limit: number; windowMs: number }
> = {
  // Sending, editing, regenerating or continuing a Message.
  send: { limit: 20, windowMs: 60_000 },
  // Saving or testing a BYOK key.
  byok: { limit: 10, windowMs: 10 * 60_000 },
};

/** A fixed-window limit per User, counted in Redis. */
export function redisRateLimit(
  kv: Kv,
  now: () => number = Date.now,
): RateLimit {
  return async (kind, userId) => {
    const { limit, windowMs } = RATE_LIMITS[kind];
    const window = Math.floor(now() / windowMs);
    const key = `galaxy:ratelimit:${kind}:${userId}:${window}`;
    return (await kv.incrWindow(key, windowMs)) <= limit;
  };
}
