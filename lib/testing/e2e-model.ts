import "server-only";
import { MockLanguageModelV4 } from "ai/test";
import type { LanguageModelFactory } from "@/lib/api/context";
import { scriptedStream } from "../../tests/support/mock-model";

/** Reuses the M4 mock; slow only when the Message explicitly requests it. */
export const e2eLanguageModel: LanguageModelFactory = (modelId) =>
  new MockLanguageModelV4({
    modelId,
    doStream: async (request) => {
      const slow = JSON.stringify(request.prompt).includes("[slow]");
      return {
        stream: scriptedStream(
          {
            words: [
              "A thoughtful Reply. ",
              ...(slow ? Array(30).fill("Still streaming. ") : []),
              "Complete.",
            ],
            delayMs: slow ? 150 : 5,
          },
          request.abortSignal,
        ),
      };
    },
    doGenerate: async () => ({
      content: [{ type: "text", text: '"E2E Chat"' }],
      finishReason: { unified: "stop", raw: "stop" },
      usage: {
        inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: 1, text: 1, reasoning: 0 },
      },
      warnings: [],
    }),
  });
