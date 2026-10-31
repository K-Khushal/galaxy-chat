import { afterAll, expect, mock, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { protectEmailCode } from "../lib/auth/abuse";
import { type CreditsDb, getCredits } from "../lib/credits";
import type { Database } from "../lib/db/client";
import * as schema from "../lib/db/schema";
import { parseEnv } from "../lib/env";

mock.module("server-only", () => ({}));
const { createAuth } = await import("../lib/auth/server");
const config = parseEnv({
  DATABASE_URL: "postgres://unused",
  BETTER_AUTH_SECRET: "x".repeat(32),
  BETTER_AUTH_URL: "http://localhost:3000",
  GITHUB_CLIENT_ID: "test",
  GITHUB_CLIENT_SECRET: "test",
  GOOGLE_CLIENT_ID: "test",
  GOOGLE_CLIENT_SECRET: "test",
  CREDIT_IDENTITY_KEY: "k".repeat(32),
  RESEND_API_KEY: "test",
  AUTH_EMAIL_FROM: "auth@example.com",
  UPSTASH_REDIS_REST_URL: "https://unused.example",
  UPSTASH_REDIS_REST_TOKEN: "test",
  TURNSTILE_SITE_KEY: "test",
  TURNSTILE_SECRET_KEY: "test",
});
const client = await PGlite.create();
for (const file of [
  "0000_auth.sql",
  "0001_credits.sql",
  "0003_remove_invite.sql",
])
  await client.exec(await Bun.file(`drizzle/${file}`).text());
const db = drizzle(client, { schema });
afterAll(() => client.close());
const values = new Map<string, { value: string; expires: number }>();
let code = "";
let mails = 0;
// Same three-per-minute contract as authServices; independent buckets per key.
const buckets = new Map<string, number[]>();
const sendCode = mock(async (_email: string, otp: string) => {
  code = otp;
  mails++;
});
const auth = createAuth(config, db as unknown as Database, {
  secondaryStorage: {
    async get(k) {
      const row = values.get(k);
      return row && row.expires > Date.now() ? row.value : null;
    },
    async set(k, value, ttl) {
      values.set(k, {
        value,
        expires: ttl ? Date.now() + ttl * 1000 : Infinity,
      });
    },
    async delete(k) {
      values.delete(k);
    },
    async getAndDelete(k) {
      const value = values.get(k)?.value ?? null;
      values.delete(k);
      return value;
    },
    async increment(k, ttl) {
      const n = Number(values.get(k)?.value ?? 0) + 1;
      values.set(k, { value: String(n), expires: Date.now() + ttl * 1000 });
      return n;
    },
  },
  protection: {
    hash: (email) => email,
    limit: async (key) => {
      const now = Date.now();
      const recent = (buckets.get(key) ?? []).filter((at) => at > now - 60_000);
      recent.push(now);
      buckets.set(key, recent);
      return recent.length <= 3;
    },
    verify: async (token) => token === "valid",
  },
  sendCode,
});
let transportIp = 0;
async function request(path: string, body: object, ip = "127.0.0.1") {
  return auth.handler(
    new Request(`http://localhost:3000/api/auth${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-turnstile-token": "valid",
        "x-real-ip": ip,
        // Keep Better Auth's independent transport-IP limiter from masking
        // the application's x-real-ip/email buckets or OTP attempt budget.
        "x-forwarded-for": `198.51.100.${++transportIp}`,
      },
      body: JSON.stringify(body),
    }),
  );
}
test("email code sign-up grants 10, persisted session, deletion and returning email grants 0", async () => {
  const email = "person@example.com";
  expect(
    (
      await request("/email-otp/send-verification-otp", {
        email,
        type: "sign-in",
      })
    ).status,
  ).toBe(200);
  const response = await request("/sign-in/email-otp", { email, otp: code });
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(await getCredits(db as unknown as CreditsDb, body.user.id)).toBe(10);
  expect((await db.select().from(schema.session)).length).toBe(1);
  await client.exec('DELETE FROM "user"');
  expect(
    (
      await request("/email-otp/send-verification-otp", {
        email,
        type: "sign-in",
      })
    ).status,
  ).toBe(200);
  const returning = await request("/sign-in/email-otp", { email, otp: code });
  expect(returning.status).toBe(200);
  expect(
    await getCredits(
      db as unknown as CreditsDb,
      (await returning.json()).user.id,
    ),
  ).toBe(0);
});
test("one IP cannot request codes for more than three emails", async () => {
  buckets.clear();
  values.clear();
  sendCode.mockClear();
  for (let i = 0; i < 3; i++) {
    expect(
      (
        await request(
          "/email-otp/send-verification-otp",
          {
            email: `ip-bucket-${i}@example.com`,
            type: "sign-in",
          },
          "192.0.2.1",
        )
      ).status,
    ).toBe(200);
  }
  expect(sendCode).toHaveBeenCalledTimes(3);
  expect(
    (
      await request(
        "/email-otp/send-verification-otp",
        {
          email: "ip-blocked@example.com",
          type: "sign-in",
        },
        "192.0.2.1",
      )
    ).status,
  ).toBe(429);
  expect(sendCode).toHaveBeenCalledTimes(3);
});

test("one email cannot request codes from more than three IPs", async () => {
  buckets.clear();
  values.clear();
  sendCode.mockClear();
  for (let i = 0; i < 3; i++) {
    expect(
      (
        await request(
          "/email-otp/send-verification-otp",
          {
            email: "email-bucket@example.com",
            type: "sign-in",
          },
          `192.0.2.${i + 10}`,
        )
      ).status,
    ).toBe(200);
  }
  expect(sendCode).toHaveBeenCalledTimes(3);
  expect(
    (
      await request(
        "/email-otp/send-verification-otp",
        {
          email: "email-bucket@example.com",
          type: "sign-in",
        },
        "192.0.2.99",
      )
    ).status,
  ).toBe(429);
  expect(sendCode).toHaveBeenCalledTimes(3);
});

test("disposable email rejection runs before mail", async () => {
  values.clear();
  buckets.clear();
  const before = mails;
  expect(
    (
      await request("/email-otp/send-verification-otp", {
        email: "person@mailinator.com",
        type: "sign-in",
      })
    ).status,
  ).toBe(400);
  expect(mails).toBe(before);
});

test("exhausting OTP attempts invalidates the correct code", async () => {
  buckets.clear();
  values.clear();
  const email = "attempts@example.com";
  expect(
    (
      await request("/email-otp/send-verification-otp", {
        email,
        type: "sign-in",
      })
    ).status,
  ).toBe(200);
  const original = code;
  const wrong = original === "000000" ? "111111" : "000000";
  for (let i = 0; i < 3; i++) {
    const rejected = await request("/sign-in/email-otp", { email, otp: wrong });
    expect((await rejected.json()).code).toBe("INVALID_OTP");
  }
  const exhausted = await request("/sign-in/email-otp", {
    email,
    otp: original,
  });
  expect((await exhausted.json()).code).toBe("TOO_MANY_ATTEMPTS");
  const invalidated = await request("/sign-in/email-otp", {
    email,
    otp: original,
  });
  expect((await invalidated.json()).code).toBe("INVALID_OTP");
});

test("a successful sign-in consumes the OTP", async () => {
  buckets.clear();
  values.clear();
  const email = "replay@example.com";
  expect(
    (
      await request("/email-otp/send-verification-otp", {
        email,
        type: "sign-in",
      })
    ).status,
  ).toBe(200);
  const original = code;
  expect(
    (await request("/sign-in/email-otp", { email, otp: original })).status,
  ).toBe(200);
  const replay = await request("/sign-in/email-otp", { email, otp: original });
  expect((await replay.json()).code).toBe("INVALID_OTP");
});

test("Turnstile and Redis failures fail closed", async () => {
  const base = {
    limit: async () => true,
    verify: async () => false,
    hash: (email: string) => email,
  };
  await expect(
    protectEmailCode("a@example.com", "ip", "bad", base),
  ).rejects.toThrow("verification_failed");
  await expect(
    protectEmailCode("a@example.com", "ip", "valid", {
      ...base,
      limit: async () => {
        throw new Error("offline");
      },
    }),
  ).rejects.toThrow("offline");
});

test("password reset routes cannot send mail", async () => {
  values.clear();
  const before = mails;
  expect(
    (
      await request("/email-otp/request-password-reset", {
        email: "person@example.com",
      })
    ).status,
  ).toBe(403);
  expect(mails).toBe(before);
});

// Exercise the public redirect/callback routes, including state cookies and the
// provider adapters. Only outbound provider HTTP is stubbed; unexpected HTTP fails.
async function oauth(
  provider: "github" | "google",
  id: string,
  email: string,
  verified: boolean,
) {
  const start = await request("/sign-in/social", {
    provider,
    callbackURL: "/chat",
  });
  expect(start.status).toBe(200);
  const authorization = new URL((await start.json()).url);
  const state = authorization.searchParams.get("state");
  expect(state).toBeTruthy();
  const cookie = start.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  const originalFetch = globalThis.fetch;
  const endpoints: string[] = [];
  const token = [
    Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString(
      "base64url",
    ),
    Buffer.from(
      JSON.stringify({
        sub: id,
        email,
        email_verified: verified,
        name: "Test User",
      }),
    ).toString("base64url"),
    "test-signature",
  ].join(".");
  const providerFetch = mock(async (input: string | URL | Request) => {
    const url = input instanceof Request ? input.url : input.toString();
    endpoints.push(url);
    switch (url) {
      case "https://github.com/login/oauth/access_token":
        return Response.json({
          access_token: "test-token",
          token_type: "bearer",
        });
      case "https://api.github.com/user":
        return Response.json({ id, email, name: "Test User", login: "test" });
      case "https://api.github.com/user/emails":
        return Response.json([{ email, verified, primary: true }]);
      case "https://oauth2.googleapis.com/token":
        // Google supplies user info in the token endpoint's ID token.
        return Response.json({
          access_token: "test-token",
          token_type: "Bearer",
          id_token: token,
        });
      default:
        throw new Error(`Unexpected network request: ${url}`);
    }
  });
  globalThis.fetch = Object.assign(providerFetch, {
    preconnect: originalFetch.preconnect,
  });
  try {
    const response = await auth.handler(
      new Request(
        `http://localhost:3000/api/auth/callback/${provider}?code=test-code&state=${state}`,
        { headers: { cookie } },
      ),
    );
    expect(endpoints).toContain(
      provider === "github"
        ? "https://api.github.com/user/emails"
        : "https://oauth2.googleapis.com/token",
    );
    return response;
  } finally {
    globalThis.fetch = originalFetch;
  }
}

for (const provider of ["github", "google"] as const) {
  test(`${provider}: verified email links without extra Credits; returning provider ID gets 0 after deletion and changed email`, async () => {
    buckets.clear();
    values.clear();
    const email = `link-${provider}@example.com`;
    expect(
      (
        await request("/email-otp/send-verification-otp", {
          email,
          type: "sign-in",
        })
      ).status,
    ).toBe(200);
    const signedIn = await request("/sign-in/email-otp", { email, otp: code });
    expect(signedIn.status).toBe(200);
    const userId = (await signedIn.json()).user.id;
    expect(await getCredits(db as unknown as CreditsDb, userId)).toBe(10);
    // Spend Credits so an accidental reset to the initial allowance is visible.
    await client.query(
      "UPDATE credit_balance SET remaining = 4 WHERE user_id = $1",
      [userId],
    );
    const linked = await oauth(provider, `stable-${provider}`, email, true);
    expect(linked.headers.get("location")).toBe("/chat");
    const accounts = await db.select().from(schema.account);
    expect(
      accounts
        .filter(
          (a) =>
            a.providerId === provider && a.accountId === `stable-${provider}`,
        )
        .map((a) => a.userId),
    ).toEqual([userId]);
    expect(await getCredits(db as unknown as CreditsDb, userId)).toBe(4);
    await client.query('DELETE FROM "user" WHERE id = $1', [userId]);
    const returning = await oauth(
      provider,
      `stable-${provider}`,
      `changed-${provider}@example.com`,
      true,
    );
    expect(returning.headers.get("location")).toBe("/chat");
    const [account] = (await db.select().from(schema.account)).filter(
      (a) => a.providerId === provider && a.accountId === `stable-${provider}`,
    );
    expect(account.userId).not.toBe(userId);
    expect(await getCredits(db as unknown as CreditsDb, account.userId)).toBe(
      0,
    );
  });

  test(`${provider}: unverified provider email cannot link to an existing account`, async () => {
    buckets.clear();
    values.clear();
    const email = `unverified-${provider}@example.com`;
    expect(
      (
        await request("/email-otp/send-verification-otp", {
          email,
          type: "sign-in",
        })
      ).status,
    ).toBe(200);
    const signedIn = await request("/sign-in/email-otp", { email, otp: code });
    const userId = (await signedIn.json()).user.id;
    const response = await oauth(
      provider,
      `unverified-${provider}`,
      email,
      false,
    );
    expect(response.headers.get("location")).toContain("error=");
    expect(response.headers.get("set-cookie") ?? "").not.toContain(
      "session_token=",
    );
    expect(
      (await db.select().from(schema.account)).filter(
        (a) =>
          a.providerId === provider && a.accountId === `unverified-${provider}`,
      ),
    ).toEqual([]);
    expect(await getCredits(db as unknown as CreditsDb, userId)).toBe(10);
  });
}
