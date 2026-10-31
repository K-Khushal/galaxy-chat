import "server-only";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { after } from "next/server";
import {
  createResumableStreamContext,
  type ResumableStreamContext,
} from "resumable-stream";
import {
  type AppContext,
  DEFAULT_TIMING,
  type LanguageModelFactory,
} from "@/lib/api/context";
import { errorResponse, requireSameOrigin } from "@/lib/api/respond";
import { lazyStorage } from "@/lib/attachments/storage";
import { requireAccess } from "@/lib/auth/access";
import { testOpenRouterKey } from "@/lib/byok/store";
import { getDb } from "@/lib/db/client";
import { appOrigins, platformKey, testE2eEnabled } from "@/lib/env";
import { observeRequest } from "@/lib/logger";
import { redisRateLimit } from "@/lib/ratelimit";
import { getRedis, lazyKv } from "@/lib/redis";
import { loadE2eSeams } from "@/lib/testing/load-e2e";

const languageModel: LanguageModelFactory = (modelId, apiKey, options) =>
  createOpenRouter({ apiKey, compatibility: "strict" }).chat(modelId, {
    usage: { include: true },
    ...(options.reasoningEffort
      ? { reasoning: { effort: options.reasoningEffort } }
      : {}),
  });

let streams: ResumableStreamContext | null = null;

async function streamContext(): Promise<ResumableStreamContext> {
  const redis = await getRedis();
  streams ??= createResumableStreamContext({
    publisher: redis.publisher,
    subscriber: redis.subscriber,
    waitUntil: (promise) => after(() => promise),
    keyPrefix: "galaxy:generation",
  });
  return streams;
}

/**
 * Builds the request context without touching Redis, the Platform key or the
 * BYOK keyring: each is read, and Redis connected, only when a route uses it.
 */
export async function appContext(): Promise<AppContext> {
  const seams = testE2eEnabled() ? await loadE2eSeams() : null;
  const kv = lazyKv();
  return {
    db: getDb(),
    kv,
    streams: {
      createNewResumableStream: async (...args) =>
        (await streamContext()).createNewResumableStream(...args),
      resumeExistingStream: async (...args) =>
        (await streamContext()).resumeExistingStream(...args),
    },
    rateLimit: redisRateLimit(kv),
    storage: seams?.storage ?? lazyStorage(),
    languageModel: seams?.e2eLanguageModel ?? languageModel,
    platformKey: () => platformKey(),
    byokEnv: process.env,
    testByokKey: seams?.testByokKey ?? testOpenRouterKey,
    authenticate: async (request) =>
      (await requireAccess(request.headers)).userId,
    sessionCreatedAt: async (request) =>
      (await requireAccess(request.headers)).sessionCreatedAt,
    waitUntil: (promise) => after(() => promise),
    timing: DEFAULT_TIMING,
  };
}

type Params = Promise<Partial<Record<string, string>> | undefined>;

/** Adapts a context-injected handler to a Next.js Route Handler. */
export function route(
  handler: (ctx: AppContext, request: Request, id: string) => Promise<Response>,
) {
  return async (request: Request, { params }: { params: Params }) => {
    return observeRequest(request, async () => {
      try {
        requireSameOrigin(request, appOrigins());
        return await handler(await appContext(), request, (await params)?.id ?? "");
      } catch (error) {
        return errorResponse(error);
      }
    });
  };
}
