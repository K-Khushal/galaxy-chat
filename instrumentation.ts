import * as Sentry from "@sentry/nextjs";
import { testE2eEnabled } from "@/lib/env";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs")
    await import("./sentry.server.config");
  if (process.env.NEXT_RUNTIME === "edge") await import("./sentry.edge.config");
  if (!testE2eEnabled()) return;
  const original = globalThis.fetch;
  globalThis.fetch = Object.assign(
    (
      input: Parameters<typeof fetch>[0],
      init?: Parameters<typeof fetch>[1],
    ) => {
      const url = new URL(
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url,
      );
      if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) {
        throw new Error(`E2E blocked external fetch: ${url.origin}`);
      }
      return original(input, init);
    },
    original,
  );
}

export const onRequestError: typeof Sentry.captureRequestError = (
  error,
  request,
  context,
) => {
  const errorId =
    (error as Error & { digest?: string; errorId?: string }).digest ??
    (error as Error & { errorId?: string }).errorId ??
    "unexpected_error";
  Sentry.withScope((scope) => {
    scope.setTag("errorId", errorId);
    Sentry.captureRequestError(error, request, context);
  });
};
