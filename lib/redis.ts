import "server-only";
import { createClient } from "redis";
import type { Publisher, Subscriber } from "resumable-stream";
import { env } from "@/lib/env";
import { logErrorId } from "@/lib/errors";

/**
 * The few atomic Redis operations Galaxy needs. Production wraps node-redis
 * (below); tests use an in-memory implementation.
 */
export type Kv = {
  get(key: string): Promise<string | null>;
  /** SET with a millisecond expiry. With `nx`, only when absent. True if written. */
  set(
    key: string,
    value: string,
    options: { px: number; nx?: boolean },
  ): Promise<boolean>;
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

function kvFor(client: RedisClient): Kv {
  return {
    get: (key) => client.get(key),
    set: async (key, value, { px, nx }) =>
      (await client.set(key, value, {
        expiration: { type: "PX", value: px },
        ...(nx ? { condition: "NX" as const } : {}),
      })) === "OK",
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
  const client = newClient(env().REDIS_URL);
  const subscriber = client.duplicate();
  // Never log the error itself: it can include the URL and its password.
  client.on("error", () => logErrorId("redis_error"));
  subscriber.on("error", () => logErrorId("redis_subscriber_error"));
  await Promise.all([client.connect(), subscriber.connect()]);
  return {
    kv: kvFor(client),
    publisher: client as unknown as Publisher,
    subscriber: subscriber as unknown as Subscriber,
  };
}

/** Shared Redis connections for the server process, connected on first use. */
export function getRedis(): Promise<RedisConnections> {
  connecting ??= connect().catch((error) => {
    connecting = null;
    throw error;
  });
  return connecting;
}
