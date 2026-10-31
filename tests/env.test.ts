import { expect, test } from "bun:test";
import {
  authEnv,
  byokKeyring,
  databaseUrl,
  EnvError,
  platformKey,
  redisUrl,
} from "../lib/env";

const auth = {
  BETTER_AUTH_SECRET: "x".repeat(32),
  BETTER_AUTH_URL: "http://127.0.0.1:3000",
  GITHUB_CLIENT_ID: "client",
  GITHUB_CLIENT_SECRET: "secret",
  GOOGLE_CLIENT_ID: "client",
  GOOGLE_CLIENT_SECRET: "secret",
  CREDIT_IDENTITY_KEY: "x".repeat(32),
  RESEND_API_KEY: "secret",
  AUTH_EMAIL_FROM: "Galaxy <auth@example.com>",
  TURNSTILE_SECRET_KEY: "secret",
  TURNSTILE_SITE_KEY: "public",
};
const keyring = {
  BYOK_ENCRYPTION_KEYS_JSON: JSON.stringify({
    v1: Buffer.alloc(32, 1).toString("base64"),
  }),
  BYOK_ACTIVE_KEY_VERSION: "v1",
};

function thrown(run: () => unknown) {
  try {
    run();
  } catch (caught) {
    return caught;
  }
  throw new Error("expected an error");
}

test("each concern reads only its own variables", () => {
  expect(authEnv(auth).CREDIT_IDENTITY_KEY).toHaveLength(32);
  expect(databaseUrl({ DATABASE_URL: " postgres://db/x " })).toBe(
    "postgres://db/x",
  );
  expect(
    redisUrl({ REDIS_URL: "rediss://default:pw@redis.example:6379" }),
  ).toBe("rediss://default:pw@redis.example:6379");
  expect(platformKey({ OPENROUTER_API_KEY: "platform-key" })).toBe(
    "platform-key",
  );
  expect(byokKeyring(keyring).active).toBe("v1");
});

test("a missing variable fails loudly, naming it, only for its concern", () => {
  const error = thrown(() =>
    authEnv({ BETTER_AUTH_SECRET: "too-short", BETTER_AUTH_URL: "no" }),
  );
  expect(error).toBeInstanceOf(EnvError);
  const message = (error as EnvError).message;
  for (const name of [
    "BETTER_AUTH_SECRET",
    "BETTER_AUTH_URL",
    "GITHUB_CLIENT_ID",
    "GOOGLE_CLIENT_SECRET",
    "CREDIT_IDENTITY_KEY",
    "RESEND_API_KEY",
    "TURNSTILE_SECRET_KEY",
  ]) {
    expect(message).toContain(name);
  }
  for (const name of ["REDIS_URL", "OPENROUTER_API_KEY", "BYOK_", "DATABASE"]) {
    expect(message).not.toContain(name);
  }
  expect(() => databaseUrl({})).toThrow("DATABASE_URL is required");
  expect(() => redisUrl({})).toThrow("REDIS_URL is required");
  expect(() => platformKey({})).toThrow("OPENROUTER_API_KEY is required");
  expect(() => byokKeyring({})).toThrow("BYOK_ENCRYPTION_KEYS_JSON");
});

test("validates the Redis URL and the BYOK keyring", () => {
  expect(() => redisUrl({ REDIS_URL: "https://redis.example" })).toThrow(
    "REDIS_URL must be a redis:// or rediss:// URL",
  );
  expect(() =>
    byokKeyring({ ...keyring, BYOK_ACTIVE_KEY_VERSION: "v2" }),
  ).toThrow("BYOK_ACTIVE_KEY_VERSION must name a version");
  expect(byokKeyring(keyring).keys.get("v1")?.length).toBe(32);
  for (const keys of [
    "not json",
    "[]",
    "{}",
    JSON.stringify({ v1: "short" }),
    JSON.stringify({ v1: Buffer.alloc(31).toString("base64") }),
    JSON.stringify({ "bad version!": Buffer.alloc(32).toString("base64") }),
  ]) {
    expect(() =>
      byokKeyring({ ...keyring, BYOK_ENCRYPTION_KEYS_JSON: keys }),
    ).toThrow("BYOK_ENCRYPTION_KEYS_JSON must map");
  }
});
