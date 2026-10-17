"use client";
import { FileCode2, FileText, FolderOpen, Save, Trash2 } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import {
  type ArtifactDocument,
  type ArtifactKind,
  type ArtifactMutation,
  type ArtifactSummary,
  artifactError,
  artifactLimits,
} from "@/lib/artifacts/contract";
import {
  artifactPreviewDocument,
  markdownPreviewDocument,
} from "@/lib/artifacts/preview";

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
      kind === "html"
        ? artifactPreviewDocument(source)
        : markdownPreviewDocument(source),
    [source, kind],
  );
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
export function ArtifactEditor({
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
  const [busy, setBusy] = useState(false);
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
  const canSave =
    dirty &&
    title.trim().length > 0 &&
    !overLimit &&
    document.version < artifactLimits.revisions;
  async function commit(input: ArtifactMutation) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
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
      setBusy(false);
    }
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain px-5 pb-5 [padding-bottom:max(1.25rem,env(safe-area-inset-bottom))]">
      <div className="grid gap-2">
        <label htmlFor={`${uid}-title`} className="text-sm font-medium">
          Artifact title
        </label>
        <Input
          id={`${uid}-title`}
          value={title}
          maxLength={120}
          disabled={busy}
          onChange={(event) => setTitle(event.target.value)}
          className="text-base"
        />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <fieldset className="flex gap-1">
          <legend className="sr-only">Artifact view</legend>
          {(["source", "preview", "history"] as const).map((view) => (
            <Button
              key={view}
              size="sm"
              variant={tab === view ? "secondary" : "ghost"}
              aria-pressed={tab === view}
              onClick={() => setTab(view)}
            >
              {view === "source"
                ? "Edit source"
                : view === "preview"
                  ? "Preview"
                  : "History"}
            </Button>
          ))}
        </fieldset>
        <span className="text-xs text-muted-foreground">
          Revision {document.version} of 40{dirty ? " · Unsaved changes" : ""}
        </span>
      </div>
      {tab === "source" && (
        <div className="flex min-h-0 flex-1 flex-col gap-2">
          <label htmlFor={`${uid}-source`} className="text-sm font-medium">
            {document.kind === "html" ? "HTML source" : "Markdown source"}
          </label>
          <Textarea
            id={`${uid}-source`}
            spellCheck={false}
            disabled={busy}
            value={content}
            onChange={(event) => setContent(event.target.value)}
            className="min-h-64 flex-1 resize-none font-mono text-base leading-6 [tab-size:2]"
          />
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
        </div>
      )}
      {tab === "preview" && (
        <div className="flex min-h-0 flex-1 flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            Safe reading preview. Links, scripts, images, external resources,
            and custom styles are disabled.
          </p>
          <ArtifactPreview source={content} kind={document.kind} />
        </div>
      )}
      {tab === "history" && (
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain">
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
            Restore as new revision
          </Button>
        </div>
      )}
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
      <div className="flex flex-wrap items-center gap-2 border-t pt-4">
        <Button
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
          <Save />
          {busy ? "Saving…" : "Save revision"}
        </Button>
        {dirty && (
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => {
              setTitle(document.title);
              setContent(document.content);
              setError("");
            }}
          >
            Discard changes
          </Button>
        )}
        <Button variant="outline" asChild disabled={fixture}>
          <a
            href={
              fixture
                ? undefined
                : `/api/artifacts?id=${encodeURIComponent(document.id)}&download=source`
            }
            download
            aria-disabled={fixture}
          >
            Download saved{" "}
            {document.kind === "html" ? "HTML source (.txt)" : "Markdown"}
          </a>
        </Button>
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
        <div className="flex flex-wrap items-center gap-2 rounded-md border p-3">
          <p className="w-full text-sm">
            Delete this artifact and all {document.version} revisions?
          </p>
          <Button
            variant="destructive"
            disabled={busy}
            onClick={() => void commit({ action: "delete", id: document.id })}
          >
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
  const [title, setTitle] = useState("Untitled artifact");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  useEffect(() => {
    onDirtyChange?.(dirty || busy);
    return () => onDirtyChange?.(false);
  }, [dirty, onDirtyChange, busy]);
  const uid = useId();
  useEffect(() => {
    let active = true;
    api
      .list(chatId)
      .then((list) => {
        if (active) setDocuments(list);
      })
      .catch((error) => {
        if (active) setError(artifactError(error.message));
      });
    return () => {
      active = false;
    };
  }, [api, chatId]);
  async function open(id: string) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      setDocument(await api.read(id));
    } catch (error) {
      setError(artifactError(error instanceof Error ? error.message : ""));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  async function create() {
    if (!messageId || pending.current) return;
    pending.current = true;
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
      setDocument(await api.read(result.id));
      setDocuments(await api.list(chatId));
    } catch (error) {
      setError(artifactError(error instanceof Error ? error.message : ""));
    } finally {
      pending.current = false;
      setBusy(false);
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
            ? `From a saved assistant message · ${document.kind === "html" ? "HTML" : "Markdown"}`
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
                The saved response becomes revision 1. No model call is needed.
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
              </select>
              <Button type="submit" disabled={busy || !title.trim()}>
                {busy ? "Creating…" : "Create artifact"}
              </Button>
            </form>
          )}
          <div className="space-y-2">
            <h3 className="text-sm font-medium">Saved in this conversation</h3>
            {documents.length ? (
              documents.map((item) => (
                <Button
                  key={item.id}
                  variant="outline"
                  className="h-auto min-h-12 w-full justify-start whitespace-normal text-left"
                  disabled={busy}
                  onClick={() => void open(item.id)}
                >
                  {item.kind === "html" ? (
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
