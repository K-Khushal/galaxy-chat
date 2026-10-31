import "server-only";
import { createClient } from "redis";
import type { Publisher, Subscriber } from "resumable-stream";
import { redisUrl } from "@/lib/env";
import { logErrorId } from "@/lib/errors";

/**
 * The few atomic Redis operations Galaxy needs: Generation locks, rate limits
 * and Better Auth's secondary storage. Production wraps node-redis (below);
 * tests use an in-memory implementation.
 */
export type Kv = {
  get(key: string): Promise<string | null>;
  /**
   * SET, with a millisecond expiry when `px` is given. With `nx`, only when
   * absent. True if written.
   */
  set(
    key: string,
    value: string,
    options?: { px?: number; nx?: boolean },
  ): Promise<boolean>;
  del(key: string): Promise<void>;
  /** Reads and deletes the key in one step. */
  getDel(key: string): Promise<string | null>;
  /** Deletes the key only while it still holds `value`. */
  delIfEquals(key: string, value: string): Promise<boolean>;
  /** Re-arms the expiry only while the key still holds `value`. */
  expireIfEquals(key: string, value: string, px: number): Promise<boolean>;
  /** Increments a counter that expires `px` ms after its first increment. */
  incrWindow(key: string, px: number): Promise<number>;
};

export type RedisConnections = {
  kv: Kv;
  publisher: Publisher;
  subscriber: Subscriber;
};

const DEL_IF_EQUALS = `if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
end
return 0`;

const EXPIRE_IF_EQUALS = `if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("PEXPIRE", KEYS[1], ARGV[2])
end
return 0`;

const INCR_WINDOW = `local count = redis.call("INCR", KEYS[1])
if count == 1 then
  redis.call("PEXPIRE", KEYS[1], ARGV[1])
end
return count`;

const newClient = (url: string) => createClient({ url });
type RedisClient = ReturnType<typeof newClient>;

export function kvFor(client: RedisClient): Kv {
  return {
    get: (key) => client.get(key),
    set: async (key, value, { px, nx } = {}) =>
      (await client.set(key, value, {
        ...(px ? { expiration: { type: "PX" as const, value: px } } : {}),
        ...(nx ? { condition: "NX" as const } : {}),
      })) === "OK",
    del: async (key) => {
      await client.del(key);
    },
    getDel: (key) => client.getDel(key),
    delIfEquals: async (key, value) =>
      Number(
        await client.eval(DEL_IF_EQUALS, { keys: [key], arguments: [value] }),
      ) === 1,
    expireIfEquals: async (key, value, px) =>
      Number(
        await client.eval(EXPIRE_IF_EQUALS, {
          keys: [key],
          arguments: [value, String(px)],
        }),
      ) === 1,
    incrWindow: async (key, px) =>
      Number(
        await client.eval(INCR_WINDOW, {
          keys: [key],
          arguments: [String(px)],
        }),
      ),
  };
}

let connecting: Promise<RedisConnections> | null = null;

async function connect(): Promise<RedisConnections> {
  const client = newClient(redisUrl());
  const subscriber = client.duplicate();
  // Never log the error itself: it can include the URL and its password.
  client.on("error", () => logErrorId("redis_error"));
  subscriber.on("error", () => logErrorId("redis_subscriber_error"));
  try {
    await Promise.all([client.connect(), subscriber.connect()]);
  } catch (error) {
    client.destroy();
    subscriber.destroy();
    throw error;
  }
  return {
    kv: kvFor(client),
    publisher: client as unknown as Publisher,
    subscriber: subscriber as unknown as Subscriber,
  };
}

/**
 * The server process's one Redis client and its pub/sub subscriber, created
 * and connected on first use. The only place that opens Redis connections.
 */
export function getRedis(): Promise<RedisConnections> {
  connecting ??= connect().catch((error) => {
    connecting = null;
    throw error;
  });
  return connecting;
}

/** A Kv that connects on first use, so callers can be built without Redis. */
export function lazyKv(): Kv {
  return {
    get: async (key) => (await getRedis()).kv.get(key),
    set: async (key, value, options) =>
      (await getRedis()).kv.set(key, value, options),
    del: async (key) => (await getRedis()).kv.del(key),
    getDel: async (key) => (await getRedis()).kv.getDel(key),
    delIfEquals: async (key, value) =>
      (await getRedis()).kv.delIfEquals(key, value),
    expireIfEquals: async (key, value, px) =>
      (await getRedis()).kv.expireIfEquals(key, value, px),
    incrWindow: async (key, px) => (await getRedis()).kv.incrWindow(key, px),
  };
}
