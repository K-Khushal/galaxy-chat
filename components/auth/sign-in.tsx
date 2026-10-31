"use client";
import Link from "next/link";
import Script from "next/script";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth/client";

declare global {
  interface Window {
    turnstile: {
      render(element: HTMLElement, options: Record<string, unknown>): string;
      reset(id: string): void;
    };
  }
}
export function SignInPanel({ siteKey }: { siteKey: string }) {
  const widget = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string>(null);
  const [token, setToken] = useState("");
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [sent, setSent] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  async function perform(action: () => Promise<{ error?: unknown }>) {
    setPending(true);
    setError("");
    try {
      const result = await action();
      if (result.error) throw new Error();
    } catch {
      setError("Sign-in failed. Check your code or try again later.");
    } finally {
      setPending(false);
    }
  }
  return (
    <section className="w-full max-w-sm space-y-6 text-center">
      <h1 className="text-4xl font-semibold tracking-tight">Galaxy</h1>
      <p className="text-muted-foreground">
        Your favourite AI models, together in one Chat.
      </p>
      <div className="space-y-3">
        {(["github", "google"] as const).map((provider) => (
          <Button
            key={provider}
            className="w-full"
            variant="outline"
            disabled={pending}
            onClick={() =>
              void perform(() =>
                authClient.signIn.social({ provider, callbackURL: "/chat" }),
              )
            }
          >
            Continue with {provider === "github" ? "GitHub" : "Google"}
          </Button>
        ))}
      </div>
      <form
        className="space-y-3 text-left"
        onSubmit={(event) => {
          event.preventDefault();
          void perform(async () => {
            if (sent) {
              const result = await authClient.signIn.emailOtp({ email, otp });
              if (!result.error) window.location.assign("/chat");
              return result;
            }
            try {
              const result = await authClient.emailOtp.sendVerificationOtp({
                email,
                type: "sign-in",
                fetchOptions: { headers: { "x-turnstile-token": token } },
              });
              if (!result.error) setSent(true);
              return result;
            } finally {
              setToken("");
              if (widgetId.current) window.turnstile.reset(widgetId.current);
            }
          });
        }}
      >
        <label className="text-sm" htmlFor="email">
          Email
        </label>
        <input
          className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-2 focus-visible:outline-ring"
          id="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          disabled={sent || pending}
          onChange={(e) => setEmail(e.target.value)}
        />
        {sent && (
          <>
            <label className="text-sm" htmlFor="otp">
              Six-digit code
            </label>
            <input
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-2 focus-visible:outline-ring"
              id="otp"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              required
              value={otp}
              onChange={(e) => setOtp(e.target.value)}
            />
            <p className="text-sm text-muted-foreground">
              Check your email. The code expires in 5 minutes.
            </p>
          </>
        )}
        <div ref={widget} hidden={sent} />
        <Script
          src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
          onReady={() => {
            if (widget.current && !widgetId.current)
              widgetId.current = window.turnstile.render(widget.current, {
                sitekey: siteKey,
                callback: (value: string) => setToken(value),
                "expired-callback": () => setToken(""),
                "error-callback": () => setToken(""),
              });
          }}
        />
        <Button
          className="w-full"
          type="submit"
          disabled={pending || (!sent && !token)}
        >
          {pending ? "Please wait…" : sent ? "Sign in" : "Email me a code"}
        </Button>
        {sent && (
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setSent(false);
              setOtp("");
            }}
          >
            Use another email or request a new code
          </Button>
        )}
      </form>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        By continuing, you agree to our{" "}
        <Link className="underline" href="/terms">
          Terms
        </Link>{" "}
        and{" "}
        <Link className="underline" href="/privacy">
          Privacy Policy
        </Link>
        .
      </p>
    </section>
  );
}
