import type { Publisher, Subscriber } from "resumable-stream";
import type { Kv } from "../../lib/redis";

type Entry = { value: string; expiresAt: number | null };

/**
 * An in-memory Redis for tests: the Kv operations plus the pub/sub subset
 * resumable-stream uses. `advance()` moves its clock to expire keys.
 */
export class MemoryRedis implements Kv, Publisher, Subscriber {
  private entries = new Map<string, Entry>();
  private channels = new Map<string, Set<(message: string) => void>>();
  private offset = 0;

  now() {
    return Date.now() + this.offset;
  }

  advance(ms: number) {
    this.offset += ms;
  }

  private read(key: string): Entry | null {
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (entry.expiresAt !== null && entry.expiresAt <= this.now()) {
      this.entries.delete(key);
      return null;
    }
    return entry;
  }

  keys() {
    return [...this.entries.keys()].filter((key) => this.read(key));
  }

  async connect() {}

  async get(key: string) {
    return this.read(key)?.value ?? null;
  }

  async set(
    key: string,
    value: string,
    options?: { px?: number; nx?: boolean; EX?: number },
  ) {
    if (options?.nx && this.read(key)) return false;
    const ttl = options?.px ?? (options?.EX ? options.EX * 1000 : null);
    this.entries.set(key, {
      value,
      expiresAt: ttl === null ? null : this.now() + ttl,
    });
    return true;
  }

  async incr(key: string) {
    const entry = this.read(key);
    const current = entry ? Number(entry.value) : 0;
    if (!Number.isInteger(current)) {
      throw new Error("ERR value is not an integer or out of range");
    }
    this.entries.set(key, {
      value: String(current + 1),
      expiresAt: entry?.expiresAt ?? null,
    });
    return current + 1;
  }

  async delIfEquals(key: string, value: string) {
    if (this.read(key)?.value !== value) return false;
    this.entries.delete(key);
    return true;
  }

  async expireIfEquals(key: string, value: string, px: number) {
    const entry = this.read(key);
    if (entry?.value !== value) return false;
    entry.expiresAt = this.now() + px;
    return true;
  }

  async incrWindow(key: string, px: number) {
    const count = await this.incr(key);
    if (count === 1) {
      const entry = this.entries.get(key);
      if (entry) entry.expiresAt = this.now() + px;
    }
    return count;
  }

  async publish(channel: string, message: string) {
    const listeners = [...(this.channels.get(channel) ?? [])];
    for (const listener of listeners) {
      queueMicrotask(() => listener(message));
    }
    return listeners.length;
  }

  async subscribe(channel: string, callback: (message: string) => void) {
    const listeners = this.channels.get(channel) ?? new Set();
    listeners.add(callback);
    this.channels.set(channel, listeners);
  }

  async unsubscribe(channel: string) {
    this.channels.delete(channel);
  }
}
