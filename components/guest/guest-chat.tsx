"use client";
import { ArrowUp, Check, Loader2, Square } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { createGuestClient, type GuestClient } from "@/lib/guest/client";
import {
  type GuestView,
  guestErrorMessage,
  guestPromptBytes,
  unavailableGuest,
} from "@/lib/guest/contract";
import { GuestVerification } from "./turnstile";

const liveClient = createGuestClient();
type Phase =
  | "checking"
  | "ready"
  | "streaming"
  | "complete"
  | "stopped"
  | "error";
export function GuestChat({
  client = liveClient,
  fixture,
  initialView,
  initialPhase,
  initialAnswer = "",
  fixtureVerified = false,
}: {
  client?: GuestClient;
  fixture?: boolean;
  initialView?: GuestView;
  initialPhase?: Phase;
  initialAnswer?: string;
  fixtureVerified?: boolean;
}) {
  const [view, setView] = useState<GuestView>(initialView ?? unavailableGuest);
  const [phase, setPhase] = useState<Phase>(
    initialPhase ?? (initialView ? "ready" : "checking"),
  );
  const [draft, setDraft] = useState("");
  const [prompt, setPrompt] = useState("");
  const [answer, setAnswer] = useState(initialAnswer);
  const [token, setToken] = useState(
    fixture && fixtureVerified ? "local-fixture-token" : "",
  );
  const [error, setError] = useState(
    initialPhase === "error" ? guestErrorMessage("guest_failed") : "",
  );
  const [widgetEpoch, setWidgetEpoch] = useState(0);
  const pending = useRef(false);
  const request = useRef<AbortController | null>(null);
  const alive = useRef(true);
  const refresh = useCallback(async () => {
    if (pending.current) return;
    pending.current = true;
    const controller = new AbortController();
    request.current = controller;
    setPhase("checking");
    setToken("");
    try {
      const next = await client.status(controller.signal);
      if (!alive.current || controller.signal.aborted) return;
      setView(next);
      setPhase("ready");
      setError("");
      setWidgetEpoch((value) => value + 1);
    } catch {
      if (alive.current && !controller.signal.aborted) {
        setView(unavailableGuest);
        setPhase("error");
        setError(
          "Guest availability could not be checked. Try checking again.",
        );
      }
    } finally {
      if (request.current === controller) pending.current = false;
    }
  }, [client]);
  useEffect(() => {
    alive.current = true;
    if (!initialView) void refresh();
    return () => {
      alive.current = false;
      request.current?.abort();
      pending.current = false;
    };
  }, [initialView, refresh]);
  async function send() {
    if (
      pending.current ||
      view.state !== "available" ||
      phase !== "ready" ||
      !token ||
      !draft.trim() ||
      guestPromptBytes(draft) > 2000
    )
      return;
    pending.current = true;
    const controller = new AbortController();
    request.current = controller;
    const text = draft.trim();
    const botToken = token;
    setToken("");
    setPrompt(text);
    setAnswer("");
    setError("");
    setPhase("streaming");
    setDraft("");
    try {
      await client.generate(
        { requestId: crypto.randomUUID(), text, botToken },
        controller.signal,
        (value) => {
          if (alive.current && !controller.signal.aborted) setAnswer(value);
        },
      );
      if (alive.current && !controller.signal.aborted) {
        setPhase("complete");
        setView({ state: "used", remainingGenerations: 0 });
      }
    } catch (cause) {
      if (alive.current && !controller.signal.aborted) {
        setPhase("error");
        setDraft(text);
        setError(
          guestErrorMessage(
            cause instanceof Error ? cause.message : "guest_failed",
          ),
        );
        setView(unavailableGuest);
      }
    } finally {
      pending.current = false;
    }
  }
  function stop() {
    request.current?.abort();
    setToken("");
    setView({ state: "used", remainingGenerations: 0 });
    setPhase("stopped");
  }
  const active = phase === "streaming";
  const terminal =
    view.state === "used" || phase === "complete" || phase === "stopped";
  const allowed = view.state === "available" && phase === "ready";
  const status =
    phase === "checking"
      ? "Checking guest availability…"
      : active
        ? "Receiving your response…"
        : terminal
          ? "Your guest generation has been used."
          : view.state === "busy"
            ? "A guest request is already in progress."
            : view.state === "disabled"
              ? view.reason === "shared_exhausted"
                ? "The shared guest allowance is exhausted. Guest generation is paused."
                : "Guest generation is currently unavailable."
              : token
                ? "Verification complete. Your prompt is ready to send."
                : "Complete verification to send your prompt.";
  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      <a
        href="#guest-prompt"
        className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:bg-background focus:p-4"
      >
        Skip to prompt
      </a>
      {fixture && (
        <p className="border-b bg-secondary px-4 py-2 text-center text-sm">
          Local guest fixture. No authentication, bot, database or provider
          requests.
        </p>
      )}
      <header className="flex min-h-20 items-center justify-between gap-4 border-b px-5 pt-[env(safe-area-inset-top)] sm:px-8">
        <Link
          href="/"
          className="flex min-h-11 items-center text-lg font-semibold tracking-tight"
        >
          Galaxy Chat
        </Link>
        <Button asChild variant="outline">
          <Link href="/sign-in">Sign in</Link>
        </Button>
      </header>
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-5 pt-10 pb-[calc(2.5rem+env(safe-area-inset-bottom))] sm:px-8 sm:pt-14 sm:pb-[calc(3.5rem+env(safe-area-inset-bottom))]">
        <div className="space-y-3">
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            A little room to think.
          </h1>
          <p className="max-w-xl text-base leading-7 text-muted-foreground">
            Try one basic text response, then sign in if you have a beta
            invitation. This guest exchange is not saved to chat history.
          </p>
        </div>
        {(prompt || answer) && (
          <section
            aria-label="Guest exchange"
            className="space-y-6 border-y py-6"
          >
            {prompt && (
              <div>
                <h2 className="mb-2 text-sm font-medium text-muted-foreground">
                  You
                </h2>
                <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
                  {prompt}
                </p>
              </div>
            )}
            <div>
              <h2 className="mb-2 text-sm font-medium text-muted-foreground">
                Galaxy
              </h2>
              <div className="whitespace-pre-wrap break-words text-base leading-7 [overflow-wrap:anywhere]">
                {answer ||
                  (active
                    ? "Waiting for the first text…"
                    : "No response text received.")}
              </div>
            </div>
          </section>
        )}
        <div className="space-y-4">
          <output
            aria-live="polite"
            className="flex items-start gap-2 text-sm leading-6 text-muted-foreground"
          >
            {phase === "checking" || active ? (
              <Loader2
                aria-hidden
                className="mt-1 size-4 shrink-0 animate-spin"
              />
            ) : token ? (
              <Check aria-hidden className="mt-1 size-4 shrink-0" />
            ) : null}
            {status}
          </output>
          {error && (
            <p
              role="alert"
              className="rounded-md border border-destructive/40 p-3 text-sm leading-6 text-destructive"
            >
              {error}
            </p>
          )}
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void send();
            }}
            className="rounded-2xl border bg-card p-4 shadow-sm"
          >
            <label
              htmlFor="guest-prompt"
              className="mb-2 block text-sm font-medium"
            >
              Your one guest prompt
            </label>
            <textarea
              id="guest-prompt"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              disabled={!allowed}
              maxLength={2000}
              rows={4}
              placeholder="What would you like to think through?"
              aria-describedby="guest-limit"
              className="w-full resize-y rounded-md bg-transparent py-2 text-base leading-7 outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
            />
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
              <span id="guest-limit" className="text-xs text-muted-foreground">
                {guestPromptBytes(draft).toLocaleString()} / 2,000 bytes · One
                generation
              </span>
              {active ? (
                <Button type="button" variant="outline" onClick={stop}>
                  <Square aria-hidden className="size-4" />
                  Stop response
                </Button>
              ) : (
                <Button
                  type="submit"
                  disabled={
                    !allowed ||
                    !token ||
                    !draft.trim() ||
                    guestPromptBytes(draft) > 2000
                  }
                >
                  <ArrowUp aria-hidden className="size-4" />
                  Send prompt
                </Button>
              )}
            </div>
          </form>
          {allowed &&
            (fixture ? (
              <Button
                variant="outline"
                onClick={() => setToken(token ? "" : "local-fixture-token")}
              >
                {token
                  ? "Expire fixture verification"
                  : "Complete fixture verification"}
              </Button>
            ) : view.siteKey ? (
              <GuestVerification
                key={widgetEpoch}
                siteKey={view.siteKey}
                onToken={setToken}
              />
            ) : null)}
          {!active && !terminal && (
            <Button
              type="button"
              variant="ghost"
              disabled={phase === "checking"}
              onClick={() => void refresh()}
            >
              Check availability
            </Button>
          )}
          {terminal && (
            <div className="space-y-3 rounded-xl bg-secondary p-5">
              <p className="text-sm leading-6">
                {phase === "stopped"
                  ? "Response stopped. This generation may still count toward the guest limit."
                  : "Continue with an invited account for saved conversations."}{" "}
                Signing in does not save or transfer this guest exchange.
              </p>
              <Button asChild>
                <Link href="/sign-in">Sign in to continue</Link>
              </Button>
            </div>
          )}
        </div>
        <p className="mt-auto max-w-xl text-sm leading-6 text-muted-foreground">
          Text only. No files, tools or memory. Your prompt is sent to the
          configured model provider when generation is available. Avoid
          sensitive information.{" "}
          <Link href="/privacy" className="underline underline-offset-4">
            Privacy
          </Link>{" "}
          ·{" "}
          <Link href="/help" className="underline underline-offset-4">
            Help and limits
          </Link>
        </p>
      </main>
    </div>
  );
}
