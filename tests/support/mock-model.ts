import type {
  LanguageModelV4StreamPart,
  LanguageModelV4Usage,
} from "@ai-sdk/provider";
import { APICallError } from "ai";
export const BYOK_ENV = {
  BYOK_ENCRYPTION_KEYS_JSON: JSON.stringify({
    v1: Buffer.alloc(32, 7).toString("base64"),
  }),
  BYOK_ACTIVE_KEY_VERSION: "v1",
};
export const PLATFORM_KEY = "platform-key-for-tests";

/** How the mock model behaves for the next Generations. */
export type Script = {
  words: string[];
  /** Delay before each word, in ms. */
  delayMs: number;
  /** Fail before emitting this word (0: before the first token). */
  failAt?: number;
  /** HTTP status of the provider failure. */
  failStatus?: number;
  /** Hang before emitting this word until the request is aborted. */
  hangAt?: number;
};

const usage: LanguageModelV4Usage = {
  inputTokens: { total: 12, noCache: 12, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 34, text: 34, reasoning: 0 },
};

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

export function scriptedStream(script: Script, abortSignal?: AbortSignal) {
  let index = 0;
  let opened = false;
  return new ReadableStream<LanguageModelV4StreamPart>({
    async pull(controller) {
      if (!opened) {
        opened = true;
        controller.enqueue({ type: "stream-start", warnings: [] });
        controller.enqueue({ type: "text-start", id: "t1" });
      }
      await sleep(script.delayMs);
      if (script.hangAt === index && abortSignal && !abortSignal.aborted) {
        await new Promise((done) =>
          abortSignal.addEventListener("abort", done, { once: true }),
        );
      }
      if (abortSignal?.aborted) {
        controller.error(new DOMException("aborted", "AbortError"));
        return;
      }
      if (script.failAt === index) {
        const error = new APICallError({
          message: "provider failed",
          url: "https://openrouter.test",
          requestBodyValues: {},
          statusCode: script.failStatus ?? 500,
          isRetryable: false,
        });
        if (index === 0) {
          controller.enqueue({ type: "error", error });
          controller.close();
        } else {
          controller.error(error);
        }
        return;
      }
      const word = script.words[index];
      if (word !== undefined) {
        controller.enqueue({ type: "text-delta", id: "t1", delta: word });
        index++;
        return;
      }
      controller.enqueue({ type: "text-end", id: "t1" });
      controller.enqueue({
        type: "finish",
        finishReason: { unified: "stop", raw: "stop" },
        usage,
        providerMetadata: { openrouter: { usage: { cost: 0.00042 } } },
      });
      controller.close();
    },
  });
}
