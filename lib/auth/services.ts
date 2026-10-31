import "server-only";
import { Resend } from "resend";
import { hashGrantIdentity } from "@/lib/credits";
import type { AuthEnv } from "@/lib/env";
import { redisRateLimit } from "@/lib/ratelimit";
import { type Kv, lazyKv } from "@/lib/redis";

const storageKey = (key: string) => `galaxy:auth:${key}`;

/**
 * Better Auth's secondary storage (sessions, OTPs, its own rate limits) on the
 * shared Redis. `getAndDelete` and `increment` stay atomic so a code can be
 * spent once and attempts counted under concurrent requests.
 */
export function redisSecondaryStorage(kv: Kv) {
  return {
    get: (key: string) => kv.get(storageKey(key)),
    getAndDelete: (key: string) => kv.getDel(storageKey(key)),
    async set(key: string, value: string, ttl?: number) {
      await kv.set(storageKey(key), value, {
        ...(ttl ? { px: ttl * 1000 } : {}),
      });
    },
    delete: (key: string) => kv.del(storageKey(key)),
    increment: (key: string, ttl: number) =>
      kv.incrWindow(storageKey(key), ttl * 1000),
  };
}

export function authServices(
  config: AuthEnv,
  kv: Kv = lazyKv(),
  now: () => number = Date.now,
) {
  const rateLimit = redisRateLimit(kv, now);
  return {
    secondaryStorage: redisSecondaryStorage(kv),
    protection: {
      hash: (email: string) =>
        hashGrantIdentity(
          { kind: "email", value: email },
          config.CREDIT_IDENTITY_KEY,
        ),
      limit: rateLimit,
      async verify(token: string) {
        const response = await fetch(
          "https://challenges.cloudflare.com/turnstile/v0/siteverify",
          {
            method: "POST",
            body: new URLSearchParams({
              secret: config.TURNSTILE_SECRET_KEY,
              response: token,
            }),
            signal: AbortSignal.timeout(10000),
          },
        );
        const data = await response.json();
        return (
          response.ok &&
          data.success === true &&
          data.hostname === new URL(config.BETTER_AUTH_URL).hostname
        );
      },
    },
    async sendCode(email: string, otp: string) {
      const { error } = await new Resend(config.RESEND_API_KEY).emails.send({
        from: config.AUTH_EMAIL_FROM,
        to: email,
        subject: "Your Galaxy sign-in code",
        text: `Your sign-in code is ${otp}. It expires in 5 minutes.`,
      });
      if (error) throw new Error("Could not send verification code");
    },
  };
}
