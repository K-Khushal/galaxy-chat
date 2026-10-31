import * as Sentry from "@sentry/nextjs";
import { observabilityEnv } from "./lib/env";
import { scrubEvent } from "./lib/telemetry";

const env = observabilityEnv();
if (env.SENTRY_DSN)
  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.SENTRY_ENVIRONMENT,
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
