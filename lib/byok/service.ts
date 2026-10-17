import "server-only";
import { createHash } from "node:crypto";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import {
  createGateway,
  streamText,
  toUIMessageStream,
  wrapLanguageModel,
} from "ai";
import type { EnvSource } from "@/lib/auth/env";
import { INSTRUCTIONS, LIMITS } from "@/lib/credits/config";
import { boundedJson } from "@/lib/credits/http";
import { boundContext, type TextTurn } from "@/lib/credits/service";
import { AppError, logErrorId } from "@/lib/errors";
import { BYOK_LIMITS, resolveByokModel, resourceDigest } from "./config";
import type { ByokProvider } from "./contract";
import { ByokStore } from "./store";

export async function testCredential(options: {
  userId: string;
  provider: ByokProvider;
  revision: string;
  env: EnvSource;
  store?: ByokStore;
  fetcher?: typeof fetch;
  signal?: AbortSignal;
}) {
  const store = options.store ?? new ByokStore();
  const id = crypto.randomUUID();
  await store.reserve({
    id,
    userId: options.userId,
    provider: options.provider,
    kind: "test",
    digest: createHash("sha256").update(options.revision).digest("hex"),
    env: options.env,
    revision: options.revision,
  });
  let entered = false;
  let state: "valid" | "invalid" | "unavailable" = "unavailable";
  try {
    options.signal?.throwIfAborted();
    const key = await store.enter(id, options.userId, options.env);
    entered = true;
    const response = await (options.fetcher ?? fetch)(
      options.provider === "openrouter"
        ? "https://openrouter.ai/api/v1/key"
        : "https://ai-gateway.vercel.sh/v1/credits",
      {
        method: "GET",
        headers: { authorization: `Bearer ${key}`, accept: "application/json" },
        redirect: "error",
        cache: "no-store",
        signal: AbortSignal.any([
          AbortSignal.timeout(8000),
          ...(options.signal ? [options.signal] : []),
        ]),
      },
    );
    if (response.status === 401 || response.status === 403) {
      await response.body?.cancel();
      state = "invalid";
    } else if (response.ok) {
      const body = await boundedJson(
        new Request("http://metadata.invalid", {
          method: "POST",
          body: response.body,
          duplex: "half",
        } as RequestInit),
        BYOK_LIMITS.metadataBytes,
      );
      if (body && typeof body === "object") {
        if (
          options.provider === "openrouter" &&
          "data" in body &&
          body.data &&
          typeof body.data === "object"
        ) {
          const data = body.data;
          if (
            ("is_management_key" in data && data.is_management_key === true) ||
            ("is_provisioning_key" in data &&
              data.is_provisioning_key === true) ||
            ("disabled" in data && data.disabled === true) ||
            ("expires_at" in data &&
              typeof data.expires_at === "string" &&
              new Date(data.expires_at).getTime() <= Date.now())
          )
            state = "invalid";
          else if (
            "is_free_tier" in data &&
            typeof data.is_free_tier === "boolean"
          )
            state = "valid";
        }
        if (
          options.provider === "gateway" &&
          "balance" in body &&
          "total_used" in body &&
          typeof body.balance === "string" &&
          typeof body.total_used === "string" &&
          /^\d+(\.\d+)?$/.test(body.balance) &&
          /^\d+(\.\d+)?$/.test(body.total_used)
        )
          state = "valid";
      }
    } else await response.body?.cancel();
  } catch {
    // Do not return provider bodies, headers, exception messages or credentials.
    state = "unavailable";
  } finally {
    await store.finish(
      id,
      options.userId,
      entered ? "terminal" : "before_entry",
      options.env,
    );
  }
  await store.tested(options.userId, options.provider, options.revision, state);
  return { state };
}

/** Separate credential and resource path: never reads a platform API key, price or ledger. */
export async function startByokStream(options: {
  userId: string;
  provider: ByokProvider;
  model: string;
  idempotencyKey: string;
  turns: TextTurn[];
  env: EnvSource;
  signal?: AbortSignal;
  store?: ByokStore;
  fetcher?: typeof fetch;
  beforeProvider?: () => Promise<void>;
}) {
  const model = resolveByokModel(options.env, options.model, options.provider);
  const turns = boundContext(options.turns);
  const store = options.store ?? new ByokStore();
  const revision = await store.reserve({
    id: options.idempotencyKey,
    userId: options.userId,
    provider: options.provider,
    kind: "chat",
    digest: resourceDigest(
      JSON.stringify({ turns, model, instructions: INSTRUCTIONS }),
      options.env,
    ),
    env: options.env,
  });
  let entered = false;
  let terminal = false;
  let invalid = false;
  try {
    options.signal?.throwIfAborted();
    await options.beforeProvider?.();
    // Configuration and credential revocation are rechecked at the entry boundary.
    resolveByokModel(options.env, options.model, options.provider);
    const key = await store.enter(
      options.idempotencyKey,
      options.userId,
      options.env,
    );
    entered = true;
    const fetcher: typeof fetch = Object.assign(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        try {
          const response = await (options.fetcher ?? fetch)(input, {
            ...init,
            redirect: "error",
          });
          if (response.status === 401 || response.status === 403) {
            invalid = true;
            terminal = true;
            await store.tested(
              options.userId,
              options.provider,
              revision,
              "invalid",
            );
          }
          return response;
        } catch {
          throw new AppError("byok_provider_failed", 502);
        }
      },
      { preconnect: fetch.preconnect },
    );
    const providerModel =
      model.adapter === "openrouter"
        ? createOpenRouter({ apiKey: key, fetch: fetcher }).chat(model.model, {
            reasoning: model.capabilities.reasoning
              ? { enabled: true, max_tokens: 128 }
              : { enabled: false, effort: "none" },
            provider: {
              only: [model.provider],
              allow_fallbacks: false,
              require_parameters: true,
            },
          })
        : createGateway({ apiKey: key, fetch: fetcher })(model.model);
    const result = streamText({
      model: wrapLanguageModel({
        model: providerModel,
        middleware: {
          specificationVersion: "v4",
          // The SDK logs provider warnings by default. Strip remote diagnostics
          // before that boundary; never persist or expose raw provider metadata.
          wrapStream: async ({ doStream }) => {
            const result = await Promise.resolve(doStream()).catch(() => {
              throw new AppError("byok_provider_failed", 502);
            });
            return {
              ...result,
              request: undefined,
              response: undefined,
              stream: result.stream.pipeThrough(
                new TransformStream({
                  transform(part, controller) {
                    if (part.type === "raw") return;
                    if (part.type === "stream-start")
                      controller.enqueue({ ...part, warnings: [] });
                    else if (part.type === "error")
                      controller.enqueue({
                        type: "error",
                        error: new AppError("byok_provider_failed", 502),
                      });
                    else if ("providerMetadata" in part) {
                      const { providerMetadata: _metadata, ...clean } = part;
                      controller.enqueue(clean);
                    } else controller.enqueue(part);
                  },
                }),
              ),
            };
          },
        },
      }),
      ...(model.adapter === "gateway"
        ? { providerOptions: { gateway: { only: [model.provider] } } }
        : {}),
      instructions: INSTRUCTIONS,
      messages: turns,
      maxOutputTokens: LIMITS.outputTokens,
      maxRetries: 0,
      abortSignal: AbortSignal.any([
        AbortSignal.timeout(LIMITS.timeoutMs),
        ...(options.signal ? [options.signal] : []),
      ]),
      onError: () => {},
      onAbort: () => {},
      onEnd: ({ finalStep }) => {
        if (
          ["stop", "length", "content-filter"].includes(finalStep.finishReason)
        )
          terminal = true;
      },
    });
    const stream = toUIMessageStream({
      stream: result.stream,
      sendReasoning: model.capabilities.reasoning,
      sendSources: model.capabilities.sources,
      onError: () => (invalid ? "byok_key_invalid" : "byok_provider_failed"),
    });
    const completion = Promise.resolve(result.consumeStream())
      .catch(() => {})
      .then(() =>
        store.finish(
          options.idempotencyKey,
          options.userId,
          terminal ? "terminal" : "unknown",
          options.env,
        ),
      );
    void completion.catch(() => logErrorId("byok_completion_failed"));
    return { stream, completion };
  } catch {
    await store.finish(
      options.idempotencyKey,
      options.userId,
      entered ? "unknown" : "before_entry",
      options.env,
    );
    throw new AppError(
      options.signal?.aborted ? "request_cancelled" : "byok_key_unavailable",
      options.signal?.aborted ? 499 : 503,
    );
  }
}
