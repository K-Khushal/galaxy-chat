import "server-only";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { Resend } from "resend";
import { hashGrantIdentity } from "@/lib/credits";
import type { Env } from "@/lib/env";

export function authServices(config: Env) {
  const redis = new Redis({
    url: config.UPSTASH_REDIS_REST_URL,
    token: config.UPSTASH_REDIS_REST_TOKEN,
    automaticDeserialization: false,
  });
  const limiter = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(3, "1 m"),
    prefix: "galaxy:otp",
    analytics: false,
    timeout: 0,
  });
  const key = (value: string) => `galaxy:auth:${value}`;
  return {
    secondaryStorage: {
      get: (k: string) => redis.get<string>(key(k)),
      getAndDelete: (k: string) => redis.getdel(key(k)),
      async set(k: string, value: string, ttl?: number) {
        if (ttl === undefined) await redis.set(key(k), value);
        else await redis.set(key(k), value, { ex: ttl });
      },
      async delete(k: string) {
        await redis.del(key(k));
      },
      async increment(k: string, ttl: number) {
        return Number(
          await redis.eval(
            "local n = redis.call('INCR', KEYS[1]); if n == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end; return n",
            [key(k)],
            [ttl],
          ),
        );
      },
    },
    protection: {
      hash: (email: string) =>
        hashGrantIdentity(
          { kind: "email", value: email },
          config.CREDIT_IDENTITY_KEY,
        ),
      async limit(k: string) {
        const result = await limiter.limit(k);
        await result.pending;
        return result.success;
      },
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
