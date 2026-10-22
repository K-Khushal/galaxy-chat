"use client";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { SearchCredentialState } from "@/lib/search/contract";

async function call(method: string, body?: object) {
  const response = await fetch("/api/search-credentials", {
    method,
    cache: "no-store",
    ...(body
      ? {
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }
      : {}),
  });
  if (!response.ok) throw new Error("search_credentials_failed");
  return (await response.json()) as SearchCredentialState;
}
export function SearchProviderSettings() {
  const [view, setView] = useState<SearchCredentialState | null>(null);
  const [key, setKey] = useState("");
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  useEffect(() => {
    let live = true;
    call("GET")
      .then((next) => live && setView(next))
      .catch(() => live && setFailure("Search keys could not be loaded."));
    return () => {
      live = false;
    };
  }, []);
  const saved = view?.credentials[0];
  async function run(action: () => Promise<SearchCredentialState>) {
    if (pending) return;
    setPending(true);
    setFailure("");
    try {
      setView(await action());
      setKey("");
      setConfirmDelete(false);
      window.dispatchEvent(new Event("search-credentials-changed"));
    } catch {
      setFailure("The Tavily key action failed. Reload keys and try again.");
    } finally {
      setPending(false);
    }
  }
  return (
    <section
      aria-labelledby="search-key-heading"
      className="mt-6 space-y-3 rounded-xl border p-4"
    >
      <div>
        <h3 id="search-key-heading" className="text-sm font-medium">
          Tavily search key
        </h3>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          This separately encrypted key pays only for optional Tavily searches.
          Model keys and platform credits never fund search. Search stays off
          until a reviewed price and service caps are configured.
        </p>
        {saved && (
          <p className="mt-2 text-sm text-muted-foreground">
            {saved.maskedKey}
          </p>
        )}
      </div>
      <form
        className="space-y-2"
        onSubmit={(event) => {
          event.preventDefault();
          void run(() =>
            call("PUT", {
              provider: "tavily",
              key,
              revision: saved?.revision ?? null,
            }),
          );
        }}
      >
        <label htmlFor="tavily-search-key" className="text-sm">
          {saved ? "Replacement Tavily key" : "Tavily API key"}
        </label>
        <Input
          id="tavily-search-key"
          type="password"
          autoComplete="new-password"
          minLength={32}
          maxLength={512}
          required
          value={key}
          disabled={pending}
          onChange={(event) => setKey(event.target.value)}
        />
        <div className="flex flex-wrap gap-2">
          <Button
            type="submit"
            variant="outline"
            disabled={pending || key.length < 32}
          >
            {saved ? "Replace search key" : "Save search key"}
          </Button>
          {saved && (
            <Button
              type="button"
              variant="ghost"
              disabled={pending}
              onClick={() => setConfirmDelete(true)}
            >
              Delete search key
            </Button>
          )}
        </div>
      </form>
      {saved && confirmDelete && (
        <div className="space-y-2 rounded-md border border-destructive/40 p-3">
          <p className="text-sm">
            Delete this Tavily key? Future searches will require a new key.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => setConfirmDelete(false)}
            >
              Keep search key
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={pending}
              onClick={() =>
                void run(() =>
                  call("DELETE", {
                    provider: "tavily",
                    revision: saved.revision,
                  }),
                )
              }
            >
              Delete saved search key
            </Button>
          </div>
        </div>
      )}
      {view && !view.configured && (
        <p className="text-xs text-muted-foreground">
          Search execution is currently off. Saving a key does not run or test a
          search.
        </p>
      )}
      {failure && (
        <p role="alert" className="text-sm text-destructive">
          {failure}
        </p>
      )}
    </section>
  );
}
