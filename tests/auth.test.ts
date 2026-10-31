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
let allowed = true;
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
    limit: async () => allowed,
    verify: async (token) => token === "valid",
  },
  async sendCode(_email, otp) {
    code = otp;
    mails++;
  },
});
async function request(path: string, body: object) {
  return auth.handler(
    new Request(`http://localhost:3000/api/auth${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-turnstile-token": "valid",
        "x-real-ip": "127.0.0.1",
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
test("OTP limits and disposable email rejection run before mail", async () => {
  const before = mails;
  allowed = false;
  expect(
    (
      await request("/email-otp/send-verification-otp", {
        email: "limited@example.com",
        type: "sign-in",
      })
    ).status,
  ).toBe(429);
  allowed = true;
  values.clear();
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
