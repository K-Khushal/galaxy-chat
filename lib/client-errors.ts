import type * as SentryModule from "@sentry/nextjs";

// The browser SDK loads after the page does (see instrumentation-client.ts), so
// errors reported before then wait here. A module import keeps the SDK itself
// out of every route's first bundle.
type Held = [error: unknown, tags?: Record<string, string>];
let sentry: typeof SentryModule | undefined;
const held: Held[] = [];

export function reportError(error: unknown, tags?: Record<string, string>) {
  if (sentry) sentry.captureException(error, tags ? { tags } : undefined);
  else if (held.length < 20) held.push([error, tags]);
}

/** Hands over the initialised SDK and sends everything that was waiting. */
export function sdkReady(loaded: typeof SentryModule) {
  sentry = loaded;
  for (const [error, tags] of held.splice(0)) reportError(error, tags);
}
export const sdk = () => sentry;
