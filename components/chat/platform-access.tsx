"use client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import type { ChatModel } from "@/lib/ai/model";
import {
  type ChatAvailability,
  defaultAvailability,
} from "@/lib/ui/availability";
import {
  type PlatformCreditView,
  toCreditStatus,
} from "@/lib/ui/credit-contract";
import { type CreditStatus, defaultCreditStatus } from "@/lib/ui/credits";

type Access = {
  models: ChatModel[];
  creditStatus: CreditStatus;
  availability: ChatAvailability;
  refresh: () => void;
};
const Context = createContext<Access>({
  models: [],
  creditStatus: defaultCreditStatus,
  availability: defaultAvailability,
  refresh: () => {},
});
export const usePlatformAccess = () => useContext(Context);
export function PlatformAccessProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [view, setView] = useState<
    (PlatformCreditView & { models: ChatModel[] }) | null
  >(null);
  const sequence = useRef(0);
  const refresh = useCallback(() => {
    const current = ++sequence.current;
    void fetch("/api/credits", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("credits_failed");
        const next = await response.json();
        if (current === sequence.current) setView(next);
      })
      .catch(() => {
        if (current === sequence.current) setView(null);
      });
  }, []);
  useEffect(() => {
    refresh();
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [refresh]);
  useEffect(() => {
    if (view?.state !== "busy") return;
    const timer = window.setTimeout(refresh, 3000);
    return () => window.clearTimeout(timer);
  }, [view, refresh]);
  const creditStatus = view ? toCreditStatus(view) : defaultCreditStatus;
  const availability: ChatAvailability =
    view?.configured &&
    view.state === "available" &&
    view.models.some((m) => m.available)
      ? { state: "ready", funding: "platform" }
      : {
          state: "unavailable",
          reason:
            creditStatus.state === "paused"
              ? creditStatus.reason
              : creditStatus.state === "exhausted"
                ? `Daily allowance used. Resets at 00:00 UTC.`
                : "Platform generation is currently unavailable. Provider access and verified funding must be configured.",
        };
  return (
    <Context.Provider
      value={{
        models: view?.models ?? [],
        creditStatus,
        availability,
        refresh,
      }}
    >
      {children}
    </Context.Provider>
  );
}
