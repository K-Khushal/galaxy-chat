"use client";
import Link from "next/link";
import Script from "next/script";
import { useTheme } from "next-themes";
import { type CSSProperties, useEffect, useRef, useState } from "react";
import { GalaxyMark, GitHubMark, GoogleMark } from "@/components/icons/brand";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import { InlineAlert } from "@/components/ui/state";
import { authClient } from "@/lib/auth/client";

declare global {
  interface Window {
    turnstile: {
      render(element: HTMLElement, options: Record<string, unknown>): string;
      reset(id: string): void;
    };
  }
}

type Provider = "github" | "google";
type Pending = Provider | "email" | "code" | null;

const PROVIDERS = {
  github: { label: "GitHub", Mark: GitHubMark },
  google: { label: "Google", Mark: GoogleMark },
} as const;

/** How long a submit waits for a Turnstile token before giving up. */
const TOKEN_TIMEOUT_MS = 10_000;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** One orchestrated reveal on first paint: each child enters 60ms after the last. */
const reveal =
  "transition-[opacity,translate] duration-240 ease-out starting:opacity-0 motion-safe:starting:translate-y-1 [transition-delay:calc(var(--i)*60ms)]";
type TokenStore = { value: string; waiters: Array<(value: string) => void> };
/** Records Turnstile's token ("" clears it) and releases any submit waiting for it. */
function deliverToken(store: TokenStore, value: string) {
  store.value = value;
  if (value) for (const resolve of store.waiters.splice(0)) resolve(value);
}
const step = (i: number) => ({ "--i": i }) as CSSProperties;

export function SignInPanel({ siteKey }: { siteKey: string }) {
  const { resolvedTheme } = useTheme();
  const widget = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string>(null);
  const codeInput = useRef<HTMLInputElement>(null);
  const emailInput = useRef<HTMLInputElement>(null);
  const token = useRef({
    value: "",
    waiters: [] as Array<(v: string) => void>,
  });
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [sent, setSent] = useState(false);
  const [pending, setPending] = useState<Pending>(null);
  const [emailError, setEmailError] = useState("");
  const [codeError, setCodeError] = useState("");
  const [socialError, setSocialError] = useState("");
  const [sendError, setSendError] = useState("");
  // Turnstile is a third-party script of several hundred KB that only the email
  // code needs, so it loads when the visitor starts using the email form.
  const [challenge, setChallenge] = useState(false);
  const [scriptReady, setScriptReady] = useState(false);
  const busy = pending !== null;

  function resetWidget() {
    deliverToken(token.current, "");
    if (widgetId.current) window.turnstile.reset(widgetId.current);
  }
  /** Resolves with the token, or with "" when Turnstile does not deliver one in time. */
  function nextToken(): Promise<string> {
    if (token.current.value) return Promise.resolve(token.current.value);
    return new Promise((resolve) => {
      const waiters = token.current.waiters;
      const waiter = (value: string) => {
        clearTimeout(timer);
        resolve(value);
      };
      const timer = setTimeout(() => {
        waiters.splice(waiters.indexOf(waiter), 1);
        resolve("");
      }, TOKEN_TIMEOUT_MS);
      waiters.push(waiter);
    });
  }

  // The widget only exists on the email step: it mounts once the script is
  // ready, and goes away (with its token) on the code step.
  useEffect(() => {
    if (!scriptReady || sent || !widget.current || widgetId.current) return;
    widgetId.current = window.turnstile.render(widget.current, {
      sitekey: siteKey,
      appearance: "interaction-only",
      size: "flexible",
      theme: resolvedTheme === "dark" ? "dark" : "light",
      callback: (value: string) => deliverToken(token.current, value),
      "expired-callback": () => deliverToken(token.current, ""),
      "error-callback": () => deliverToken(token.current, ""),
    });
  }, [scriptReady, sent, siteKey, resolvedTheme]);
  useEffect(() => {
    if (!sent) return;
    codeInput.current?.focus();
    widgetId.current = null;
    deliverToken(token.current, "");
  }, [sent]);

  async function signInWithProvider(provider: Provider) {
    setPending(provider);
    setSocialError("");
    try {
      const result = await authClient.signIn.social({
        provider,
        callbackURL: "/chat",
      });
      if (result.error) throw new Error();
      // The browser is leaving for the provider, so the button stays pending.
    } catch {
      setSocialError("Sign-in failed. Try again.");
      setPending(null);
    }
  }

  async function sendCode() {
    if (!EMAIL_PATTERN.test(email.trim())) {
      setEmailError("Enter a valid email address.");
      emailInput.current?.focus();
      return;
    }
    setPending("email");
    setSendError("");
    const value = await nextToken();
    if (!value) {
      setSendError("Verification didn't finish. Try again.");
      resetWidget();
      setPending(null);
      return;
    }
    try {
      const result = await authClient.emailOtp.sendVerificationOtp({
        email: email.trim(),
        type: "sign-in",
        fetchOptions: { headers: { "x-turnstile-token": value } },
      });
      if (result.error) throw new Error();
      setSent(true);
    } catch {
      setSendError("Couldn't send the code. Try again.");
      resetWidget();
    } finally {
      setPending(null);
    }
  }

  async function verifyCode(code: string) {
    if (!/^[0-9]{6}$/.test(code)) {
      setCodeError("Enter the six-digit code.");
      return;
    }
    setPending("code");
    setCodeError("");
    try {
      const result = await authClient.signIn.emailOtp({
        email: email.trim(),
        otp: code,
      });
      if (result.error) throw new Error();
      window.location.assign("/chat");
    } catch {
      setCodeError("That code didn't work. Check it or request a new one.");
      setPending(null);
    }
  }

  return (
    <section className="relative grid w-full max-w-[22rem] gap-6">
      <div className={`justify-self-center ${reveal}`} style={step(0)}>
        <GalaxyMark className="size-10 text-primary" />
      </div>
      <h1
        className={`text-center text-display font-semibold ${reveal}`}
        style={step(1)}
      >
        Sign in to Galaxy
      </h1>
      <div className={`grid gap-3 ${reveal}`} style={step(2)}>
        {(Object.keys(PROVIDERS) as Provider[]).map((provider) => {
          const { label, Mark } = PROVIDERS[provider];
          return (
            <Button
              key={provider}
              className="w-full"
              variant="outline"
              size="lg"
              pending={pending === provider}
              disabled={busy}
              onClick={() => void signInWithProvider(provider)}
            >
              <Mark />
              Continue with {label}
            </Button>
          );
        })}
        {socialError && <InlineAlert tone="error">{socialError}</InlineAlert>}
      </div>
      <div className={`grid gap-6 ${reveal}`} style={step(3)}>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span aria-hidden="true" className="h-px flex-1 bg-border" />
          or
          <span aria-hidden="true" className="h-px flex-1 bg-border" />
        </div>
        <form
          className="grid gap-4"
          noValidate
          onFocus={() => setChallenge(true)}
          onChange={() => setChallenge(true)}
          onPointerDown={() => setChallenge(true)}
          onSubmit={(event) => {
            event.preventDefault();
            if (busy) return;
            void (sent ? verifyCode(otp) : sendCode());
          }}
        >
          <Field invalid={!!emailError} validationMode="onSubmit">
            <FieldLabel>Email</FieldLabel>
            <InputGroup className="h-10 has-disabled:opacity-100">
              <InputGroupInput
                ref={emailInput}
                className="h-full"
                type="email"
                autoComplete="email"
                placeholder="you@example.com"
                value={email}
                disabled={sent}
                readOnly={busy}
                onChange={(e) => {
                  setEmail(e.target.value);
                  if (emailError && EMAIL_PATTERN.test(e.target.value.trim()))
                    setEmailError("");
                }}
              />
              {sent && (
                <InputGroupAddon align="inline-end">
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    disabled={busy}
                    onClick={() => {
                      setSent(false);
                      setOtp("");
                      setCodeError("");
                      setSendError("");
                      requestAnimationFrame(() => emailInput.current?.focus());
                    }}
                  >
                    Change
                  </Button>
                </InputGroupAddon>
              )}
            </InputGroup>
            <FieldError>{emailError}</FieldError>
          </Field>
          {sent && (
            <Field invalid={!!codeError} validationMode="onSubmit">
              <FieldLabel>Six-digit code</FieldLabel>
              <Input
                ref={codeInput}
                className="h-12 text-center font-mono text-lg tabular-nums tracking-[0.5em]"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                maxLength={6}
                value={otp}
                readOnly={busy}
                onChange={(e) => {
                  const code = e.target.value.replace(/\D/g, "");
                  setOtp(code);
                  setCodeError("");
                  if (code.length === 6 && !busy) void verifyCode(code);
                }}
              />
              <FieldError>{codeError}</FieldError>
            </Field>
          )}
          {!sent && <div ref={widget} className="empty:hidden" />}
          {challenge && (
            <Script
              src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
              onReady={() => setScriptReady(true)}
            />
          )}
          <Button
            className="w-full"
            size="lg"
            type="submit"
            pending={pending === "email" || pending === "code"}
            disabled={busy}
          >
            {sent ? "Sign in" : "Email me a code"}
          </Button>
          {sendError && <InlineAlert tone="error">{sendError}</InlineAlert>}
        </form>
      </div>
      <p
        className={`text-center text-xs text-muted-foreground ${reveal}`}
        style={step(3)}
      >
        By continuing, you agree to our{" "}
        <Link
          className="underline underline-offset-4 hover:text-foreground"
          href="/terms"
        >
          Terms
        </Link>{" "}
        and{" "}
        <Link
          className="underline underline-offset-4 hover:text-foreground"
          href="/privacy"
        >
          Privacy Policy
        </Link>
        .
      </p>
    </section>
  );
}
