"use client"; // Error boundaries must be Client Components
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/state";
import { reportError } from "@/lib/client-errors";

import "./globals.css";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const errorId = error.digest ?? "unexpected_error";
  useEffect(() => {
    reportError(error, { errorId });
  }, [error, errorId]);
  return (
    // global-error replaces the root layout, so it brings its own html, body
    // and styles.
    <html lang="en">
      <body className="flex min-h-dvh items-center justify-center bg-background font-sans text-sm text-foreground antialiased">
        <ErrorState
          description="Galaxy hit an unexpected error."
          errorId={errorId}
          action={
            <Button variant="outline" onClick={() => reset()}>
              Try again
            </Button>
          }
        />
      </body>
    </html>
  );
}
