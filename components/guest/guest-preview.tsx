"use client";
import { useState } from "react";
import type { GuestClient } from "@/lib/guest/client";
import type { GuestView } from "@/lib/guest/contract";
import { GuestChat } from "./guest-chat";

const available: GuestView = {
  state: "available",
  remainingGenerations: 1,
  siteKey: "local-fixture",
};
export const guestScenarios = [
  "available",
  "used",
  "disabled",
  "busy",
  "exhausted",
  "botpending",
  "error",
  "streaming",
] as const;
export function GuestPreview({
  scenario = "available",
}: {
  scenario?: string;
}) {
  const [state, setState] = useState(scenario);
  const view: GuestView =
    state === "exhausted"
      ? {
          state: "disabled",
          remainingGenerations: 0,
          reason: "shared_exhausted",
        }
      : state === "used"
        ? { state: "used", remainingGenerations: 0 }
        : state === "disabled" || state === "error"
          ? { state: "disabled", remainingGenerations: 0 }
          : state === "busy"
            ? { state: "busy", remainingGenerations: 0 }
            : available;
  const client: GuestClient = {
    status: async () => view,
    generate: async (_input, signal, onText) => {
      for (const text of [
        "A useful starting point:",
        "A useful starting point: name the decision.",
        "A useful starting point: name the decision. Then list what you know and what you need to find out.",
      ]) {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(resolve, 250);
          signal.addEventListener(
            "abort",
            () => {
              clearTimeout(timer);
              reject(new DOMException("Aborted", "AbortError"));
            },
            { once: true },
          );
        });
        onText(text);
      }
    },
  };
  return (
    <>
      <nav
        aria-label="Guest fixture states"
        className="flex flex-wrap items-center gap-3 border-b bg-card px-5 py-3"
      >
        <label htmlFor="guest-fixture">Guest state</label>
        <select
          id="guest-fixture"
          className="min-h-11 rounded-md border bg-background px-3 text-base"
          value={state}
          onChange={(event) => setState(event.target.value)}
        >
          {guestScenarios.map((value) => (
            <option key={value}>{value}</option>
          ))}
        </select>
      </nav>
      <GuestChat
        key={state}
        fixture
        fixtureVerified={state === "available"}
        client={client}
        initialView={view}
        initialPhase={
          state === "error"
            ? "error"
            : state === "streaming"
              ? "streaming"
              : "ready"
        }
        initialAnswer={
          state === "streaming"
            ? "Local streaming fixture: this response can be stopped."
            : ""
        }
      />
    </>
  );
}
