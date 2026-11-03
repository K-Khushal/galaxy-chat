"use client";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/state";
import { reportError } from "@/lib/client-errors";

export default function RootError({
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
    <main className="flex min-h-dvh items-center justify-center">
      <ErrorState
        description="Galaxy hit an unexpected error."
        errorId={errorId}
        action={
          <Button variant="outline" onClick={() => reset()}>
            Try again
          </Button>
        }
      />
    </main>
  );
}
