import type { ErrorEvent } from "@sentry/nextjs";

/** Allowlist only: provider errors and browser state may contain private Chat data. */
export function scrubEvent(event: ErrorEvent): ErrorEvent {
  return {
    event_id: event.event_id,
    timestamp: event.timestamp,
    platform: event.platform,
    level: event.level,
    environment: event.environment,
    release: event.release,
    type: event.type,
    tags: event.tags?.errorId ? { errorId: event.tags.errorId } : {},
    exception: event.exception
      ? {
          values: event.exception.values?.map((exception) => ({
            stacktrace: {
              frames: exception.stacktrace?.frames?.map((frame) => ({
                function: frame.function,
                filename: frame.filename?.split(/[?#]/)[0],
                lineno: frame.lineno,
              })),
            },
            type: "ApplicationError",
            value: "Application error (details redacted)",
          })),
        }
      : undefined,
  };
}
