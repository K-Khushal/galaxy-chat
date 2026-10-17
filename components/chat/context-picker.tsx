"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { type ContextClient, contextClient } from "@/lib/context/client";
import type {
  ContextLibrary,
  ContextSelection,
  ContextView,
} from "@/lib/context/contract";
export function ContextPicker({
  projectId,
  locked,
  disabled,
  onChange,
  client = contextClient,
}: {
  client?: ContextClient;
  projectId: string | null;
  locked: boolean;
  disabled: boolean;
  onChange: (selection: ContextSelection | undefined, ready: boolean) => void;
}) {
  const [library, setLibrary] = useState<ContextLibrary>();
  const [selectedProject, setProject] = useState(projectId);
  const [ids, setIds] = useState<string[]>([]);
  const [view, setView] = useState<ContextView>();
  const [error, setError] = useState("");
  useEffect(() => {
    const abort = new AbortController();
    onChange(undefined, false);
    setView(undefined);
    setError("");
    Promise.all([
      client.library(abort.signal),
      client.preview(
        { projectId: selectedProject, memoryIds: ids },
        abort.signal,
      ),
    ])
      .then(([nextLibrary, next]) => {
        if (!abort.signal.aborted) {
          setLibrary(nextLibrary);
          setView(next);
          onChange(
            { projectId: selectedProject, memoryIds: ids, digest: next.digest },
            true,
          );
        }
      })
      .catch(() => {
        if (!abort.signal.aborted)
          setError(
            "Context changed, could not load, or is too large. Review your selection and refresh before sending.",
          );
      });
    return () => abort.abort();
  }, [selectedProject, ids, onChange, client]);
  function invalidate() {
    onChange(undefined, false);
    setView(undefined);
  }
  return (
    <details className="mb-2 rounded-xl border border-border bg-card px-3 py-2 text-sm">
      <summary className="min-h-11 cursor-pointer py-1 font-medium">
        Request context ·{" "}
        {view
          ? `${view.memories.length} memories${view.project ? ` · ${view.project.name}` : ""}`
          : "Review required"}
      </summary>
      <div className="max-h-[35dvh] space-y-3 overflow-y-auto overscroll-contain pt-3">
        <p className="text-xs leading-relaxed text-muted-foreground">
          Only memories you check are sent. No automatic collection. Project
          instructions are included for this project.
        </p>
        <label className="block space-y-1">
          <span>Project</span>
          <select
            className="min-h-11 w-full rounded-md border border-input bg-background px-2 text-base"
            disabled={locked || disabled}
            value={selectedProject ?? ""}
            onChange={(event) => {
              invalidate();
              setProject(event.target.value || null);
              setIds([]);
            }}
          >
            <option value="">No project</option>
            {library?.projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        {locked && (
          <p className="text-xs text-muted-foreground">
            This conversation stays in its project. Start a new conversation to
            choose another.
          </p>
        )}
        {library?.memories
          .filter((m) => !m.projectId || m.projectId === selectedProject)
          .map((m) => (
            <label
              key={m.id}
              className="flex min-h-11 items-start gap-3 rounded-md border border-border p-3"
            >
              <input
                type="checkbox"
                className="mt-1 size-4 shrink-0"
                checked={ids.includes(m.id)}
                disabled={disabled || (!ids.includes(m.id) && ids.length >= 8)}
                onChange={(event) => {
                  invalidate();
                  setIds((current) =>
                    event.target.checked
                      ? [...current, m.id]
                      : current.filter((id) => id !== m.id),
                  );
                }}
              />
              <span className="whitespace-pre-wrap break-words">
                {m.content}
              </span>
            </label>
          ))}
        {view?.project && (
          <div>
            <p className="font-medium">Exact project instructions</p>
            <p className="whitespace-pre-wrap break-words text-muted-foreground">
              {view.project.instructions || "No extra instructions."}
            </p>
          </div>
        )}
        {view && <RequestContextSummary view={view} />}
        {error && (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={disabled}
            onClick={() => {
              invalidate();
              setIds((current) => [...current]);
            }}
          >
            Refresh selection
          </Button>
          <Button
            type="button"
            variant="ghost"
            disabled={disabled}
            onClick={() => {
              invalidate();
              setIds([]);
            }}
          >
            Clear selected memories
          </Button>
          <Link
            className="inline-flex min-h-11 items-center rounded-md px-2 underline focus-visible:outline-2 focus-visible:outline-ring"
            href="/chat/context"
          >
            Manage memory & projects
          </Link>
        </div>
      </div>
    </details>
  );
}

export function RequestContextSummary({ view }: { view: ContextView }) {
  return (
    <div aria-live="polite">
      <p className="font-medium">Exact selected memories</p>
      {view.memories.length ? (
        <ul className="list-inside list-disc space-y-2">
          {view.memories.map((m) => (
            <li className="whitespace-pre-wrap break-words" key={m.id}>
              {m.content}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground">
          None. No saved memory enters this request.
        </p>
      )}
      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
        Instructions use {view.instructionBytes.toLocaleString()} / 4,500 bytes.
        Total context: at most 12,000 encoded bytes and 12 recent messages;
        oldest messages may be dropped. Conservative input ceiling 16,384
        tokens; output ceiling 512 tokens.
      </p>
    </div>
  );
}
