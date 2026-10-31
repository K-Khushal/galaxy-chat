import { readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { MockLanguageModelV4 } from "ai/test";
import { drizzle } from "drizzle-orm/pglite";
import { createResumableStreamContext } from "resumable-stream";
import type { AppContext, GenerationTiming } from "../../lib/api/context";
import { grantSignupCredits, hashGrantIdentity } from "../../lib/credits";
import * as schema from "../../lib/db/schema";
import type { Db } from "../../lib/db/types";
import { AppError } from "../../lib/errors";
import type { RateLimitKind } from "../../lib/ratelimit";
import { MemoryRedis } from "./memory-redis";
import { MemoryStorage } from "./memory-storage";
import {
  BYOK_ENV,
  PLATFORM_KEY,
  type Script,
  scriptedStream,
} from "./mock-model";

export { BYOK_ENV, PLATFORM_KEY, type Script } from "./mock-model";

const usage = {
  inputTokens: { total: 12, noCache: 12, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 34, text: 34, reasoning: 0 },
};
export type ModelCall = {
  modelId: string;
  apiKey: string;
  reasoningEffort?: string;
  maxOutputTokens?: number;
  prompt?: string;
};
const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

export type Harness = Awaited<ReturnType<typeof createHarness>>;

let template: Promise<PGlite> | null = null;

/** A cold PGlite start and migration can take several seconds on CI. */
export const PGLITE_SETUP_TIMEOUT_MS = 60_000;

/**
 * Builds the migrated template database once per file. Call from `beforeAll`
 * with PGLITE_SETUP_TIMEOUT_MS so the first test never pays for it.
 */
export async function warmDatabase() {
  await migratedDatabase();
}

/** A migrated database, created once per test file and cloned per test. */
async function migratedDatabase() {
  template ??= (async () => {
    const pg = await PGlite.create();
    const files = (await readdir("drizzle")).filter((f) => f.endsWith(".sql"));
    for (const file of files.sort()) {
      await pg.exec(await Bun.file(resolve("drizzle", file)).text());
    }
    return pg;
  })();
  return (await (await template).clone()) as PGlite;
}

/** Harnesses not yet closed; each holds a PGlite instance in memory. */
const open = new Set<{ settle: () => Promise<void>; pg: PGlite }>();

/**
 * Waits for every open harness's Generations, then closes its database. Call
 * from `afterEach`: the whole suite runs in one process, and unclosed PGlite
 * instances add up to gigabytes.
 */
export async function closeHarnesses() {
  for (const harness of [...open]) {
    open.delete(harness);
    await harness.settle();
    await harness.pg.close();
  }
}

export async function createHarness(timing: Partial<GenerationTiming> = {}) {
  const pg = await migratedDatabase();
  const db = drizzle(pg, { schema }) as unknown as Db;
  const redis = new MemoryRedis();
  const storage = new MemoryStorage();
  const pending: Promise<unknown>[] = [];
  const waitUntil = (promise: Promise<unknown>) => {
    pending.push(promise);
  };

  const state = {
    script: { words: ["Hello", " there", "!"], delayMs: 1 } as Script,
    title: "A friendly greeting",
    calls: [] as ModelCall[],
    /** Model requests that saw their abort signal. */
    aborts: 0,
    rateLimited: new Set<RateLimitKind>(),
    keyAccepted: true,
  };

  const ctx: AppContext = {
    db,
    kv: redis,
    streams: createResumableStreamContext({
      publisher: redis,
      subscriber: redis,
      waitUntil,
      keyPrefix: "test",
      doneWatchdogIntervalMs: 100,
    }),
    rateLimit: async (kind) => !state.rateLimited.has(kind),
    storage,
    languageModel: (modelId, apiKey, options) => {
      const call: ModelCall = { modelId, apiKey, ...options };
      state.calls.push(call);
      const script = state.script;
      return new MockLanguageModelV4({
        modelId,
        // Read URLs from the mock storage go to the model as they are,
        // as they do for PDFs on OpenRouter.
        supportedUrls: {
          "image/*": [/^https?:\/\/(storage\.test|localhost:3100)\//],
          "application/*": [/^https?:\/\/(storage\.test|localhost:3100)\//],
        },
        doStream: async (request) => {
          call.maxOutputTokens = request.maxOutputTokens;
          call.prompt = JSON.stringify(request.prompt);
          request.abortSignal?.addEventListener(
            "abort",
            () => {
              state.aborts++;
            },
            { once: true },
          );
          return { stream: scriptedStream(script, request.abortSignal) };
        },
        doGenerate: async () => ({
          content: [{ type: "text", text: `"${state.title}"` }],
          finishReason: { unified: "stop", raw: "stop" },
          usage,
          warnings: [],
        }),
      });
    },
    platformKey: () => PLATFORM_KEY,
    byokEnv: BYOK_ENV,
    testByokKey: async () => state.keyAccepted,
    sessionCreatedAt: async () => new Date(),
    authenticate: async (request) => {
      const user = request.headers.get("x-test-user");
      if (!user) throw new AppError("unauthenticated", 401);
      return user;
    },
    waitUntil,
    timing: {
      checkpointMs: 30,
      stopPollMs: 10,
      lockTtlMs: 30_000,
      renewMs: 1_000,
      deadlineMs: 60_000,
      ...timing,
    },
  };

  async function addUser(id: string, credits = 10) {
    await pg.query(`INSERT INTO "user" (id, name, email) VALUES ($1, $1, $2)`, [
      id,
      `${id}@example.com`,
    ]);
    if (credits > 0) {
      await grantSignupCredits(db, id, [
        hashGrantIdentity({ kind: "email", value: `${id}@example.com` }, "k"),
      ]);
      await pg.query(
        `UPDATE credit_balance SET remaining = $2 WHERE user_id = $1`,
        [id, credits],
      );
    }
  }

  /** Waits for every Generation and background task to finish. */
  async function settle() {
    let seen = -1;
    while (seen !== pending.length) {
      seen = pending.length;
      await Promise.allSettled(pending);
    }
  }

  open.add({ settle, pg });
  return { ctx, db, pg, redis, storage, state, addUser, settle };
}

type Handler = (
  ctx: AppContext,
  request: Request,
  id: string,
) => Promise<Response>;

/** Calls a route handler as `user` (no header when null). */
export function call(
  harness: Harness,
  handler: Handler,
  options: {
    user: string | null;
    id?: string;
    method?: string;
    body?: unknown;
    query?: string;
  },
) {
  const headers = new Headers({ "content-type": "application/json" });
  if (options.user) headers.set("x-test-user", options.user);
  const request = new Request(`http://test.local/api${options.query ?? ""}`, {
    method: options.method ?? (options.body === undefined ? "GET" : "POST"),
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  return handler(harness.ctx, request, options.id ?? "");
}

export type Chunk = { type: string; [key: string]: unknown };

/** Parses an AI SDK UI message SSE body into chunks. */
export function parseSse(text: string): Chunk[] {
  return text
    .split("\n\n")
    .map((event) => event.trim())
    .filter((event) => event.startsWith("data: "))
    .map((event) => event.slice("data: ".length))
    .filter((data) => data !== "[DONE]")
    .map((data) => JSON.parse(data) as Chunk);
}

export function textOf(chunks: Chunk[]) {
  return chunks
    .filter((chunk) => chunk.type === "text-delta")
    .map((chunk) => chunk.delta)
    .join("");
}

export { sleep };
