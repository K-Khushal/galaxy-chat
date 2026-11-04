"use client";
import { useCallback, useEffect, useRef, useState } from "react";

type CreditsResponse = { credits: number; key: unknown };

/** Tells every useCredits to fetch again, e.g. once a Generation settles. */
export function creditsChanged() {
  window.dispatchEvent(new Event("galaxy-account-changed"));
}

/**
 * What the next Message can be paid with: remaining Credits and whether a BYOK
 * key is saved. Both are null until the first answer arrives. Refreshes when
 * the window regains focus and on `galaxy-account-changed`.
 */
export function useCredits(): {
  credits: number | null;
  hasKey: boolean | null;
  refresh: () => void;
} {
  const [data, setData] = useState<CreditsResponse>();
  // Only the latest request may write, and none after unmount.
  const latest = useRef(0);
  const refresh = useCallback(() => {
    const request = ++latest.current;
    void (async () => {
      try {
        const response = await fetch("/api/credits");
        if (!response.ok) return;
        const value = (await response.json()) as CreditsResponse;
        if (request === latest.current) setData(value);
      } catch {}
    })();
  }, []);
  useEffect(() => {
    refresh();
    window.addEventListener("focus", refresh);
    window.addEventListener("galaxy-account-changed", refresh);
    return () => {
      latest.current++;
      window.removeEventListener("focus", refresh);
      window.removeEventListener("galaxy-account-changed", refresh);
    };
  }, [refresh]);
  return {
    credits: data ? data.credits : null,
    hasKey: data ? !!data.key : null,
    refresh,
  };
}
