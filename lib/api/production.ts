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
import { requireAccess } from "@/lib/auth/access";
import { testOpenRouterKey } from "@/lib/byok/store";
import { getDb } from "@/lib/db/client";
import { appOrigins, platformKey, testE2eEnabled } from "@/lib/env";
import { redisRateLimit } from "@/lib/ratelimit";
import { getRedis, lazyKv } from "@/lib/redis";
import { e2eLanguageModel } from "@/lib/testing/e2e-model";

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
export function appContext(): AppContext {
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
    languageModel: testE2eEnabled() ? e2eLanguageModel : languageModel,
    platformKey: () => platformKey(),
    byokEnv: process.env,
    testByokKey: (key) =>
      testE2eEnabled()
        ? Promise.resolve(
            key === "e2e-byok-key-00000000000000000000000000000000",
          )
        : testOpenRouterKey(key),
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
    try {
      requireSameOrigin(request, appOrigins());
      return await handler(appContext(), request, (await params)?.id ?? "");
    } catch (error) {
      return errorResponse(error);
    }
  };
}
