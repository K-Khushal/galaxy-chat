import "server-only";
import type { AppContext } from "@/lib/api/context";
import {
  type ActiveGeneration,
  getActiveGeneration,
  requestStop,
} from "@/lib/generation/locks";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * resumable-stream waits ~1s for the producer to answer, but its timer can
 * fire at exactly 1000ms and then never settle. Give up on our own clock.
 */
const PRODUCER_ANSWER_MS = 2_500;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("producer did not answer")), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Replays the Chat's running Generation from its first chunk and follows it.
 * Null when nothing is running or its producer is gone: the client then reads
 * the Reply from Postgres (finished, or Interrupted at its last checkpoint).
 */
export async function resumeGeneration(
  ctx: Pick<AppContext, "kv" | "streams">,
  chatId: string,
): Promise<ReadableStream<string> | null> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const active = await getActiveGeneration(ctx.kv, chatId);
    if (!active) return null;
    const resuming = ctx.streams.resumeExistingStream(active.generationId);
    let stream: ReadableStream<string> | null | undefined;
    try {
      stream = await withTimeout(resuming, PRODUCER_ANSWER_MS);
    } catch {
      // No producer answered: the function running it died. Drop a late answer.
      resuming.then((late) => late?.cancel()).catch(() => {});
      return null;
    }
    if (stream !== undefined) return stream;
    // Locked but not yet registered: the POST that started it is racing us.
    await sleep(150);
  }
  return null;
}

/** Signals the Chat's running Generation to stop. Null when none is running. */
export async function stopGeneration(
  ctx: Pick<AppContext, "kv">,
  chatId: string,
): Promise<ActiveGeneration | null> {
  const active = await getActiveGeneration(ctx.kv, chatId);
  if (active) await requestStop(ctx.kv, active.generationId);
  return active;
}
