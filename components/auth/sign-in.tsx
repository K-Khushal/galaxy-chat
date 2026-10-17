"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth/client";

const notices: Record<string, string> = {
  auth_unconfigured:
    "Authentication is not configured. Add the server environment variables from .env.example. Sign-in stays unavailable until then.",
  unauthenticated: "Sign in with GitHub to continue.",
  invite_required: "This GitHub account is not on the server invite list.",
};

export function SignInPanel({
  configured,
  notice,
}: {
  configured: boolean;
  notice?: string;
}) {
  const [pending, setPending] = useState(false);
  const message = notice ? notices[notice] : undefined;

  return (
    <section className="flex flex-col gap-4 rounded-lg border p-6">
      <h1 className="font-semibold text-xl">Sign in</h1>
      {message ? <p>{message}</p> : null}
      {configured ? (
        <Button
          disabled={pending}
          onClick={() => {
            setPending(true);
            void authClient.signIn.social({
              provider: "github",
              callbackURL: "/chat",
            });
          }}
          type="button"
        >
          {pending ? "Redirecting" : "Continue with GitHub"}
        </Button>
      ) : (
        <p>
          GitHub OAuth is the sign-in method. This server has no auth secret,
          database, or GitHub client configured, so it will not create a
          session.
        </p>
      )}
    </section>
  );
}
