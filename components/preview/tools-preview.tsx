"use client";
import { useMemo, useState } from "react";
import { ActionApproval } from "@/components/tools/action-approval";
import { ToolsWorkbench, ToolTrace } from "@/components/tools/tools-workbench";
import { Button } from "@/components/ui/button";
import type { ToolClient } from "@/lib/tools/client";
import type { ToolRunView } from "@/lib/tools/contract";

const sample: ToolRunView = {
  id: "fixture",
  state: "completed",
  answer: "144 divided by 12 is 12.",
  events: [
    { id: "q", name: "arithmetic", state: "queued" },
    { id: "r", name: "readRevision", state: "running" },
    {
      id: "c",
      name: "arithmetic",
      state: "completed",
      output: JSON.stringify({ untrusted: true, content: "12" }),
    },
    { id: "d", name: "readRevision", state: "denied" },
    { id: "f", name: "arithmetic", state: "failed" },
  ],
};
const searchSource: ToolRunView = {
  ...sample,
  answer: "A bounded fixture answer with source [[S1]].",
  events: [
    {
      id: "search",
      name: "webSearch",
      state: "completed",
      output: "Fixture evidence is untrusted.",
    },
  ],
  search: {
    status: "results",
    retrievedAt: "2026-10-18T00:00:00.000Z",
    sources: [
      {
        id: "S1",
        title: "A deliberately long local source title that wraps on a phone",
        url: "https://example.com/bounded-search-source",
        hostname: "example.com",
        snippet:
          "A local untrusted snippet with <script> text that React renders inertly and enough content to exercise narrow wrapping.",
      },
    ],
  },
};
export function ToolsPreview() {
  const [mode, setMode] = useState("run");
  const [approval, setApproval] = useState<
    "pending" | "approved" | "denied" | "revoked"
  >("pending");
  const client = useMemo<ToolClient>(
    () => ({
      catalog: async () => ({
        models:
          mode === "off"
            ? []
            : [
                {
                  id: "fixture",
                  name: "Local tool fixture",
                  funding: "openrouter",
                  estimateMicrodollars: 1200,
                },
              ],
        credentials: [{ provider: "openrouter", testState: "valid" }],
        searchProviders: [
          {
            provider: "tavily",
            name: "Tavily Search",
            priceRevision: "fixture-price",
            estimateMicrodollars: 8000,
          },
        ],
        searchCredentials: [
          {
            provider: "tavily",
            maskedKey: "••••1234",
            revision: crypto.randomUUID(),
          },
        ],
        revisions: [
          {
            artifactId: "selected-fixture",
            version: 2,
            title:
              "Release notes and a long saved revision title to exercise wrapping on small screens",
          },
        ],
      }),
      run: async (request, signal) => {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(resolve, 900);
          signal.addEventListener(
            "abort",
            () => {
              clearTimeout(timer);
              reject(new Error("fixture_cancelled"));
            },
            { once: true },
          );
        });
        return { ...sample, id: request.id };
      },
      view: async (id) => ({ ...sample, id, state: "running", answer: "" }),
      remove: async () => {},
    }),
    [mode],
  );
  return (
    <div className="min-h-dvh bg-background">
      <div className="mx-auto max-w-3xl px-4 pt-4">
        <p className="text-xs leading-relaxed text-muted-foreground">
          Local F13-B fixture. Uses the production components. No authentication
          or provider requests.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {[
            "run",
            "off",
            "states",
            "search",
            "noresults",
            "searcherror",
            "approval",
          ].map((m) => (
            <Button
              key={m}
              variant={mode === m ? "secondary" : "outline"}
              onClick={() => setMode(m)}
            >
              {m === "run"
                ? "Run fixture"
                : m === "off"
                  ? "Tools off"
                  : m === "states"
                    ? "All tool states"
                    : m === "search"
                      ? "Search sources"
                      : m === "noresults"
                        ? "Search no results"
                        : m === "searcherror"
                          ? "Search error"
                          : "Inert approval"}
            </Button>
          ))}
        </div>
      </div>
      {mode === "approval" ? (
        <div className="mx-auto max-w-3xl space-y-4 p-4">
          <p className="text-sm">
            Inert fixture only. This action cannot write to any service.
          </p>
          <ActionApproval
            target="Fixture document, revision 2"
            argumentsText={JSON.stringify(
              { title: "Release notes", revision: 2 },
              null,
              2,
            )}
            cost="$0.00"
            state={approval}
            onDecision={async (decision) => {
              await new Promise((resolve) => setTimeout(resolve, 600));
              setApproval(
                decision === "approve"
                  ? "approved"
                  : decision === "deny"
                    ? "denied"
                    : "revoked",
              );
            }}
          />
          <Button variant="outline" onClick={() => setApproval("pending")}>
            Reset fixture
          </Button>
        </div>
      ) : ["states", "search", "noresults", "searcherror"].includes(mode) ? (
        <div className="mx-auto max-w-3xl p-4">
          <ToolTrace
            run={
              mode === "search"
                ? searchSource
                : mode === "noresults"
                  ? {
                      ...searchSource,
                      answer: "No current search evidence was returned.",
                      search: { status: "no_results", sources: [] },
                    }
                  : mode === "searcherror"
                    ? {
                        ...searchSource,
                        answer: "Search evidence was unavailable.",
                        events: [
                          {
                            id: "search",
                            name: "webSearch",
                            state: "failed",
                          },
                        ],
                        search: { status: "provider_error", sources: [] },
                      }
                    : sample
            }
          />
        </div>
      ) : (
        <ToolsWorkbench key={mode} client={client} />
      )}
    </div>
  );
}
