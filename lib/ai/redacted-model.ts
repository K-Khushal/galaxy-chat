import "server-only";
import { wrapLanguageModel } from "ai";
import { AppError } from "@/lib/errors";
/** Keep provider diagnostics away from SDK logging/UI, while preserving usage.raw receipts. */
export function redactedFundedModel(
  model: Parameters<typeof wrapLanguageModel>[0]["model"],
) {
  return wrapLanguageModel({
    model,
    middleware: {
      specificationVersion: "v4",
      wrapStream: async ({ doStream }) => {
        const result = await Promise.resolve(doStream()).catch(() => {
          throw new AppError("provider_failed", 502);
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
                    error: new AppError("provider_failed", 502),
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
  });
}
