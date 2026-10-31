"use client";
import {
  ArrowRight,
  Github,
  Loader2,
  LockKeyhole,
  Sparkles,
} from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth/client";

const notices: Record<string, string> = {
  unauthenticated: "Sign in to open your workspace.",
  invite_required:
    "This GitHub account does not have an invitation yet. Try an invited account or contact the person who invited you.",
};
export function SignInPanel({ notice }: { notice?: string }) {
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState(false);
  async function signIn() {
    setPending(true);
    setFailure(false);
    try {
      const result = await authClient.signIn.social({
        provider: "github",
        callbackURL: "/",
      });
      if (result.error) {
        setFailure(true);
        setPending(false);
      }
    } catch {
      setFailure(true);
      setPending(false);
    }
  }
  return (
    <section className="w-full max-w-md">
      <div className="mb-10 flex items-center gap-2.5">
        <Sparkles aria-hidden="true" className="size-6 text-primary" />
        <span className="text-lg font-semibold tracking-tight">
          Galaxy Chat
        </span>
      </div>
      <h1 className="text-3xl font-medium tracking-tight">Sign in to Galaxy</h1>
      <p className="mt-4 text-base leading-relaxed text-muted-foreground">
        Sign in to keep your conversations together and pick up where you left
        off.
      </p>
      <div className="mt-8 rounded-2xl border bg-card p-6 shadow-xs">
        <p className="mb-5 text-sm leading-relaxed text-muted-foreground">
          {(notice && notices[notice]) ||
            "Access is by invitation. Continue with your invited GitHub account."}
        </p>
        <Button
          className="w-full"
          disabled={pending}
          aria-busy={pending}
          onClick={() => void signIn()}
        >
          {pending ? <Loader2 className="animate-spin" /> : <Github />}Continue
          with GitHub
          <ArrowRight className="ml-auto" />
        </Button>
        {failure && (
          <p role="alert" className="mt-4 text-sm text-destructive">
            Sign-in could not start. Please try again.
          </p>
        )}
      </div>
      <p className="mt-6 flex items-center gap-2 text-xs text-muted-foreground">
        <LockKeyhole aria-hidden="true" className="size-3.5" />
        Conversations are private to your account.
      </p>
    </section>
  );
}
