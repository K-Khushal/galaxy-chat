import { expect, test } from "bun:test";
import { byokKeyring, databaseUrl, EnvError, parseEnv } from "../lib/env";

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
  REDIS_URL: "rediss://default:password@redis.example:6379",
  OPENROUTER_API_KEY: "platform-key",
  BYOK_ENCRYPTION_KEYS_JSON: JSON.stringify({
    v1: Buffer.alloc(32, 1).toString("base64"),
  }),
  BYOK_ACTIVE_KEY_VERSION: "v1",
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
    "REDIS_URL",
    "OPENROUTER_API_KEY",
    "BYOK_ENCRYPTION_KEYS_JSON",
    "BYOK_ACTIVE_KEY_VERSION",
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

test("validates the Redis URL and the BYOK keyring", () => {
  const env = parseEnv(valid);
  expect(env.BYOK_KEYRING.active).toBe("v1");
  expect(env.BYOK_KEYRING.keys.get("v1")?.length).toBe(32);
  expect(() =>
    parseEnv({ ...valid, REDIS_URL: "https://redis.example" }),
  ).toThrow("REDIS_URL must be a redis:// or rediss:// URL");
  expect(() => parseEnv({ ...valid, BYOK_ACTIVE_KEY_VERSION: "v2" })).toThrow(
    "BYOK_ACTIVE_KEY_VERSION must name a version",
  );
  for (const keys of [
    "not json",
    "[]",
    "{}",
    JSON.stringify({ v1: "short" }),
    JSON.stringify({ v1: Buffer.alloc(31).toString("base64") }),
    JSON.stringify({ "bad version!": Buffer.alloc(32).toString("base64") }),
  ]) {
    expect(() =>
      byokKeyring({ ...valid, BYOK_ENCRYPTION_KEYS_JSON: keys }),
    ).toThrow("BYOK_ENCRYPTION_KEYS_JSON must map");
  }
});
