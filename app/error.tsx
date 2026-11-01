"use client";
import { TriangleAlert } from "lucide-react";
import { useEffect } from "react";
import { StatePanel } from "@/components/shell/state-panel";
import { Button } from "@/components/ui/button";
import { reportError } from "@/lib/client-errors";

export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    reportError(error, { errorId: error.digest ?? "unexpected_error" });
  }, [error]);
  return (
    <main className="flex min-h-dvh items-center justify-center">
      <StatePanel
        icon={<TriangleAlert />}
        title="Something went wrong"
        description={`Galaxy hit an unexpected error. Error ID: ${error.digest ?? "unexpected_error"}`}
        action={
          <Button variant="outline" onClick={() => reset()}>
            Try again
          </Button>
        }
      />
    </main>
  );
}
