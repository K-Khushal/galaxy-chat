import { testE2eEnabled } from "@/lib/env";

export function register() {
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
