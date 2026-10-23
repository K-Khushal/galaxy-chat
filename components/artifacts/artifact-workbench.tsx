"use client";
import {
  ChartNoAxesCombined,
  FileCode2,
  FileText,
  FolderOpen,
  ImageIcon,
  Loader2,
  RotateCcw,
  Save,
  Table2,
  Trash2,
} from "lucide-react";
import dynamic from "next/dynamic";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { chartSvg } from "@/lib/artifacts/chart-export";
import { parseChartSource } from "@/lib/artifacts/chart-spec";
import {
  type ArtifactDocument,
  type ArtifactKind,
  type ArtifactMutation,
  type ArtifactSummary,
  artifactError,
  artifactFilename,
  artifactKindLabel,
  artifactLimits,
} from "@/lib/artifacts/contract";
import {
  artifactPreviewDocument,
  markdownPreviewDocument,
} from "@/lib/artifacts/preview";
import { parseTableSource } from "@/lib/artifacts/table-spec";

import { ImageComposer, ImageEditor, useImageCatalog } from "./image-workbench";

const ChartPreview = dynamic(
  () => import("./chart-preview").then((module) => module.ChartPreview),
  {
    loading: () => (
      <output className="p-4 text-sm text-muted-foreground">
        Loading chart preview…
      </output>
    ),
  },
);
const TablePreview = dynamic(
  () => import("./table-preview").then((module) => module.TablePreview),
  {
    loading: () => (
      <output className="p-4 text-sm text-muted-foreground">
        Loading table preview…
      </output>
    ),
  },
);

export type ArtifactClient = {
  list: (chatId: string) => Promise<ArtifactSummary[]>;
  read: (id: string) => Promise<ArtifactDocument>;
  mutate: (input: ArtifactMutation) => Promise<{ id: string; deleted?: true }>;
};
async function json(response: globalThis.Response) {
  const body = await response.json();
  if (!response.ok) throw new Error(body.error?.id ?? "artifacts_failed");
  return body;
}
const client: ArtifactClient = {
  list: async (chatId) =>
    (
      await json(
        await fetch(`/api/artifacts?chatId=${encodeURIComponent(chatId)}`, {
          cache: "no-store",
        }),
      )
    ).artifacts,
  read: async (id) =>
    json(
      await fetch(`/api/artifacts?id=${encodeURIComponent(id)}`, {
        cache: "no-store",
      }),
    ),
  mutate: async (input) =>
    json(
      await fetch("/api/artifacts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      }),
    ),
};
export function ArtifactPreview({
  source,
  kind,
}: {
  source: string;
  kind: ArtifactKind;
}) {
  const document = useMemo(
    () =>
      kind === "chart" || kind === "table"
        ? ""
        : kind === "html"
          ? artifactPreviewDocument(source)
          : markdownPreviewDocument(source),
    [source, kind],
  );
  if (kind === "chart") return <ChartPreview source={source} />;
  if (kind === "table") return <TablePreview source={source} />;
  return (
    <iframe
      title={`${kind === "html" ? "HTML" : "Markdown"} artifact preview`}
      sandbox=""
      referrerPolicy="no-referrer"
      srcDoc={document}
      className="h-full min-h-72 w-full rounded-lg border bg-white"
    />
  );
}
type EditorProps = {
  document: ArtifactDocument;
  api?: ArtifactClient;
  onChange: (document: ArtifactDocument) => void;
  onDeleted: () => void;
  onDirtyChange?: (dirty: boolean) => void;
  fixture?: boolean;
};
export function ArtifactEditor(props: EditorProps) {
  return props.document.kind === "image" ? (
    <ImageEditor {...props} api={props.api ?? client} />
  ) : (
    <SourceArtifactEditor {...props} />
  );
}
function SourceArtifactEditor({
  document,
  api = client,
  onChange,
  onDeleted,
  fixture = false,
  onDirtyChange,
}: {
  document: ArtifactDocument;
  api?: ArtifactClient;
  onChange: (document: ArtifactDocument) => void;
  onDeleted: () => void;
  onDirtyChange?: (dirty: boolean) => void;
  fixture?: boolean;
}) {
  const [title, setTitle] = useState(document.title);
  const [content, setContent] = useState(document.content);
  const [tab, setTab] = useState<"source" | "preview" | "history">("source");
  const [selected, setSelected] = useState(
    String(document.revisions[0]?.version ?? document.version),
  );
  const [operation, setOperation] = useState<ArtifactMutation["action"] | null>(
    null,
  );
  const busy = operation !== null;
  const titleInput = useRef<HTMLInputElement>(null);
  const sourceInput = useRef<HTMLTextAreaElement>(null);
  const revisionInput = useRef<HTMLSelectElement>(null);
  useEffect(() => {
    titleInput.current?.focus();
  }, []);
  const pending = useRef(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const uid = useId();
  const dirty = title !== document.title || content !== document.content;
  useEffect(() => {
    onDirtyChange?.(dirty || busy);
    return () => onDirtyChange?.(false);
  }, [dirty, busy, onDirtyChange]);
  useEffect(() => {
    if (!dirty) return;
    const protect = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", protect);
    return () => window.removeEventListener("beforeunload", protect);
  }, [dirty]);
  const bytes = new TextEncoder().encode(content).byteLength;
  const overLimit = bytes > artifactLimits.contentBytes;
  const chartValidation = useMemo(
    () => (document.kind === "chart" ? parseChartSource(content) : null),
    [document.kind, content],
  );
  const tableValidation = useMemo(
    () => (document.kind === "table" ? parseTableSource(content) : null),
    [document.kind, content],
  );
  const canSave =
    dirty &&
    title.trim().length > 0 &&
    !overLimit &&
    (!chartValidation || chartValidation.success) &&
    (!tableValidation || tableValidation.success) &&
    document.version < artifactLimits.revisions;
  function fixtureDownload(format: "source" | "svg") {
    if (
      !fixture ||
      document.kind !== "chart" ||
      !parseChartSource(document.content).success
    )
      return;
    const content =
      format === "svg" ? chartSvg(document.content) : document.content;
    if (!content) return;
    const url = URL.createObjectURL(
      new Blob([content], {
        type: format === "svg" ? "image/svg+xml" : "application/json",
      }),
    );
    const anchor = window.document.createElement("a");
    anchor.href = url;
    anchor.download = artifactFilename(document.title, "chart").replace(
      /\.chart\.json$/,
      format === "svg" ? ".svg" : ".chart.json",
    );
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function commit(input: ArtifactMutation) {
    if (pending.current) return;
    pending.current = true;
    setOperation(input.action);
    setError("");
    setNotice("");
    try {
      const result = await api.mutate(input);
      if (result.deleted) {
        onDeleted();
        return;
      }
      const next = await api.read(result.id);
      onChange(next);
      setTitle(next.title);
      setContent(next.content);
      setSelected(String(next.version));
      setNotice(
        input.action === "restore"
          ? `Revision ${input.version} restored as revision ${next.version}.`
          : `Saved revision ${next.version}.`,
      );
    } catch (error) {
      setError(artifactError(error instanceof Error ? error.message : ""));
    } finally {
      pending.current = false;
      setOperation(null);
      if (input.action !== "delete")
        requestAnimationFrame(() => {
          const target =
            input.action === "restore"
              ? revisionInput.current
              : (sourceInput.current ?? titleInput.current);
          target?.focus();
        });
    }
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain px-5 pb-5 [padding-bottom:max(1.25rem,env(safe-area-inset-bottom))]">
      <div className="grid shrink-0 gap-2">
        <label htmlFor={`${uid}-title`} className="text-sm font-medium">
          Artifact title
        </label>
        <Input
          ref={titleInput}
          id={`${uid}-title`}
          value={title}
          maxLength={120}
          disabled={busy}
          onChange={(event) => setTitle(event.target.value)}
          className="text-base"
        />
      </div>
      <Tabs
        value={tab}
        onValueChange={(value) => setTab(value as typeof tab)}
        className="flex-1 shrink-0"
      >
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
          <TabsList aria-label="Artifact view" className="h-auto min-h-11">
            {(["source", "preview", "history"] as const).map((view) => (
              <TabsTrigger key={view} value={view} className="min-h-11 px-3">
                {view === "source"
                  ? "Edit source"
                  : view === "preview"
                    ? "Preview"
                    : "History"}
              </TabsTrigger>
            ))}
          </TabsList>
          <span className="text-xs text-muted-foreground">
            Revision {document.version} of 40{dirty ? " · Unsaved changes" : ""}
          </span>
        </div>
        <TabsContent value="source" className="flex flex-1 flex-col gap-2">
          <label htmlFor={`${uid}-source`} className="text-sm font-medium">
            {document.kind === "chart"
              ? "Chart JSON"
              : document.kind === "table"
                ? "Table JSON"
                : `${artifactKindLabel[document.kind]} source`}
          </label>
          <Textarea
            ref={sourceInput}
            id={`${uid}-source`}
            maxLength={artifactLimits.contentBytes}
            spellCheck={false}
            disabled={busy}
            value={content}
            onChange={(event) => setContent(event.target.value)}
            aria-invalid={
              chartValidation?.success === false ||
              tableValidation?.success === false
            }
            aria-describedby={
              document.kind === "chart" || document.kind === "table"
                ? `${uid}-structured-validation`
                : undefined
            }
            className="min-h-64 flex-1 resize-none font-mono text-base leading-6 [tab-size:2]"
          />
          {document.kind === "chart" && (
            <p
              id={`${uid}-structured-validation`}
              role={chartValidation?.success === false ? "alert" : undefined}
              className={`text-sm ${chartValidation?.success === false ? "text-destructive" : "text-muted-foreground"}`}
            >
              {chartValidation?.success === false
                ? chartValidation.error
                : "Valid chart JSON. Preview your changes, then save a revision. Use null for a missing value."}
            </p>
          )}
          {document.kind === "table" && (
            <p
              id={`${uid}-structured-validation`}
              role={tableValidation?.success === false ? "alert" : undefined}
              className={`text-sm ${tableValidation?.success === false ? "text-destructive" : "text-muted-foreground"}`}
            >
              {tableValidation?.success === false
                ? tableValidation.error
                : "Valid table JSON. Cells may be text, finite numbers, or booleans. Preview your changes, then save a revision."}
            </p>
          )}
          <span
            className={
              overLimit
                ? "text-sm text-destructive"
                : "text-xs text-muted-foreground"
            }
          >
            {bytes.toLocaleString()} /{" "}
            {artifactLimits.contentBytes.toLocaleString()} bytes
          </span>
        </TabsContent>
        <TabsContent value="preview" className="flex flex-1 flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            {document.kind === "chart"
              ? "Preview of your current edits. Saving adds a revision; downloads use the last saved revision."
              : document.kind === "table"
                ? "Preview of your current edits. CSV and XLSX downloads use the explicitly selected saved revision."
                : "Safe reading preview. Links, scripts, images, external resources, and custom styles are disabled."}
          </p>
          <ArtifactPreview source={content} kind={document.kind} />
        </TabsContent>
        <TabsContent value="history" className="flex-1 space-y-4">
          <p className="text-sm text-muted-foreground">
            Each save is permanent in history. Restore adds a new revision.
            Download before deleting an artifact; deletion removes all its
            revisions.
          </p>
          <label
            htmlFor={`${uid}-revision`}
            className="block text-sm font-medium"
          >
            Saved revision
          </label>
          <select
            ref={revisionInput}
            id={`${uid}-revision`}
            value={selected}
            disabled={busy}
            onChange={(event) => setSelected(event.target.value)}
            className="min-h-11 w-full rounded-md border bg-background p-2 text-base"
          >
            {document.revisions.map((revision) => (
              <option key={revision.version} value={revision.version}>
                Revision {revision.version}
                {revision.restoredFrom
                  ? ` (restored from ${revision.restoredFrom})`
                  : ""}{" "}
                — {revision.title}
              </option>
            ))}
          </select>
          {dirty && (
            <p className="text-sm text-muted-foreground">
              Save or discard your source changes before restoring a revision.
            </p>
          )}
          <Button
            variant="outline"
            aria-busy={operation === "restore"}
            disabled={
              busy ||
              dirty ||
              Number(selected) === document.version ||
              document.version >= artifactLimits.revisions
            }
            onClick={() =>
              void commit({
                action: "restore",
                id: document.id,
                expectedVersion: document.version,
                version: Number(selected),
              })
            }
          >
            {operation === "restore" ? (
              <Loader2 aria-hidden="true" className="animate-spin" />
            ) : (
              <RotateCcw aria-hidden="true" />
            )}
            Restore as new revision
          </Button>
        </TabsContent>
      </Tabs>
      {document.version >= artifactLimits.revisions && (
        <p className="text-sm text-muted-foreground">
          The 40 revision limit is reached. You can still preview, download, or
          delete this artifact.
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <output aria-live="polite" className="text-sm text-muted-foreground">
        {notice}
      </output>
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-t pt-4">
        <Button
          aria-busy={operation === "save"}
          disabled={busy || !canSave}
          onClick={() =>
            void commit({
              action: "save",
              id: document.id,
              expectedVersion: document.version,
              title,
              content,
            })
          }
        >
          {operation === "save" ? (
            <Loader2 aria-hidden="true" className="animate-spin" />
          ) : (
            <Save aria-hidden="true" />
          )}
          Save revision
        </Button>
        {dirty && (
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => {
              setTitle(document.title);
              setContent(document.content);
              setError("");
              setNotice("Unsaved changes discarded.");
              titleInput.current?.focus();
            }}
          >
            Discard changes
          </Button>
        )}
        <Button
          variant="outline"
          asChild
          disabled={fixture && document.kind !== "chart"}
        >
          <a
            href={
              fixture
                ? document.kind === "chart"
                  ? "#"
                  : undefined
                : `/api/artifacts?id=${encodeURIComponent(document.id)}&download=source`
            }
            download
            aria-disabled={fixture && document.kind !== "chart"}
            onClick={
              fixture && document.kind === "chart"
                ? (event) => {
                    event.preventDefault();
                    fixtureDownload("source");
                  }
                : undefined
            }
          >
            Download saved{" "}
            {document.kind === "html"
              ? "HTML source (.txt)"
              : document.kind === "chart"
                ? "chart JSON"
                : document.kind === "table"
                  ? "table JSON"
                  : "Markdown"}
          </a>
        </Button>
        {document.kind === "chart" && (
          <Button variant="outline" asChild>
            <a
              href={
                fixture
                  ? "#"
                  : `/api/artifacts?id=${encodeURIComponent(document.id)}&download=svg`
              }
              download
              onClick={
                fixture
                  ? (event) => {
                      event.preventDefault();
                      fixtureDownload("svg");
                    }
                  : undefined
              }
            >
              Download saved SVG
            </a>
          </Button>
        )}
        {document.kind === "table" &&
          (["csv", "xlsx"] as const).map((format) =>
            fixture ? (
              <Button key={format} variant="outline" disabled>
                Download revision {selected} {format.toUpperCase()}
              </Button>
            ) : (
              <Button key={format} variant="outline" asChild>
                <a
                  href={`/api/artifacts?id=${encodeURIComponent(document.id)}&version=${encodeURIComponent(selected)}&download=${format}`}
                  download
                >
                  Download revision {selected} {format.toUpperCase()}
                </a>
              </Button>
            ),
          )}
        {document.kind === "table" && (
          <p className="basis-full text-xs text-muted-foreground">
            CSV adds a leading tab to formula-like text to help mitigate formula
            injection. Behavior varies by spreadsheet app; verify the downloaded
            file before opening it. XLSX stores those values as explicit text
            cells. The saved JSON is unchanged.
          </p>
        )}
        <Button
          variant="ghost"
          aria-label="Delete artifact"
          disabled={busy}
          onClick={() => setDeleteConfirm(!deleteConfirm)}
        >
          <Trash2 />
        </Button>
      </div>
      {deleteConfirm && (
        <div className="flex shrink-0 flex-wrap items-center gap-2 rounded-md border p-3">
          <p className="w-full text-sm">
            Delete this artifact and all {document.version} revisions?
          </p>
          <Button
            variant="destructive"
            aria-busy={operation === "delete"}
            disabled={busy}
            onClick={() => void commit({ action: "delete", id: document.id })}
          >
            {operation === "delete" ? (
              <Loader2 aria-hidden="true" className="animate-spin" />
            ) : (
              <Trash2 aria-hidden="true" />
            )}
            Delete all revisions
          </Button>
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => setDeleteConfirm(false)}
          >
            Keep artifact
          </Button>
        </div>
      )}
    </div>
  );
}

function ArtifactPanel({
  chatId,
  messageId,
  api = client,
  fixture = false,
  onDirtyChange,
}: {
  chatId: string;
  messageId?: string;
  api?: ArtifactClient;
  fixture?: boolean;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const [dirty, setDirty] = useState(false);
  const [documents, setDocuments] = useState<ArtifactSummary[]>([]);
  const [document, setDocument] = useState<ArtifactDocument | null>(null);
  const [kind, setKind] = useState<ArtifactKind>("markdown");
  const imageCatalog = useImageCatalog(!fixture);
  const [title, setTitle] = useState("Untitled artifact");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const listHeading = useRef<HTMLHeadingElement>(null);
  const hadDocument = useRef(false);
  useEffect(() => {
    if (document) hadDocument.current = true;
    else if (hadDocument.current) {
      listHeading.current?.focus();
      hadDocument.current = false;
    }
  }, [document]);
  const pending = useRef(false);
  useEffect(() => {
    onDirtyChange?.(dirty || busy);
    return () => onDirtyChange?.(false);
  }, [dirty, onDirtyChange, busy]);
  const uid = useId();
  useEffect(() => {
    let active = true;
    setLoading(true);
    api
      .list(chatId)
      .then((list) => {
        if (active) setDocuments(list);
      })
      .catch((error) => {
        if (active) setError(artifactError(error.message));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [api, chatId]);
  async function open(id: string) {
    if (pending.current) return;
    pending.current = true;
    setOpeningId(id);
    setBusy(true);
    setError("");
    try {
      setDocument(await api.read(id));
    } catch (error) {
      setError(artifactError(error instanceof Error ? error.message : ""));
    } finally {
      pending.current = false;
      setBusy(false);
      setCreating(false);
      setOpeningId(null);
    }
  }
  async function create() {
    if (!messageId || kind === "image" || pending.current || loading) return;
    pending.current = true;
    setCreating(true);
    setBusy(true);
    setError("");
    try {
      const result = await api.mutate({
        action: "create",
        chatId,
        messageId,
        kind,
        title,
      });
      const created = await api.read(result.id);
      setDocument(created);
      setDocuments((list) => [
        created,
        ...list.filter((item) => item.id !== created.id),
      ]);
    } catch (error) {
      setError(artifactError(error instanceof Error ? error.message : ""));
    } finally {
      pending.current = false;
      setBusy(false);
      setCreating(false);
      setOpeningId(null);
    }
  }
  return (
    <>
      <SheetHeader className="min-w-0 shrink-0 pr-14 [overflow-wrap:anywhere]">
        <SheetTitle>
          {document ? document.title : "Conversation artifacts"}
        </SheetTitle>
        <SheetDescription>
          {document
            ? `From a saved assistant message · ${artifactKindLabel[document.kind]}`
            : "Save a response as an editable document. Artifacts stay linked to this conversation."}
        </SheetDescription>
      </SheetHeader>
      {document ? (
        <>
          <div className="px-5">
            <Button
              variant="ghost"
              size="sm"
              disabled={dirty}
              onClick={() => setDocument(null)}
            >
              All artifacts
            </Button>
          </div>
          <ArtifactEditor
            key={document.id}
            document={document}
            api={api}
            fixture={fixture}
            onDirtyChange={setDirty}
            onChange={(next) => {
              setDocument(next);
              setDocuments((list) =>
                list.map((item) => (item.id === next.id ? next : item)),
              );
            }}
            onDeleted={() => {
              setDocuments((list) =>
                list.filter((item) => item.id !== document.id),
              );
              setDocument(null);
            }}
          />
        </>
      ) : (
        <div className="min-h-0 space-y-6 overflow-y-auto overscroll-contain px-5 pb-5">
          {messageId && (
            <form
              className="space-y-3 rounded-lg border p-4"
              onSubmit={(event) => {
                event.preventDefault();
                void create();
              }}
            >
              <h3 className="font-medium">Create from this response</h3>
              <p className="text-sm text-muted-foreground">
                {kind === "image"
                  ? "Generate a private image linked to this saved response."
                  : "The saved response becomes revision 1. No model call is needed."}
              </p>
              <label
                htmlFor={`${uid}-new-title`}
                className="block text-sm font-medium"
              >
                Title
              </label>
              <Input
                id={`${uid}-new-title`}
                value={title}
                required
                maxLength={120}
                disabled={busy}
                onChange={(event) => setTitle(event.target.value)}
                className="text-base"
              />
              <label
                htmlFor={`${uid}-kind`}
                className="block text-sm font-medium"
              >
                Format
              </label>
              <select
                id={`${uid}-kind`}
                className="min-h-11 w-full rounded-md border bg-background px-3 text-base"
                value={kind}
                disabled={busy}
                onChange={(event) =>
                  setKind(event.target.value as ArtifactKind)
                }
              >
                <option value="markdown">Markdown document</option>
                <option value="html">HTML document</option>
                <option value="chart">Chart from JSON</option>
                <option value="table">Typed table from JSON</option>
                {imageCatalog.available && (
                  <option value="image">Image with your OpenRouter key</option>
                )}
              </select>
              {kind === "chart" && (
                <p className="text-sm text-muted-foreground">
                  The response must contain a complete version 1 chart JSON spec
                  for bar, line, area, or scatter. No model call is made.
                </p>
              )}
              {kind === "table" && (
                <p className="text-sm text-muted-foreground">
                  The response must contain a complete version 1 table JSON spec
                  with positional text, finite-number, or boolean cells. No
                  model call is made.
                </p>
              )}
              {kind === "image" ? (
                <ImageComposer
                  catalog={imageCatalog}
                  chatId={chatId}
                  messageId={messageId}
                  title={title}
                  onBusyChange={setBusy}
                  onSaved={open}
                />
              ) : (
                <Button
                  type="submit"
                  aria-busy={creating}
                  disabled={loading || busy || !title.trim()}
                >
                  {creating ? (
                    <Loader2 aria-hidden="true" className="animate-spin" />
                  ) : (
                    <FileText aria-hidden="true" />
                  )}
                  Create artifact
                </Button>
              )}
            </form>
          )}
          <div className="space-y-2" aria-busy={loading}>
            <h3
              ref={listHeading}
              tabIndex={-1}
              className="text-sm font-medium focus-visible:outline-ring"
            >
              Saved in this conversation
            </h3>
            {loading ? (
              <output
                aria-live="polite"
                className="flex items-center gap-2 text-sm text-muted-foreground"
              >
                <Loader2 aria-hidden="true" className="size-4 animate-spin" />
                Loading artifacts
              </output>
            ) : documents.length ? (
              documents.map((item) => (
                <Button
                  key={item.id}
                  variant="outline"
                  className="h-auto min-h-12 w-full justify-start whitespace-normal text-left"
                  disabled={busy}
                  aria-busy={openingId === item.id}
                  onClick={() => void open(item.id)}
                >
                  {openingId === item.id ? (
                    <Loader2
                      aria-hidden="true"
                      className="shrink-0 animate-spin"
                    />
                  ) : item.kind === "image" ? (
                    <ImageIcon className="shrink-0" />
                  ) : item.kind === "chart" ? (
                    <ChartNoAxesCombined className="shrink-0" />
                  ) : item.kind === "table" ? (
                    <Table2 className="shrink-0" />
                  ) : item.kind === "html" ? (
                    <FileCode2 className="shrink-0" />
                  ) : (
                    <FileText className="shrink-0" />
                  )}
                  <span className="min-w-0 break-words">
                    {item.title}
                    <span className="block text-xs font-normal text-muted-foreground">
                      Revision {item.version}
                    </span>
                  </span>
                </Button>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">
                Use “Create artifact” under a saved response to start a
                document.
              </p>
            )}
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </div>
      )}
    </>
  );
}
export function ConversationArtifacts({
  chatId,
  messageId,
  api,
  fixture = false,
}: {
  chatId: string;
  messageId?: string;
  api?: ArtifactClient;
  fixture?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [closeBlocked, setCloseBlocked] = useState(false);
  useEffect(() => {
    if (!dirty) setCloseBlocked(false);
  }, [dirty]);
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next && dirty) {
          setCloseBlocked(true);
          return;
        }
        setCloseBlocked(false);
        setOpen(next);
      }}
    >
      <SheetTrigger asChild>
        <Button variant="ghost" size="sm" className="text-muted-foreground">
          {messageId ? <FileText /> : <FolderOpen />}
          {messageId ? "Create artifact" : "Artifacts"}
        </Button>
      </SheetTrigger>
      <SheetContent className="h-dvh w-full gap-2 sm:max-w-3xl motion-reduce:animate-none">
        {closeBlocked && (
          <p
            role="alert"
            className="px-5 pt-4 pr-14 text-sm text-muted-foreground"
          >
            Save or discard your changes before closing this artifact.
          </p>
        )}
        <ArtifactPanel
          chatId={chatId}
          messageId={messageId}
          api={api}
          fixture={fixture}
          onDirtyChange={setDirty}
        />
      </SheetContent>
    </Sheet>
  );
}
