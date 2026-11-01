import "server-only";
import { MockLanguageModelV4 } from "ai/test";
import type { LanguageModelFactory } from "@/lib/api/context";
import { scriptedStream } from "../../tests/support/mock-model";

/** Explicit Message markers select offline fixtures; ordinary Replies stay fast. */
export const e2eLanguageModel: LanguageModelFactory = (modelId) =>
  new MockLanguageModelV4({
    modelId,
    supportedUrls: {
      "image/*": [/^http:\/\/127\.0\.0\.1:34871\/api\/test-e2e\/storage\?/],
    },
    doStream: async (request) => {
      const prompt = JSON.stringify(request.prompt);
      if (prompt.includes("[attachments]")) {
        if (
          !request.prompt.some(
            (message) =>
              message.role === "user" &&
              message.content.some(
                (part) =>
                  part.type === "file" && part.mediaType.startsWith("image/"),
              ),
          ) ||
          !prompt.includes("offline attachment text")
        ) {
          throw new Error(
            "Mock did not receive image and text attachment parts",
          );
        }
      }
      if (
        prompt.includes("[pdf]") &&
        !prompt.includes("offline PDF astronomy") &&
        !request.prompt.some(
          (message) =>
            message.role === "user" &&
            message.content.some(
              (part) =>
                part.type === "file" && part.mediaType === "application/pdf",
            ),
        )
      )
        throw new Error("Mock did not receive PDF attachment");
      const slow = prompt.includes("[slow]");
      // Content that tends to overflow a narrow screen: unbroken code, a wide table, a long link.
      const wide = prompt.includes("[markdown]");
      // A long Reply streamed in small pieces, to watch rendering cost per token.
      const long = prompt.includes("[long]");
      return {
        stream: scriptedStream(
          {
            failAt: prompt.includes("[interrupted]") ? 1 : undefined,
            words: long
              ? Array.from({ length: 600 }, (_, i) =>
                  i % 60 === 0
                    ? `\n\n## Part ${i / 60}\n\n`
                    : i % 20 === 0
                      ? `\`code${i}\` and **bold** `
                      : `word${i} `,
                )
              : wide
                ? [
                    "Wide content.\n\n```ts\n",
                    `const line = "${"x".repeat(300)}";\n`,
                    "```\n\n",
                    `| One | Two | Three | Four |\n| --- | --- | --- | --- |\n| ${"w".repeat(120)} | b | c | d |\n\n`,
                    `https://example.com/${"a".repeat(200)}\n\n`,
                    "Complete.",
                  ]
                : prompt.includes("[rich]")
              ? [
                  "## Astronomy\n\n**Stars**\n\n" +
                    String.fromCharCode(96).repeat(3) +
                    "js\nconst stars = 3;\n" +
                    String.fromCharCode(96).repeat(3) +
                    "\n\n$$E=mc^2$$",
                ]

                : [
                    "A thoughtful Reply. ",
                    ...(slow ? Array(30).fill("Still streaming. ") : []),
                    "Complete.",
                  ],
            delayMs: slow ? 150 : long ? 8 : 5,
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
