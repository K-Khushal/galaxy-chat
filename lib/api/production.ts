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
import { errorResponse } from "@/lib/api/respond";
import { requireAccess } from "@/lib/auth/access";
import { testOpenRouterKey } from "@/lib/byok/store";
import { getDb } from "@/lib/db/client";
import { env } from "@/lib/env";
import { redisRateLimit } from "@/lib/ratelimit";
import { getRedis } from "@/lib/redis";

const languageModel: LanguageModelFactory = (modelId, apiKey, options) =>
  createOpenRouter({ apiKey, compatibility: "strict" }).chat(modelId, {
    usage: { include: true },
    ...(options.reasoningEffort
      ? { reasoning: { effort: options.reasoningEffort } }
      : {}),
  });

let streams: ResumableStreamContext | null = null;

async function appContext(): Promise<AppContext> {
  const config = env();
  const redis = await getRedis();
  streams ??= createResumableStreamContext({
    publisher: redis.publisher,
    subscriber: redis.subscriber,
    waitUntil: (promise) => after(() => promise),
    keyPrefix: "galaxy:generation",
  });
  return {
    db: getDb(),
    kv: redis.kv,
    streams,
    rateLimit: redisRateLimit(redis.kv),
    languageModel,
    platformKey: config.OPENROUTER_API_KEY,
    byokEnv: process.env,
    testByokKey: (key) => testOpenRouterKey(key),
    authenticate: async (request) =>
      (await requireAccess(request.headers)).userId,
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
    let ctx: AppContext;
    try {
      ctx = await appContext();
    } catch (error) {
      return errorResponse(error);
    }
    return handler(ctx, request, (await params)?.id ?? "");
  };
}
