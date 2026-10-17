"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ChatHeader } from "@/components/shell/chat-header";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { type ContextClient, contextClient } from "@/lib/context/client";
import type { ContextLibrary } from "@/lib/context/contract";
export function ContextManager({
  client = contextClient,
  embedded = false,
}: {
  client?: ContextClient;
  embedded?: boolean;
} = {}) {
  const [data, setData] = useState<ContextLibrary>();
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const deletedFocus = useRef<"memory" | "project" | null>(null);
  const [notice, setNotice] = useState("");
  const [memory, setMemory] = useState({ id: "", content: "", projectId: "" });
  const [project, setProject] = useState({
    id: "",
    name: "",
    instructions: "",
  });
  const [deleting, setDeleting] = useState<{
    kind: "memory" | "project";
    id: string;
  } | null>(null);
  const load = useCallback(async () => {
    setData(await client.library());
  }, [client]);
  useEffect(() => {
    void load().catch(() =>
      setError("Memory and projects could not load. Refresh to try again."),
    );
  }, [load]);
  useEffect(() => {
    if (!pending && !deleting && deletedFocus.current) {
      document
        .getElementById(
          deletedFocus.current === "memory" ? "memory-content" : "project-name",
        )
        ?.focus();
      deletedFocus.current = null;
    }
  }, [pending, deleting]);
  async function save(body: unknown, done: () => void) {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    setError("");
    setNotice("");
    try {
      await client.mutate(body);
      await load();
      done();
      setNotice(
        "Changes saved. Refresh the request context in open conversations.",
      );
    } catch {
      setError(
        "Changes could not save. Check the size limits and try again. Your draft remains here.",
      );
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  }
  return (
    <div className={`flex ${embedded ? "h-full" : "h-dvh"} min-h-0 flex-col`}>
      <ChatHeader
        title="Memory & projects"
        onNewChat={() => window.location.assign("/chat")}
      />
      <main className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-6">
        <div className="mx-auto max-w-3xl space-y-8">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              Choose what Galaxy remembers
            </h1>
            <p className="mt-2 max-w-prose text-sm leading-relaxed text-muted-foreground">
              Write and edit memories yourself, then select them for each
              request. Conversations never create memories automatically.
              Deleting a memory removes it from future selections; previously
              generated answers and provider retention are separate.
            </p>
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <output className="block text-sm text-muted-foreground">
            {notice}
          </output>
          <section className="space-y-4" aria-labelledby="memory-heading">
            <h2 id="memory-heading" className="text-lg font-semibold">
              Explicit memories
            </h2>
            <form
              className="space-y-3 rounded-xl border border-border p-4"
              onSubmit={(event) => {
                event.preventDefault();
                void save(
                  {
                    action: "memory.save",
                    ...(memory.id ? { id: memory.id } : {}),
                    content: memory.content,
                    projectId: memory.projectId || null,
                  },
                  () => setMemory({ id: "", content: "", projectId: "" }),
                );
              }}
            >
              <label className="block space-y-2" htmlFor="memory-content">
                <span className="text-sm font-medium">
                  {memory.id ? "Edit memory" : "New memory"}
                </span>
                <Textarea
                  id="memory-content"
                  className="text-base"
                  value={memory.content}
                  onChange={(e) =>
                    setMemory({ ...memory, content: e.target.value })
                  }
                  maxLength={1000}
                  required
                  disabled={pending}
                />
              </label>
              <label className="block space-y-1 text-sm">
                <span>Available in</span>
                <select
                  className="min-h-11 w-full rounded-md border border-input bg-background px-2 text-base"
                  value={memory.projectId}
                  disabled={pending}
                  onChange={(e) =>
                    setMemory({ ...memory, projectId: e.target.value })
                  }
                >
                  <option value="">Any project (still opt in)</option>
                  {data?.projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
              <p className="text-xs text-muted-foreground">
                Up to 1,000 characters / 1,800 UTF-8 bytes. Maximum 100
                memories; choose up to eight per request.
              </p>
              <div className="flex gap-2">
                <Button
                  disabled={pending || !data || !memory.content.trim()}
                  aria-busy={pending}
                  type="submit"
                >
                  {pending ? "Saving…" : "Save memory"}
                </Button>
                {memory.id && (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={pending}
                    onClick={() =>
                      setMemory({ id: "", content: "", projectId: "" })
                    }
                  >
                    Cancel edit
                  </Button>
                )}
              </div>
            </form>
            {data?.memories.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No memories saved. Add only what you want to reuse.
              </p>
            )}
            <ul className="divide-y divide-border">
              {data?.memories.map((m) => (
                <li key={m.id} className="space-y-2 py-4">
                  <p className="whitespace-pre-wrap break-words text-sm">
                    {m.content}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {data.projects.find((p) => p.id === m.projectId)?.name ??
                      "Any project"}
                  </p>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      disabled={pending}
                      onClick={() => {
                        setMemory({
                          id: m.id,
                          content: m.content,
                          projectId: m.projectId ?? "",
                        });
                        document.getElementById("memory-content")?.focus();
                      }}
                    >
                      Edit memory
                    </Button>
                    <Button
                      variant="ghost"
                      disabled={pending}
                      onClick={() => setDeleting({ kind: "memory", id: m.id })}
                    >
                      Delete memory
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          </section>
          <section aria-labelledby="projects-heading" className="space-y-4">
            <h2 id="projects-heading" className="text-lg font-semibold">
              Projects
            </h2>
            <p className="text-sm text-muted-foreground">
              Group new conversations with instructions shared only inside that
              project. Existing conversations keep their project.
            </p>
            <form
              className="space-y-3 rounded-xl border border-border p-4"
              onSubmit={(e) => {
                e.preventDefault();
                void save(
                  {
                    action: "project.save",
                    ...(project.id ? { id: project.id } : {}),
                    name: project.name,
                    instructions: project.instructions,
                  },
                  () => setProject({ id: "", name: "", instructions: "" }),
                );
              }}
            >
              <label className="block space-y-2 text-sm" htmlFor="project-name">
                <span>{project.id ? "Edit project name" : "Project name"}</span>
                <Input
                  id="project-name"
                  className="text-base"
                  maxLength={80}
                  required
                  value={project.name}
                  disabled={pending}
                  onChange={(e) =>
                    setProject({ ...project, name: e.target.value })
                  }
                />
              </label>
              <label
                className="block space-y-2 text-sm"
                htmlFor="project-instructions"
              >
                <span>Project instructions</span>
                <Textarea
                  id="project-instructions"
                  className="text-base"
                  maxLength={2000}
                  value={project.instructions}
                  disabled={pending}
                  onChange={(e) =>
                    setProject({ ...project, instructions: e.target.value })
                  }
                />
              </label>
              <p className="text-xs text-muted-foreground">
                Up to 2,000 characters / 3,000 UTF-8 bytes. Maximum 30 projects.
              </p>
              <div className="flex gap-2">
                <Button
                  type="submit"
                  disabled={pending || !data || !project.name.trim()}
                  aria-busy={pending}
                >
                  {pending ? "Saving…" : "Save project"}
                </Button>
                {project.id && (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={pending}
                    onClick={() =>
                      setProject({ id: "", name: "", instructions: "" })
                    }
                  >
                    Cancel edit
                  </Button>
                )}
              </div>
            </form>
            {data?.projects.map((p) => (
              <div className="space-y-3 border-t border-border py-4" key={p.id}>
                <h3 className="break-words font-medium">{p.name}</h3>
                <p className="whitespace-pre-wrap break-words text-sm text-muted-foreground">
                  {p.instructions || "No extra instructions."}
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button asChild variant="outline">
                    <Link href={`/chat?project=${p.id}`}>
                      New project conversation
                    </Link>
                  </Button>
                  <Button
                    variant="outline"
                    disabled={pending}
                    onClick={() => {
                      setProject({
                        id: p.id,
                        name: p.name,
                        instructions: p.instructions,
                      });
                      document.getElementById("project-name")?.focus();
                    }}
                  >
                    Edit project
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={pending}
                    onClick={() => setDeleting({ kind: "project", id: p.id })}
                  >
                    Delete project
                  </Button>
                </div>
                <ul className="space-y-1">
                  {data.chats
                    .filter((c) => c.projectId === p.id)
                    .map((c) => (
                      <li key={c.id}>
                        <Link
                          className="inline-flex min-h-11 max-w-full items-center rounded-md py-2 text-sm underline focus-visible:outline-2 focus-visible:outline-ring"
                          href={`/chat/${c.id}`}
                        >
                          <span className="break-words">{c.title}</span>
                        </Link>
                      </li>
                    ))}
                </ul>
                {!data.chats.some((c) => c.projectId === p.id) && (
                  <p className="text-sm text-muted-foreground">
                    No conversations in this project yet.
                  </p>
                )}
              </div>
            ))}
          </section>
        </div>
      </main>
      <Dialog
        open={!!deleting}
        onOpenChange={(open) => {
          if (!open && !pending) setDeleting(null);
        }}
      >
        <DialogContent
          onCloseAutoFocus={(event) => {
            if (deletedFocus.current) event.preventDefault();
          }}
        >
          <DialogHeader>
            <DialogTitle>Delete {deleting?.kind}?</DialogTitle>
            <DialogDescription>
              {deleting?.kind === "project"
                ? "This removes its instructions and project memories. Saved conversations remain, without a project."
                : "This removes the memory from future prompts. Previous conversation answers remain."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              autoFocus
              disabled={pending}
              onClick={() => setDeleting(null)}
            >
              Keep {deleting?.kind}
            </Button>
            <Button
              variant="destructive"
              disabled={pending}
              aria-busy={pending}
              onClick={() => {
                if (deleting)
                  void save(
                    { action: `${deleting.kind}.delete`, id: deleting.id },
                    () => {
                      deletedFocus.current = deleting.kind;
                      if (
                        deleting.kind === "memory" &&
                        memory.id === deleting.id
                      )
                        setMemory({ id: "", content: "", projectId: "" });
                      if (
                        deleting.kind === "project" &&
                        project.id === deleting.id
                      )
                        setProject({ id: "", name: "", instructions: "" });
                      setDeleting(null);
                    },
                  );
              }}
            >
              {pending ? "Deleting…" : `Delete ${deleting?.kind}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
