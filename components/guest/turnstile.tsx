"use client";
import Script from "next/script";
import { useCallback, useEffect, useRef, useState } from "react";

type TurnstileAPI = {
  ready: (callback: () => void) => void;
  render: (
    element: HTMLElement,
    options: {
      sitekey: string;
      action: string;
      size: string;
      callback: (token: string) => void;
      "expired-callback": () => void;
      "error-callback": () => void;
      "timeout-callback": () => void;
    },
  ) => string;
  remove: (id: string) => void;
};
declare global {
  interface Window {
    turnstile?: TurnstileAPI;
  }
}
export function GuestVerification({
  siteKey,
  onToken,
}: {
  siteKey: string;
  onToken: (token: string) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const tokenCallback = useRef(onToken);
  tokenCallback.current = onToken;
  const load = useCallback(() => setReady(true), []);
  useEffect(() => {
    if (!ready || !window.turnstile || !container.current) return;
    const api = window.turnstile;
    let active = true;
    let widget: string | undefined;
    api.ready(() => {
      if (!active || !container.current) return;
      widget = api.render(container.current, {
        sitekey: siteKey,
        action: "galaxy_guest",
        size: "flexible",
        callback: (token) => {
          if (active) tokenCallback.current(token);
        },
        "expired-callback": () => {
          if (active) tokenCallback.current("");
        },
        "error-callback": () => {
          if (active) {
            tokenCallback.current("");
            setFailed(true);
          }
        },
        "timeout-callback": () => {
          if (active) {
            tokenCallback.current("");
            setFailed(true);
          }
        },
      });
    });
    return () => {
      active = false;
      if (widget !== undefined) api.remove(widget);
      tokenCallback.current("");
    };
  }, [ready, siteKey]);
  return (
    <>
      <Script
        id="guest-turnstile"
        src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
        onReady={load}
        onError={() => {
          onToken("");
          setFailed(true);
        }}
      />
      <div ref={container} className="min-h-16" />
      {failed && (
        <p role="alert" className="text-sm leading-6 text-destructive">
          Verification could not complete. Check availability to start a new
          check.
        </p>
      )}
    </>
  );
}
