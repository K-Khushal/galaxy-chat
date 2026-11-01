import type * as SentryModule from "@sentry/nextjs";
import { config } from "zod/v4/core";
import { reportError, sdk, sdkReady } from "./lib/client-errors";
import { scrubEvent } from "./lib/telemetry";

// Zod probes `new Function` for its JIT; under our nonce CSP (no 'unsafe-eval')
// Firefox logs that probe as a violation. Interpreted parsing needs no eval.
config({ jitless: true });

// The Sentry SDK is about 40 KB gzipped and runs before hydration, so it loads
// a few seconds after the page loads. Errors raised in the meantime are held
// and reported when it arrives.
const hold = (event: ErrorEvent | PromiseRejectionEvent) =>
  reportError("reason" in event ? event.reason : event.error);

async function start() {
  const Sentry = await import("@sentry/nextjs");
  Sentry.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT,
    tracesSampleRate: 0.1,
    sendDefaultPii: false,
    beforeSend: scrubEvent,
    beforeSendTransaction: (event) => ({
      type: "transaction",
      transaction: "application",
      event_id: event.event_id,
      start_timestamp: event.start_timestamp,
      timestamp: event.timestamp,
      spans: [],
      contexts: {
        trace: event.contexts?.trace
          ? {
              trace_id: event.contexts.trace.trace_id,
              span_id: event.contexts.trace.span_id,
              op: "application",
            }
          : undefined,
      },
    }),
    beforeBreadcrumb: () => null,
  });
  window.removeEventListener("error", hold);
  window.removeEventListener("unhandledrejection", hold);
  sdkReady(Sentry);
}

if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
  window.addEventListener("error", hold);
  window.addEventListener("unhandledrejection", hold);
  const idle = () => setTimeout(() => void start(), 3000);
  if (document.readyState === "complete") idle();
  else window.addEventListener("load", idle, { once: true });
}

export const onRouterTransitionStart: typeof SentryModule.captureRouterTransitionStart =
  (...args) => sdk()?.captureRouterTransitionStart(...args);
