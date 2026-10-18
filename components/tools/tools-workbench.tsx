"use client";
import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  type ToolCatalog,
  type ToolClient,
  toolClient,
} from "@/lib/tools/client";
import {
  microdollarsFromUSD,
  TOOL_DISCLOSURE,
  type ToolRunView,
} from "@/lib/tools/contract";

const dollars = (micro: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  }).format(micro / 1_000_000);
export function ToolTrace({ run }: { run: ToolRunView }) {
  return (
    <section aria-label="Tool activity" className="min-w-0 space-y-3">
      <output className="text-sm text-muted-foreground">Run {run.state}</output>
      <ol className="divide-y divide-border">
        {run.events.map((event) => (
          <li key={event.id} className="min-w-0 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium">
                {event.name === "readRevision"
                  ? "Read selected revision"
                  : "Arithmetic"}
              </span>
              <span className="text-sm text-muted-foreground">
                {event.state}
              </span>
            </div>
            {event.output && (
              <details className="mt-2">
                <summary className="min-h-11 cursor-pointer py-2 text-sm">
                  View untrusted result
                </summary>
                <pre className="max-h-60 overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted p-3 text-xs">
                  {event.output}
                </pre>
              </details>
            )}
          </li>
        ))}
      </ol>
      {run.answer && (
        <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">
          {run.answer}
        </p>
      )}
    </section>
  );
}
export function ToolsWorkbench({
  client = toolClient,
}: {
  client?: ToolClient;
}) {
  const [catalog, setCatalog] = useState<ToolCatalog | null>(null);
  const [modelId, setModelId] = useState("");
  const [prompt, setPrompt] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [ceiling, setCeiling] = useState("");
  const [ack, setAck] = useState(false);
  const [pending, setPending] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [run, setRun] = useState<ToolRunView | null>(null);
  const [error, setError] = useState("");
  const busy = useRef(false);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => {
    let live = true;
    client
      .catalog()
      .then((value) => {
        if (live) setCatalog(value);
      })
      .catch(() => {
        if (live)
          setError("Tools could not be loaded. Try opening this page again.");
      });
    return () => {
      live = false;
      abort.current?.abort();
    };
  }, [client]);
  const model = catalog?.models.find((m) => m.id === modelId);
  const keyReady =
    model &&
    catalog?.credentials.some(
      (c) => c.provider === model.funding && c.testState !== "invalid",
    );
  const cost = microdollarsFromUSD(ceiling) ?? 0;
  const ready =
    !!model &&
    !!keyReady &&
    ack &&
    prompt.trim().length > 0 &&
    Number.isSafeInteger(cost) &&
    cost >= model.estimateMicrodollars;
  async function submit() {
    if (busy.current || !ready || !model) return;
    busy.current = true;
    setPending(true);
    setError("");
    const controller = new AbortController();
    abort.current = controller;
    const id = crypto.randomUUID();
    setRun({ id, state: "queued", answer: "", events: [] });
    let polling = false;
    let active = true;
    const timer = setInterval(() => {
      if (polling) return;
      polling = true;
      client
        .view(id)
        .then((value) => {
          if (active) setRun(value);
        })
        .catch(() => {})
        .finally(() => {
          polling = false;
        });
    }, 750);
    try {
      const result = await client.run(
        {
          id,
          prompt,
          model: model.id,
          funding: model.funding,
          estimateMicrodollars: model.estimateMicrodollars,
          ceilingMicrodollars: cost,
          providerBudgetAcknowledged: true,
          revisions: (catalog?.revisions ?? [])
            .filter((r) => selected.includes(`${r.artifactId}:${r.version}`))
            .map(({ artifactId, version }) => ({ artifactId, version })),
        },
        controller.signal,
      );
      setRun(result);
    } catch {
      setError(
        controller.signal.aborted
          ? "Stopped waiting. Your provider may still be processing; its spending limit remains important."
          : "The run failed or was denied. Check your key and tool configuration before trying a new run.",
      );
      try {
        setRun(await client.view(id));
      } catch {
        setRun({ id, state: "failed", answer: "", events: [] });
      }
    } finally {
      active = false;
      clearInterval(timer);
      busy.current = false;
      setPending(false);
      abort.current = null;
    }
  }
  return (
    <main className="mx-auto w-full min-w-0 max-w-3xl space-y-6 px-4 py-6 sm:px-6">
      <div>
        <Link
          href="/chat"
          className="inline-flex min-h-11 items-center text-sm underline underline-offset-4"
        >
          Conversations
        </Link>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight">Tools</h1>
        <p className="mt-2 max-w-prose text-sm leading-relaxed text-muted-foreground">
          Work with arithmetic and a saved revision you choose. Each run allows
          up to three model steps and four tool calls within 20 seconds.
        </p>
      </div>
      {!catalog ? (
        <output>Loading tools…</output>
      ) : catalog.models.length === 0 ? (
        <output className="block rounded-lg border border-border p-4 text-sm">
          Tools are off. A reviewed model and provider spending controls must be
          configured before a run is available.
        </output>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
          className="space-y-5"
        >
          <div className="space-y-2">
            <label htmlFor="tool-model" className="text-sm font-medium">
              Model and funding
            </label>
            <select
              id="tool-model"
              className="min-h-11 w-full rounded-md border border-input bg-background px-3 text-base"
              disabled={pending}
              value={modelId}
              onChange={(event) => {
                const next = catalog.models.find(
                  (m) => m.id === event.target.value,
                );
                setModelId(event.target.value);
                setCeiling(
                  next ? String(next.estimateMicrodollars / 1_000_000) : "",
                );
                setAck(false);
              }}
            >
              <option value="">Choose your provider model</option>
              {catalog.models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} — your {m.funding} key
                </option>
              ))}
            </select>
            {model && !keyReady && (
              <p className="text-sm text-destructive">
                Add your provider key in account settings before running.
              </p>
            )}
          </div>
          <fieldset disabled={pending} className="space-y-2">
            <legend className="text-sm font-medium">
              Saved revisions (optional, choose up to four)
            </legend>
            <p className="text-sm text-muted-foreground">
              Only checked revisions can be read by the model. Newer revisions
              are not included automatically.
            </p>
            {catalog.revisions.length === 0 ? (
              <p className="text-sm">No saved revisions are available.</p>
            ) : (
              <div className="max-h-52 overflow-auto rounded-md border border-border">
                {catalog.revisions.map((r) => {
                  const key = `${r.artifactId}:${r.version}`;
                  return (
                    <label
                      key={key}
                      className="flex min-h-11 items-center gap-3 px-3 py-2 text-sm"
                    >
                      <input
                        type="checkbox"
                        checked={selected.includes(key)}
                        disabled={
                          !selected.includes(key) && selected.length >= 4
                        }
                        onChange={(e) =>
                          setSelected((prev) =>
                            e.target.checked
                              ? [...prev, key]
                              : prev.filter((x) => x !== key),
                          )
                        }
                      />
                      <span className="min-w-0 break-words">
                        {r.title} · revision {r.version}
                      </span>
                    </label>
                  );
                })}
              </div>
            )}
          </fieldset>
          <div className="space-y-2">
            <label htmlFor="tool-prompt" className="text-sm font-medium">
              Request
            </label>
            <Textarea
              id="tool-prompt"
              value={prompt}
              disabled={pending}
              maxLength={8000}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Calculate 144 divided by 12, or ask about a selected revision."
              className="min-h-28 text-base"
            />
          </div>
          <div className="space-y-3 rounded-lg border border-border p-4">
            <p className="text-sm leading-relaxed">{TOOL_DISCLOSURE}</p>
            {model && (
              <p className="text-sm">
                Maximum estimated model usage:{" "}
                {dollars(model.estimateMicrodollars)}.
              </p>
            )}
            <label htmlFor="tool-ceiling" className="block text-sm font-medium">
              Run ceiling (USD)
            </label>
            <Input
              id="tool-ceiling"
              type="number"
              inputMode="decimal"
              min={0}
              step="0.000001"
              value={ceiling}
              disabled={pending || !model}
              onChange={(e) => {
                setCeiling(e.target.value);
                setAck(false);
              }}
              className="text-base"
            />
            <label className="flex min-h-11 items-start gap-3 py-2 text-sm leading-relaxed">
              <input
                type="checkbox"
                className="mt-1"
                checked={ack}
                disabled={pending || !model}
                onChange={(e) => setAck(e.target.checked)}
              />
              <span>
                I set a spending limit with my provider and accept this estimate
                and ceiling for this run.
              </span>
            </label>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="submit"
              disabled={!ready || pending}
              aria-busy={pending}
            >
              {pending && (
                <Loader2
                  aria-hidden="true"
                  className="size-4 animate-spin motion-reduce:animate-none"
                />
              )}
              Run tools
            </Button>
            {pending && (
              <Button
                type="button"
                variant="outline"
                onClick={() => abort.current?.abort()}
              >
                Stop waiting
              </Button>
            )}
          </div>
        </form>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {run && (
        <>
          <ToolTrace run={run} />
          {!pending && (
            <Button
              variant="outline"
              disabled={deleting}
              aria-busy={deleting}
              onClick={async () => {
                if (busy.current) return;
                busy.current = true;
                setDeleting(true);
                try {
                  await client.remove(run.id);
                  setRun(null);
                } catch {
                  setError(
                    "This run could not be deleted. Try again after this request has finished.",
                  );
                } finally {
                  busy.current = false;
                  setDeleting(false);
                }
              }}
            >
              {deleting && (
                <Loader2
                  aria-hidden="true"
                  className="size-4 animate-spin motion-reduce:animate-none"
                />
              )}
              Delete run
            </Button>
          )}
        </>
      )}
      <p className="text-xs leading-relaxed text-muted-foreground">
        Runs and selected tool results are private saved data, included in
        account export and deletion. Anonymous resource counts remain after
        deletion. External write tools are not available.
      </p>
    </main>
  );
}
