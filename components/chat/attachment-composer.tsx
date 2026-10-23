"use client";
import { type SetStateAction, useCallback, useEffect, useState } from "react";
import {
  AttachmentPicker,
  attachmentErrorMessage,
} from "@/components/chat/attachment-picker";
import { Button } from "@/components/ui/button";
import {
  type AttachmentClient,
  attachmentClient,
} from "@/lib/attachments/client";
import type {
  AttachmentContextView,
  AttachmentSelection,
} from "@/lib/attachments/contract";
import type { FundingChoice } from "@/lib/byok/contract";
import type { ContextSelection } from "@/lib/context/contract";
export function AttachmentContextPreview({
  view,
}: {
  view: AttachmentContextView;
}) {
  return (
    <details className="rounded-lg border border-border p-3 text-xs">
      <summary className="min-h-11 cursor-pointer py-2 font-medium">
        Exact file context · {view.provenance.length} sources · up to{" "}
        {view.estimatedTokens.toLocaleString()} added input tokens
      </summary>
      <div className="max-h-[25dvh] space-y-3 overflow-y-auto overscroll-contain">
        <p>
          Checked files are sent as untrusted source data. Images require a
          reviewed model. PDF page labels identify excerpts. No automatic OCR.
        </p>
        {view.provenance.map((source) => (
          <div key={source.id}>
            <p className="font-medium break-words [overflow-wrap:anywhere]">
              {source.name} · source {source.id}
              {source.pages ? ` · ${source.pages} pages` : ""}
            </p>
            <pre className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
              {view.excerpts.find((item) => item.id === source.id)?.text ||
                (source.kind === "image"
                  ? "Original private image bytes will be sent to the selected model."
                  : "No text.")}
            </pre>
          </div>
        ))}
      </div>
    </details>
  );
}
export function AttachmentComposer({
  chatId,
  saved,
  temporary,
  busy,
  context,
  contextReady,
  model,
  funding,
  imagesSupported,
  onChange,
  client = attachmentClient,
}: {
  chatId: string;
  saved: boolean;
  temporary: boolean;
  busy: boolean;
  context?: ContextSelection;
  contextReady: boolean;
  model: string;
  funding: FundingChoice;
  imagesSupported: boolean;
  client?: AttachmentClient;
  onChange: (
    selection: AttachmentSelection | undefined,
    ready: boolean,
  ) => void;
}) {
  const [ids, setIds] = useState<string[]>([]);
  const [view, setView] = useState<AttachmentContextView>();
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);
  const select = useCallback(
    (next: SetStateAction<string[]>) => {
      onChange(undefined, false);
      setView(undefined);
      setIds(next);
    },
    [onChange],
  );
  const uploadState = useCallback(
    (next: boolean) => {
      if (next) onChange(undefined, false);
      setUploading(next);
    },
    [onChange],
  );
  useEffect(() => {
    const controller = new AbortController();
    setView(undefined);
    setError("");
    if (uploading) {
      onChange(undefined, false);
      return;
    }
    if (!ids.length) {
      onChange(undefined, true);
      return;
    }
    onChange(undefined, false);
    if (temporary || !saved || !contextReady || !model) return;
    client
      .preview({ chatId, ids, model, funding, context }, controller.signal)
      .then((next) => {
        if (!controller.signal.aborted) {
          setView(next);
          onChange({ ids, digest: next.digest }, true);
        }
      })
      .catch((cause) => {
        if (!controller.signal.aborted)
          setError(
            attachmentErrorMessage(cause instanceof Error ? cause.message : ""),
          );
      });
    return () => controller.abort();
  }, [
    chatId,
    saved,
    temporary,
    ids,
    context,
    contextReady,
    model,
    funding,
    onChange,
    uploading,
    client,
  ]);
  return (
    <div className="mb-2 space-y-2">
      <AttachmentPicker
        chatId={chatId}
        saved={saved}
        temporary={temporary}
        busy={busy}
        selected={ids}
        onSelection={select}
        imagesSupported={imagesSupported}
        onBusyChange={uploadState}
        client={client}
      />
      {view ? <AttachmentContextPreview view={view} /> : null}
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
      {ids.length ? (
        <div className="flex flex-wrap gap-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={busy || uploading}
            onClick={() => select([])}
          >
            Clear selected files
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={busy || uploading}
            onClick={() => {
              onChange(undefined, false);
              setIds((current) => [...current]);
            }}
          >
            Refresh file context
          </Button>
        </div>
      ) : null}
    </div>
  );
}
