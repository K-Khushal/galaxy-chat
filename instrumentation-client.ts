import * as Sentry from "@sentry/nextjs";
import { z } from "zod";
import { scrubEvent } from "./lib/telemetry";

// Zod probes `new Function` for its JIT; under our nonce CSP (no 'unsafe-eval')
// Firefox logs that probe as a violation. Interpreted parsing needs no eval.
z.config({ jitless: true });

if (process.env.NEXT_PUBLIC_SENTRY_DSN)
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
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
