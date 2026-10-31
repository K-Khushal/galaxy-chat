import { expect, test } from "bun:test";
import { databaseUrl, EnvError, parseEnv } from "../lib/env";

const valid = {
  DATABASE_URL: "postgres://localhost/galaxy",
  BETTER_AUTH_SECRET: "x".repeat(32),
  BETTER_AUTH_URL: "http://127.0.0.1:3000",
  GITHUB_CLIENT_ID: "client",
  GITHUB_CLIENT_SECRET: "secret",
  GOOGLE_CLIENT_ID: "client",
  GOOGLE_CLIENT_SECRET: "secret",
  CREDIT_IDENTITY_KEY: "x".repeat(32),
  RESEND_API_KEY: "secret",
  AUTH_EMAIL_FROM: "Galaxy <auth@example.com>",
  UPSTASH_REDIS_REST_URL: "https://redis.example.com",
  UPSTASH_REDIS_REST_TOKEN: "secret",
  TURNSTILE_SECRET_KEY: "secret",
  TURNSTILE_SITE_KEY: "public",
};

test("parses a complete environment", () => {
  expect(parseEnv(valid).CREDIT_IDENTITY_KEY).toHaveLength(32);
});

test("names every missing or invalid variable in one error", () => {
  const error = (() => {
    try {
      return parseEnv({
        BETTER_AUTH_SECRET: "too-short",
        BETTER_AUTH_URL: "no",
      });
    } catch (caught) {
      return caught;
    }
  })();
  expect(error).toBeInstanceOf(EnvError);
  const message = (error as EnvError).message;
  for (const name of [
    "DATABASE_URL",
    "BETTER_AUTH_SECRET",
    "BETTER_AUTH_URL",
    "GITHUB_CLIENT_ID",
    "GITHUB_CLIENT_SECRET",
  ]) {
    expect(message).toContain(name);
  }
});

test("databaseUrl needs only DATABASE_URL", () => {
  expect(databaseUrl({ DATABASE_URL: " postgres://db/x " })).toBe(
    "postgres://db/x",
  );
  expect(() => databaseUrl({})).toThrow("DATABASE_URL is required");
});
