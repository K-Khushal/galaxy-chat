"use client";
import { Loader2 } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
/** Presentation only. The server must validate and consume its own exact-action record. */
export function ActionApproval({
  target,
  argumentsText,
  cost,
  state,
  onDecision,
}: {
  target: string;
  argumentsText: string;
  cost: string;
  state: "pending" | "approved" | "denied" | "revoked" | "expired" | "consumed";
  onDecision: (decision: "approve" | "deny" | "revoke") => Promise<void>;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const busy = useRef(false);
  async function decide(decision: "approve" | "deny" | "revoke") {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setError("");
    try {
      await onDecision(decision);
    } catch {
      setError(
        "This approval is no longer available. Review a fresh action before continuing.",
      );
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  return (
    <section
      aria-label="Review exact action"
      className="space-y-4 rounded-lg border border-border p-4"
    >
      <h2 className="font-semibold">Review exact action</h2>
      <p className="break-words text-sm">Target: {target}</p>
      <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted p-3 text-xs">
        {argumentsText}
      </pre>
      <p className="text-sm">
        Cost ceiling: {cost}. Approval expires in five minutes and can be used
        once.
      </p>
      <output className="block text-sm">Approval {state}</output>
      <div className="flex flex-wrap gap-2">
        {state === "pending" ? (
          <>
            <Button
              disabled={pending}
              aria-busy={pending}
              onClick={() => void decide("approve")}
            >
              {pending && (
                <Loader2
                  aria-hidden="true"
                  className="size-4 animate-spin motion-reduce:animate-none"
                />
              )}
              Approve action
            </Button>
            <Button
              variant="outline"
              disabled={pending}
              onClick={() => void decide("deny")}
            >
              Deny action
            </Button>
          </>
        ) : state === "approved" ? (
          <Button
            variant="outline"
            disabled={pending}
            aria-busy={pending}
            onClick={() => void decide("revoke")}
          >
            {pending && (
              <Loader2
                aria-hidden="true"
                className="size-4 animate-spin motion-reduce:animate-none"
              />
            )}
            Revoke approval
          </Button>
        ) : null}
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}
