"use client"; // Error boundaries must be Client Components
import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

import "./globals.css";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error, {
      tags: { errorId: error.digest ?? "unexpected_error" },
    });
  }, [error]);
  return (
    // global-error replaces the root layout, so it brings its own html, body
    // and styles.
    <html lang="en">
      <body className="flex min-h-dvh flex-col items-center justify-center gap-3 px-6 text-center">
        <h1 className="text-lg font-medium tracking-tight">
          Something went wrong
        </h1>
        <p className="text-muted-foreground">
          Error ID: {error.digest ?? "unexpected_error"}
        </p>
        <button
          type="button"
          className="h-9 rounded-lg border border-input bg-card px-3 text-sm font-medium"
          onClick={() => reset()}
        >
          Try again
        </button>
      </body>
    </html>
  );
}
