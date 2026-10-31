import "server-only";
import type { Kv } from "@/lib/redis";

/**
 * Generation locks live only in Redis, with an expiry (ADR 0004). A running
 * Generation renews them; a crashed one releases them when they expire, so
 * nothing can block a Chat permanently.
 */

/** Concurrent Generations a User may run across all their Chats. */
export const USER_GENERATION_LIMIT = 3;

/** The Generation running in a Chat; the per-Chat lock's value. */
export type ActiveGeneration = {
  generationId: string;
  /** The Reply it writes. */
  messageId: string;
};

export type GenerationLease = {
  chatKey: string;
  chatValue: string;
  slotKey: string;
  generationId: string;
};

const chatKey = (chatId: string) => `galaxy:chat:${chatId}:generation`;
const slotKey = (userId: string, slot: number) =>
  `galaxy:user:${userId}:generation:${slot}`;
const stopKey = (generationId: string) =>
  `galaxy:generation:${generationId}:stop`;

export type AcquireResult =
  | { ok: true; lease: GenerationLease }
  | { ok: false; error: "generation_in_progress" | "too_many_generations" };

/** Takes the Chat's lock, then one of the User's Generation slots. */
export async function acquireGeneration(
  kv: Kv,
  input: { chatId: string; userId: string; active: ActiveGeneration },
  ttlMs: number,
): Promise<AcquireResult> {
  const lockKey = chatKey(input.chatId);
  const lockValue = JSON.stringify(input.active);
  if (!(await kv.set(lockKey, lockValue, { px: ttlMs, nx: true }))) {
    return { ok: false, error: "generation_in_progress" };
  }
  for (let slot = 0; slot < USER_GENERATION_LIMIT; slot++) {
    const key = slotKey(input.userId, slot);
    if (await kv.set(key, input.active.generationId, { px: ttlMs, nx: true })) {
      return {
        ok: true,
        lease: {
          chatKey: lockKey,
          chatValue: lockValue,
          slotKey: key,
          generationId: input.active.generationId,
        },
      };
    }
  }
  await kv.delIfEquals(lockKey, lockValue);
  return { ok: false, error: "too_many_generations" };
}

/** Extends both locks. False when either was lost (e.g. it expired). */
export async function renewGeneration(
  kv: Kv,
  lease: GenerationLease,
  ttlMs: number,
): Promise<boolean> {
  const [chatHeld, slotHeld] = await Promise.all([
    kv.expireIfEquals(lease.chatKey, lease.chatValue, ttlMs),
    kv.expireIfEquals(lease.slotKey, lease.generationId, ttlMs),
  ]);
  return chatHeld && slotHeld;
}

/** Releases both locks, only if this Generation still holds them. */
export async function releaseGeneration(kv: Kv, lease: GenerationLease) {
  await Promise.all([
    kv.delIfEquals(lease.chatKey, lease.chatValue),
    kv.delIfEquals(lease.slotKey, lease.generationId),
  ]);
}

export async function getActiveGeneration(
  kv: Kv,
  chatId: string,
): Promise<ActiveGeneration | null> {
  const value = await kv.get(chatKey(chatId));
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<ActiveGeneration>;
    if (
      typeof parsed.generationId === "string" &&
      typeof parsed.messageId === "string"
    ) {
      return { generationId: parsed.generationId, messageId: parsed.messageId };
    }
  } catch {}
  return null;
}

/** Stop is a durable flag the Generation polls; it outlives a lost pub/sub message. */
export async function requestStop(kv: Kv, generationId: string) {
  await kv.set(stopKey(generationId), "1", { px: 10 * 60_000 });
}

export async function isStopRequested(kv: Kv, generationId: string) {
  return (await kv.get(stopKey(generationId))) !== null;
}
