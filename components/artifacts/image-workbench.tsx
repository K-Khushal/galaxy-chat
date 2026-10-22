"use client";
import NextImage from "next/image";
import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { ArtifactDocument } from "@/lib/artifacts/contract";
import {
  type ImageCatalog,
  type ImageProvenance,
  type ImageRequest,
  type ImageStatus,
  imageError,
  imageUsd,
} from "@/lib/images/contract";
import type { ArtifactClient } from "./artifact-workbench";

async function json(response: Response) {
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.id ?? "images_unavailable");
  return data;
}
export type ImageClient = {
  catalog: () => Promise<ImageCatalog>;
  generate: (input: ImageRequest) => Promise<{ id: string; version: number }>;
  cancel: (id: string) => Promise<ImageStatus>;
  status: (id: string) => Promise<ImageStatus>;
};
export const imageClient: ImageClient = {
  catalog: async () => json(await fetch("/api/images", { cache: "no-store" })),
  generate: async (input) =>
    json(
      await fetch("/api/images", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      }),
    ),
  cancel: async (requestId) =>
    json(
      await fetch("/api/images", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "cancel", requestId }),
      }),
    ),
  status: async (id) =>
    json(
      await fetch(`/api/images?requestId=${encodeURIComponent(id)}`, {
        cache: "no-store",
      }),
    ),
};
export function useImageCatalog(
  enabled = true,
  api: ImageClient = imageClient,
) {
  const [catalog, setCatalog] = useState<ImageCatalog>({ available: false });
  useEffect(() => {
    let active = true;
    if (enabled)
      api
        .catalog()
        .then((value) => {
          if (active) setCatalog(value);
        })
        .catch(() => {});
    return () => {
      active = false;
    };
  }, [enabled, api]);
  return catalog;
}
const usd = (micro: number) => `$${imageUsd(micro)} USD`;
export function ImageComposer({
  catalog,
  chatId,
  messageId,
  title,
  target,
  onSaved,
  onBusyChange,
  api = imageClient,
  fixture = false,
}: {
  catalog: ImageCatalog;
  chatId: string;
  messageId: string;
  title: string;
  target?: ImageRequest["target"];
  onSaved: (id: string) => void | Promise<void>;
  onBusyChange?: (busy: boolean) => void;
  api?: ImageClient;
  fixture?: boolean;
}) {
  const model = catalog.model;
  const [prompt, setPrompt] = useState("");
  const [ceiling, setCeiling] = useState(
    model ? imageUsd(model.worstCaseEstimateMicrodollars) : "",
  );
  const [ack, setAck] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [status, setStatus] = useState(""),
    [requestId, setRequestId] = useState<string | null>(null);
  const pending = useRef(false),
    button = useRef<HTMLButtonElement>(null),
    uid = useId();
  useEffect(() => {
    onBusyChange?.(busy);
    return () => onBusyChange?.(false);
  }, [busy, onBusyChange]);
  const [dollars, fraction = ""] = ceiling.split(".");
  const amount = /^\d{1,9}(?:\.\d{1,6})?$/.test(ceiling)
    ? Number(dollars) * 1_000_000 + Number(fraction.padEnd(6, "0"))
    : 0;
  const valid =
    !!model &&
    !!catalog.credentialRevision &&
    !!catalog.reviewDigest &&
    prompt.trim().length > 0 &&
    title.trim().length > 0 &&
    ack &&
    Number.isSafeInteger(amount) &&
    amount >= model.worstCaseEstimateMicrodollars;
  async function generate() {
    if (
      !model ||
      !catalog.credentialRevision ||
      !catalog.reviewDigest ||
      !valid ||
      pending.current
    )
      return;
    pending.current = true;
    setBusy(true);
    setError("");
    setStatus(
      fixture
        ? "Running local fixture…"
        : "Generating one image with your OpenRouter key…",
    );
    const id = crypto.randomUUID();
    setRequestId(id);
    try {
      const result = await api.generate({
        action: "generate",
        requestId: id,
        chatId,
        messageId,
        title,
        prompt,
        operation: "generate",
        funding: "byok:openrouter",
        modelId: model.id,
        reviewDigest: catalog.reviewDigest,
        credentialRevision: catalog.credentialRevision,
        estimateMicrodollars: model.worstCaseEstimateMicrodollars,
        ceilingMicrodollars: amount,
        providerBudgetAcknowledged: true,
        ...(target ? { target } : {}),
      });
      setStatus(
        fixture
          ? "Local fixture complete. No provider or storage was used."
          : `Saved immutable revision ${result.version}.`,
      );
      await onSaved(result.id);
    } catch (e) {
      setError(imageError(e instanceof Error ? e.message : ""));
      setStatus(
        "Request stopped. Check request status before starting another request.",
      );
    } finally {
      pending.current = false;
      setBusy(false);
      requestAnimationFrame(() => button.current?.focus());
    }
  }
  async function inspect(cancel = false, id = requestId) {
    if (!id) return;
    try {
      const value = await (cancel ? api.cancel(id) : api.status(id));
      setStatus(
        value.state === "held"
          ? "Provider outcome held. Entered work may still incur charges; it will not retry automatically."
          : `Request ${value.state}.`,
      );
      if (value.artifactId) await onSaved(value.artifactId);
    } catch (e) {
      setError(imageError(e instanceof Error ? e.message : ""));
    }
  }
  if (!model || !catalog.available) return null;
  return (
    <div className="min-w-0 space-y-4 [overflow-wrap:anywhere]">
      <div className="space-y-2 border-y py-3 text-sm">
        <p className="font-medium">
          Generate one image · 1024 × 1024 PNG · up to 4 MiB
        </p>
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1">
          <dt>Model</dt>
          <dd>{model.model}</dd>
          <dt>Provider</dt>
          <dd>{model.provider} via OpenRouter</dd>
          <dt>Payer</dt>
          <dd>Your OpenRouter key</dd>
          <dt>Estimate</dt>
          <dd>{usd(model.worstCaseEstimateMicrodollars)}</dd>
          <dt>Review expires</dt>
          <dd>{model.expiresAt}</dd>
        </dl>
        <p className="text-muted-foreground">
          Editing and masks are unavailable: this adapter has no verified input
          or mask support.
        </p>
        <p className="text-muted-foreground">
          Galaxy supplies private storage and capacity. The estimate and app
          ceiling gate dispatch; provider charges and fees can differ. Keep
          provider spending limits enabled. No automatic retry, fallback,
          rewrite, or upscale.
        </p>
      </div>
      {fixture && (
        <p className="text-sm text-muted-foreground">
          Local demonstration only. No provider call, bill, stored image, or
          download proof.
        </p>
      )}
      {!catalog.credentialRevision && (
        <output className="text-sm">
          Save an OpenRouter key in Account &amp; settings → Keys, then reopen
          this panel.
        </output>
      )}
      <label htmlFor={`${uid}-prompt`} className="block text-sm font-medium">
        Image prompt
      </label>
      <Textarea
        id={`${uid}-prompt`}
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        maxLength={4000}
        disabled={busy}
        className="min-h-28 text-base"
        placeholder="Describe the image you want to create"
      />
      <label htmlFor={`${uid}-ceiling`} className="block text-sm font-medium">
        Application ceiling (USD)
      </label>
      <Input
        id={`${uid}-ceiling`}
        inputMode="decimal"
        value={ceiling}
        onChange={(e) => setCeiling(e.target.value)}
        disabled={busy}
        className="text-base"
        aria-describedby={`${uid}-budget`}
      />
      <p id={`${uid}-budget`} className="text-xs text-muted-foreground">
        At least {usd(model.worstCaseEstimateMicrodollars)}. This does not cap
        your provider bill or fees.
      </p>
      <label className="flex min-h-11 items-start gap-3 text-sm">
        <input
          type="checkbox"
          checked={ack}
          onChange={(e) => setAck(e.target.checked)}
          disabled={busy}
          className="mt-1 size-4 shrink-0 accent-primary"
        />
        <span>
          I understand my OpenRouter key pays and I must set provider spending
          limits.
        </span>
      </label>
      <div className="flex flex-wrap gap-2">
        <Button
          ref={button}
          type="button"
          disabled={!valid || busy}
          aria-busy={busy}
          onClick={() => void generate()}
        >
          {busy
            ? "Generating…"
            : fixture
              ? "Generate local fixture"
              : "Generate image"}
        </Button>
        {busy && (
          <Button
            type="button"
            variant="outline"
            onClick={() => void inspect(true)}
          >
            Cancel request
          </Button>
        )}
        {requestId && (
          <Button type="button" variant="ghost" onClick={() => void inspect()}>
            Check request status
          </Button>
        )}
      </div>
      {!!catalog.recent?.length && (
        <div className="space-y-2 border-t pt-3">
          <h4 className="text-sm font-medium">Recent image requests</h4>
          {catalog.recent.map((item) => (
            <div
              key={item.id}
              className="flex flex-wrap items-center gap-2 text-sm"
            >
              <span>
                {item.state}
                {item.cancelled ? " (cancelled)" : ""}
              </span>
              <Button
                variant="ghost"
                size="sm"
                type="button"
                onClick={() => void inspect(false, item.id)}
              >
                Check {item.id.slice(0, 8)}
              </Button>
            </div>
          ))}
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <output
        className="block text-sm text-muted-foreground"
        aria-live="polite"
      >
        {status}
      </output>
    </div>
  );
}
export function ImageEditor({
  document,
  api,
  onChange,
  onDeleted,
  onDirtyChange,
  fixture = false,
  imageApi = imageClient,
}: {
  document: ArtifactDocument;
  api: ArtifactClient;
  onChange: (next: ArtifactDocument) => void;
  onDeleted: () => void;
  onDirtyChange?: (dirty: boolean) => void;
  fixture?: boolean;
  imageApi?: ImageClient;
}) {
  const [selected, setSelected] = useState(document.version),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [confirm, setConfirm] = useState(false),
    [notice, setNotice] = useState("");
  const heading = useRef<HTMLHeadingElement>(null),
    uid = useId();
  const catalog = useImageCatalog(
    !fixture || imageApi !== imageClient,
    imageApi,
  );
  useEffect(() => {
    heading.current?.focus();
  }, []);
  useEffect(() => {
    onDirtyChange?.(busy);
    return () => onDirtyChange?.(false);
  }, [busy, onDirtyChange]);
  let provenance: ImageProvenance | null = null;
  try {
    const value = JSON.parse(document.content);
    if (
      value?.version === 1 &&
      typeof value.prompt === "string" &&
      typeof value.model?.model === "string" &&
      typeof value.model?.provider === "string" &&
      Number.isSafeInteger(value.model?.worstCaseEstimateMicrodollars) &&
      typeof value.object?.sha256 === "string"
    )
      provenance = value;
  } catch {}
  const source = `/api/images/object?id=${encodeURIComponent(document.id)}&version=${selected}`;
  async function mutate(remove = false) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await api.mutate(
        remove
          ? { action: "delete", id: document.id }
          : {
              action: "restore",
              id: document.id,
              expectedVersion: document.version,
              version: selected,
            },
      );
      if (result.deleted) {
        onDeleted();
        return;
      }
      const next = await api.read(result.id);
      onChange(next);
      setSelected(next.version);
      setNotice(`Restored revision ${selected} as revision ${next.version}.`);
    } catch (e) {
      setError(imageError(e instanceof Error ? e.message : ""));
    } finally {
      setBusy(false);
      heading.current?.focus();
    }
  }
  return (
    <div className="min-h-0 min-w-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-5 pb-5 [overflow-wrap:anywhere]">
      <h3 ref={heading} tabIndex={-1} className="font-medium">
        Image revision {selected}
      </h3>
      {fixture ? (
        <div className="flex aspect-square items-center justify-center rounded-lg border bg-muted p-8 text-center text-muted-foreground">
          Local image preview placeholder. No provider output or private-storage
          proof.
        </div>
      ) : (
        <NextImage
          unoptimized
          src={source}
          alt={`Generated image: ${document.title}. Revision ${selected}.`}
          width={1024}
          height={1024}
          className="aspect-square h-auto w-full rounded-lg border object-contain"
        />
      )}
      <p className="text-sm text-muted-foreground">
        Each generated image is immutable. Restore adds a metadata revision
        referencing the same owned image.
      </p>
      <label htmlFor={`${uid}-revision`} className="block text-sm font-medium">
        Saved image revision
      </label>
      <select
        id={`${uid}-revision`}
        value={selected}
        onChange={(e) => setSelected(Number(e.target.value))}
        disabled={busy}
        className="min-h-11 w-full rounded-md border bg-background p-2 text-base"
      >
        {document.revisions.map((r) => (
          <option key={r.version} value={r.version}>
            Revision {r.version}
            {r.restoredFrom ? ` (restored from ${r.restoredFrom})` : ""} —{" "}
            {r.title}
          </option>
        ))}
      </select>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          disabled={
            busy || selected === document.version || document.version >= 40
          }
          onClick={() => void mutate()}
        >
          Restore as new revision
        </Button>
        {fixture ? (
          <Button variant="outline" disabled>
            Download PNG
          </Button>
        ) : (
          <Button variant="outline" asChild>
            <a href={source} download>
              Download revision {selected} PNG
            </a>
          </Button>
        )}
        <Button
          variant="ghost"
          disabled={busy}
          onClick={() => setConfirm(!confirm)}
        >
          Delete image
        </Button>
      </div>
      {confirm && (
        <div className="space-y-2 rounded-md border p-3">
          <p className="text-sm">
            Delete this image and all revisions? Private object deletion is
            queued; unresolved writes can require reconciliation.
          </p>
          <Button
            variant="destructive"
            disabled={busy}
            onClick={() => void mutate(true)}
          >
            Delete all image revisions
          </Button>
          <Button variant="ghost" onClick={() => setConfirm(false)}>
            Keep image
          </Button>
        </div>
      )}
      {provenance && (
        <details className="text-sm">
          <summary className="min-h-11 cursor-pointer py-3 font-medium">
            Generation provenance for current revision {document.version}
          </summary>
          <dl className="space-y-2">
            <dt>Prompt</dt>
            <dd>{provenance.prompt}</dd>
            <dt>Exact model and provider</dt>
            <dd>
              {provenance.model.model} · {provenance.model.provider}
            </dd>
            <dt>Reviewed estimate</dt>
            <dd>{usd(provenance.model.worstCaseEstimateMicrodollars)}</dd>
            <dt>Canonical image digest</dt>
            <dd>{provenance.object.sha256}</dd>
          </dl>
        </details>
      )}
      {catalog.available && (
        <details>
          <summary className="min-h-11 cursor-pointer py-3 text-sm font-medium">
            Generate a new revision
          </summary>
          <ImageComposer
            catalog={catalog}
            api={imageApi}
            fixture={fixture}
            chatId={document.chatId}
            messageId={document.messageId}
            title={document.title}
            target={{ id: document.id, expectedVersion: document.version }}
            onBusyChange={setBusy}
            onSaved={async (id) => {
              const next = await api.read(id);
              onChange(next);
              setSelected(next.version);
            }}
          />
        </details>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <output
        className="block text-sm text-muted-foreground"
        aria-live="polite"
      >
        {notice}
      </output>
    </div>
  );
}
