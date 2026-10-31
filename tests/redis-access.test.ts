import { beforeAll, expect, test } from "bun:test";
import { errorResponse } from "../lib/api/respond";
import { redisSecondaryStorage } from "../lib/auth/services";
import { getCredits } from "../lib/credits";
import { EnvError } from "../lib/env";
import { choosePayment } from "../lib/generation/payment";
import { resolveModel } from "../lib/models";
import { RATE_LIMITS, redisRateLimit } from "../lib/ratelimit";
import { lazyKv } from "../lib/redis";
import {
  createHarness,
  PGLITE_SETUP_TIMEOUT_MS,
  warmDatabase,
} from "./support/harness";
import { MemoryRedis } from "./support/memory-redis";

beforeAll(warmDatabase, PGLITE_SETUP_TIMEOUT_MS);

test("secondary storage: values expire, are namespaced and are read once by getAndDelete", async () => {
  const redis = new MemoryRedis();
  const storage = redisSecondaryStorage(redis);
  await storage.set("session", "a", 60);
  await storage.set("forever", "b");
  expect(redis.keys().sort()).toEqual([
    "galaxy:auth:forever",
    "galaxy:auth:session",
  ]);
  expect(await storage.get("session")).toBe("a");
  redis.advance(61_000);
  expect(await storage.get("session")).toBeNull();
  expect(await storage.get("forever")).toBe("b");

  expect(await storage.getAndDelete("forever")).toBe("b");
  expect(await storage.getAndDelete("forever")).toBeNull();

  await storage.set("gone", "c", 60);
  await storage.delete("gone");
  expect(await storage.get("gone")).toBeNull();
});

test("secondary storage: increment counts and fixes the window at creation", async () => {
  const redis = new MemoryRedis();
  const storage = redisSecondaryStorage(redis);
  expect(await storage.increment("attempts", 10)).toBe(1);
  redis.advance(6_000);
  expect(await storage.increment("attempts", 10)).toBe(2);
  redis.advance(5_000);
  // The TTL was set by the first increment and never extended.
  expect(await storage.increment("attempts", 10)).toBe(1);
});

test("email-code limits are enforced separately for every IP and every address", async () => {
  const redis = new MemoryRedis();
  const limit = redisRateLimit(redis, () => 0);
  for (const kind of ["emailCodeIp", "emailCodeAddress"] as const) {
    const allowed = RATE_LIMITS[kind].limit;
    for (let i = 0; i < allowed; i++) {
      expect(await limit(kind, "a")).toBe(true);
    }
    expect(await limit(kind, "a")).toBe(false);
    // Another key, and the other kind with the same key, are unaffected.
    expect(await limit(kind, "b")).toBe(true);
  }
  expect(RATE_LIMITS.emailCodeIp.limit).toBe(3);
  expect(RATE_LIMITS.emailCodeAddress.limit).toBe(3);
});

test("a window ends: the limit resets in the next one", async () => {
  const redis = new MemoryRedis();
  let now = 0;
  const limit = redisRateLimit(redis, () => now);
  for (let i = 0; i < 3; i++) await limit("emailCodeIp", "a");
  expect(await limit("emailCodeIp", "a")).toBe(false);
  now = RATE_LIMITS.emailCodeIp.windowMs;
  expect(await limit("emailCodeIp", "a")).toBe(true);
});

test("Redis is not read or connected until something uses it", async () => {
  const saved = process.env.REDIS_URL;
  delete process.env.REDIS_URL;
  try {
    const kv = lazyKv();
    await expect(kv.get("x")).rejects.toBeInstanceOf(EnvError);
    await expect(kv.incrWindow("x", 1000)).rejects.toThrow(
      "REDIS_URL is required",
    );
  } finally {
    if (saved !== undefined) process.env.REDIS_URL = saved;
  }
});

test("a missing environment variable is a 503 that names it and never a value", async () => {
  const lines: string[] = [];
  const write = process.stderr.write.bind(process.stderr);
  process.stderr.write = ((chunk: string | Uint8Array) => {
    lines.push(String(chunk));
    return true;
  }) as typeof process.stderr.write;
  let response: Response;
  try {
    response = errorResponse(
      new EnvError([{ message: "REDIS_URL is required" } as never]),
    );
  } finally {
    process.stderr.write = write;
  }
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ error: "server_misconfigured" });
  expect(lines.join("")).toContain("REDIS_URL is required");
});

test("payment: a missing Platform key fails before any credit is spent", async () => {
  const h = await createHarness();
  await h.addUser("alice", 3);
  const model = resolveModel("openai/gpt-6-luna");
  if (!model) throw new Error("credit model missing");
  await expect(
    choosePayment(
      {
        db: h.db,
        platformKey: () => {
          throw new EnvError([
            { message: "OPENROUTER_API_KEY is required" } as never,
          ]);
        },
        loadByokKey: async () => null,
      },
      "alice",
      model,
    ),
  ).rejects.toBeInstanceOf(EnvError);
  expect(await getCredits(h.db, "alice")).toBe(3);

  // A BYOK payer never reads the Platform key at all.
  const key = "sk-or-v1-".padEnd(48, "k");
  const payment = await choosePayment(
    {
      db: h.db,
      platformKey: () => {
        throw new Error("must not be read");
      },
      loadByokKey: async () => key,
    },
    "bob",
    model,
  );
  expect(payment).toEqual({ source: "byok", apiKey: key });
});
