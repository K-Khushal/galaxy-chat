"use client";

import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/state";

export default function ChatError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex flex-1 items-center justify-center">
      <ErrorState
        description="Galaxy hit an unexpected error."
        errorId={error.digest ?? "unexpected_error"}
        action={
          <Button variant="outline" onClick={() => reset()}>
            Try again
          </Button>
        }
      />
    </div>
  );
}
