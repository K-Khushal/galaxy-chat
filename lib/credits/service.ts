import "server-only";
import { createHash } from "node:crypto";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import {
  createGateway,
  type LanguageModelUsage,
  type ModelMessage,
  streamText,
  toUIMessageStream,
  type UIMessageChunk,
} from "ai";
import { redactedFundedModel } from "@/lib/ai/redacted-model";
import type { EnvSource } from "@/lib/auth/env";
import { AppError } from "@/lib/errors";
import {
  type FundingConfig,
  INSTRUCTIONS,
  LIMITS,
  resolveFundingConfig,
  worstCaseMicrodollars,
} from "./config";
import { type Actor, CreditStore, type Reservation } from "./store";

export type TextTurn = { role: "user" | "assistant"; content: string };
export function boundContext(turns: TextTurn[], guest = false): TextTurn[] {
  if (!turns.length || turns.at(-1)?.role !== "user")
    throw new AppError("invalid_request", 400);
  const selected = turns.slice(-(guest ? 1 : LIMITS.messages));
  const bytes = (value: unknown) =>
    new TextEncoder().encode(JSON.stringify(value)).length;
  if (guest && bytes(selected[0].content) > LIMITS.guestInputBytes)
    throw new AppError("context_too_large", 400);
  while (
    selected.length > 1 &&
    bytes([INSTRUCTIONS, selected]) > LIMITS.inputBytes
  )
    selected.shift();
  if (bytes([INSTRUCTIONS, selected]) > LIMITS.inputBytes)
    throw new AppError("context_too_large", 400);
  return selected;
}

// Parse a provider decimal receipt into integer microdollars, always rounding up.
// No floating-point monetary multiplication and no unknown/default price of zero.
export function receiptMicrodollars(value: unknown): number | undefined {
  if (typeof value !== "number" && typeof value !== "string") return;
  const match = /^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i.exec(String(value));
  if (!match || String(value).length > 100) return;
  const digits = BigInt(match[1] + (match[2] ?? ""));
  const scale = 6 + Number(match[3] ?? 0) - (match[2]?.length ?? 0);
  if (!Number.isInteger(scale) || Math.abs(scale) > 30) return;
  const power = BigInt(10) ** BigInt(Math.abs(scale));
  const result =
    scale >= 0 ? digits * power : (digits + power - BigInt(1)) / power;
  if (result > BigInt(2_000_000_000)) return;
  return Number(result);
}
export function knownReceipt(
  usage: LanguageModelUsage,
): { microdollars: number; usage: Record<string, unknown> } | undefined {
  const input = usage.inputTokens;
  const output = usage.outputTokens;
  const raw = usage.raw;
  if (
    input === undefined ||
    output === undefined ||
    !Number.isSafeInteger(input) ||
    !Number.isSafeInteger(output) ||
    input < 0 ||
    output < 0 ||
    input > LIMITS.inputTokens ||
    output > LIMITS.outputTokens ||
    !raw ||
    raw.prompt_tokens !== input ||
    raw.completion_tokens !== output ||
    usage.outputTokenDetails.reasoningTokens !== 0
  )
    return;
  const microdollars = receiptMicrodollars(raw.cost);
  if (microdollars === undefined) return;
  return {
    microdollars,
    usage: {
      inputTokens: input,
      outputTokens: output,
      reasoningTokens: 0,
      reportedCostMicrodollars: microdollars,
    },
  };
}

type ProviderCallbacks = {
  complete: (usage: LanguageModelUsage, responseId?: string) => Promise<void>;
  uncertain: () => void;
  signal?: AbortSignal;
};
export type FundedProvider = (
  config: FundingConfig,
  turns: TextTurn[],
  callbacks: ProviderCallbacks,
) => { stream: ReadableStream<UIMessageChunk>; consume: () => Promise<void> };
export function openRouterProvider(
  env: EnvSource,
  fetcher?: typeof fetch,
): FundedProvider {
  return (config, turns, callbacks) => {
    const price = config.price;
    const openrouter = createOpenRouter({
      apiKey: env.OPENROUTER_API_KEY,
      fetch: fetcher,
    });
    const result = streamText({
      model: redactedFundedModel(
        openrouter.chat(price.model, {
          reasoning: { enabled: false, effort: "none" },
          usage: { include: true },
          provider: {
            only: [price.provider],
            allow_fallbacks: false,
            require_parameters: true,
            max_price: {
              prompt: price.inputMicrodollarsPerMillion / 1_000_000,
              completion: price.outputMicrodollarsPerMillion / 1_000_000,
              request: 0,
            },
          },
        }),
      ),
      instructions: INSTRUCTIONS,
      messages: turns satisfies ModelMessage[],
      maxOutputTokens: LIMITS.outputTokens,
      maxRetries: 0,
      abortSignal: AbortSignal.any([
        AbortSignal.timeout(LIMITS.timeoutMs),
        ...(callbacks.signal ? [callbacks.signal] : []),
      ]),
      onError: () => {
        callbacks.uncertain();
      },
      onAbort: () => {
        callbacks.uncertain();
      },
      // A moderated/error answer can still have a complete final billing receipt.
      // Finish reason describes the answer, not whether known spend is chargeable.
      onEnd: async ({ usage, finalStep }) => {
        await callbacks.complete(usage, finalStep.response.id);
      },
    });
    return {
      stream: toUIMessageStream({
        stream: result.stream,
        sendReasoning: false,
        sendSources: false,
        onError: () => "provider_failed",
      }),
      consume: async () => {
        await result.consumeStream();
      },
    };
  };
}

export async function startFundedStream(options: {
  env: EnvSource;
  actor: Actor;
  idempotencyKey: string;
  turns: TextTurn[];
  model?: string;
  store?: CreditStore;
  provider?: FundedProvider;
  beforeProvider?: () => Promise<void>;
  signal?: AbortSignal;
}) {
  const config = resolveFundingConfig(options.env);
  if (options.model !== undefined && options.model !== config.price.model)
    throw new AppError("model_not_funded", 403);
  const turns = boundContext(options.turns, options.actor.kind === "guest");
  const digest = createHash("sha256")
    .update(
      JSON.stringify({
        turns,
        model: config.price.model,
        instructions: INSTRUCTIONS,
      }),
    )
    .digest("hex");
  const store = options.store ?? new CreditStore();
  const reservation = await store.reserve({
    actor: options.actor,
    idempotencyKey: options.idempotencyKey,
    digest,
    config,
    microdollars: worstCaseMicrodollars(config.price),
  });
  return enterAndStart({ ...options, store, config, turns, reservation });
}

async function enterAndStart(options: {
  env: EnvSource;
  actor: Actor;
  store: CreditStore;
  config: FundingConfig;
  turns: TextTurn[];
  reservation: Reservation;
  provider?: FundedProvider;
  beforeProvider?: () => Promise<void>;
  signal?: AbortSignal;
}) {
  const { store, actor, reservation } = options;
  let entered = false;
  let uncertain = false;
  let settled = false;
  let providerReference: string | undefined;
  try {
    options.signal?.throwIfAborted();
    await options.beforeProvider?.();
    // Recheck the environment kill switch immediately before the durable claim.
    resolveFundingConfig(options.env);
    await store.enter(reservation.id, actor);
    entered = true;
    const result = (options.provider ?? openRouterProvider(options.env))(
      options.config,
      options.turns,
      {
        signal: options.signal,
        uncertain: () => {
          uncertain = true;
        },
        complete: async (usage, responseId) => {
          if (responseId && responseId.length <= 200)
            providerReference = responseId;
          const receipt = knownReceipt(usage);
          if (!receipt) {
            const observed = receiptMicrodollars(usage.raw?.cost);
            const breached =
              (usage.inputTokens ?? 0) > LIMITS.inputTokens ||
              (usage.outputTokens ?? 0) > LIMITS.outputTokens ||
              (usage.outputTokenDetails.reasoningTokens ?? 0) > 0;
            await store.finish(reservation.id, actor, {
              kind: "unknown",
              incurredMicrodollars: observed,
              stop: breached,
              evidence: providerReference,
            });
            return;
          }
          const state = await store.finish(reservation.id, actor, {
            kind: "known",
            ...receipt,
            evidence: `provider-receipt:${providerReference ?? reservation.id}`,
          });
          settled = state === "settled";
        },
      },
    );
    // Drain independent of the response consumer. A client cancellation is NOT
    // evidence of zero provider spend. Runtime termination leaves a durable hold.
    const completion = result
      .consume()
      .catch(() => {
        uncertain = true;
      })
      .then(async () => {
        if (!settled)
          await store.finish(reservation.id, actor, {
            kind: "unknown",
            evidence:
              providerReference ??
              (uncertain ? "provider-stream-interrupted" : undefined),
          });
      });
    return { stream: result.stream, completion, reservationId: reservation.id };
  } catch (error) {
    await store.finish(reservation.id, actor, {
      kind: entered ? "unknown" : "before_entry",
    });
    throw error;
  }
}

/** Explicit Gateway adapter. It is deliberately excluded from funded execution:
 * Gateway raw usage is not an OpenRouter cost receipt. Never infer a zero bill.
 */
export function gatewayProvider(
  env: EnvSource,
  fetcher?: typeof fetch,
): FundedProvider {
  return (config, turns, callbacks) => {
    if (!env.AI_GATEWAY_API_KEY)
      throw new AppError("provider_unconfigured", 503);
    const gateway = createGateway({
      apiKey: env.AI_GATEWAY_API_KEY,
      fetch: fetcher,
    });
    const result = streamText({
      model: redactedFundedModel(gateway(config.price.model)),
      instructions: INSTRUCTIONS,
      messages: turns,
      providerOptions: { gateway: { only: [config.price.provider] } },
      maxOutputTokens: LIMITS.outputTokens,
      maxRetries: 0,
      abortSignal: AbortSignal.any([
        AbortSignal.timeout(LIMITS.timeoutMs),
        ...(callbacks.signal ? [callbacks.signal] : []),
      ]),
      onError: () => callbacks.uncertain(),
      onAbort: () => callbacks.uncertain(),
      onEnd: async () => {
        callbacks.uncertain();
      },
    });
    return {
      stream: toUIMessageStream({
        stream: result.stream,
        sendReasoning: false,
        sendSources: false,
        onError: () => "provider_failed",
      }),
      consume: async () => {
        await result.consumeStream();
      },
    };
  };
}
