"use client";
import { useCallback, useMemo, useState } from "react";
import { ContextPicker } from "@/components/chat/context-picker";
import { ContextManager } from "@/components/context-manager";
import { Button } from "@/components/ui/button";
import { SidebarProvider } from "@/components/ui/sidebar";
import type { ContextClient } from "@/lib/context/client";
import {
  CONTEXT_LIMITS,
  type ContextLibrary,
  contextMutationSchema,
} from "@/lib/context/contract";

function fixtureClient(): ContextClient {
  const data: ContextLibrary = {
    projects: [
      {
        id: "10000000-0000-4000-8000-000000000001",
        name: "Release notes",
        instructions:
          "Use concise language. Explain changes from the reader’s perspective.",
      },
    ],
    memories: [
      {
        id: "20000000-0000-4000-8000-000000000001",
        content: "I prefer examples in TypeScript.",
        projectId: null,
      },
      {
        id: "20000000-0000-4000-8000-000000000002",
        content: "This release is for a small invite-only team.",
        projectId: "10000000-0000-4000-8000-000000000001",
      },
    ],
    chats: [],
  };
  return {
    library: async () => structuredClone(data),
    preview: async (selection) => {
      const project =
        data.projects.find((p) => p.id === selection.projectId) ?? null;
      const memories = selection.memoryIds.map((id) => {
        const m = data.memories.find(
          (m) =>
            m.id === id &&
            (!m.projectId || m.projectId === selection.projectId),
        );
        if (!m) throw new Error("fixture_context_changed");
        return { id: m.id, content: m.content };
      });
      const instructions = [
        project?.instructions,
        ...memories.map((m) => m.content),
      ]
        .filter(Boolean)
        .join("\n");
      const instructionBytes = new TextEncoder().encode(
        JSON.stringify(instructions),
      ).length;
      if (instructionBytes > CONTEXT_LIMITS.instructionBytes)
        throw new Error("fixture_context_too_large");
      return {
        project,
        memories,
        instructions,
        instructionBytes,
        digest: "f".repeat(64),
        limits: CONTEXT_LIMITS,
      };
    },
    mutate: async (body) => {
      const parsed = contextMutationSchema.parse(body);
      if (parsed.action === "memory.save") {
        const id = parsed.id ?? crypto.randomUUID();
        data.memories = [
          ...data.memories.filter((m) => m.id !== id),
          { id, content: parsed.content, projectId: parsed.projectId },
        ];
      }
      if (parsed.action === "project.save") {
        const id = parsed.id ?? crypto.randomUUID();
        data.projects = [
          ...data.projects.filter((p) => p.id !== id),
          { id, name: parsed.name, instructions: parsed.instructions },
        ];
      }
      if (parsed.action === "memory.delete")
        data.memories = data.memories.filter((m) => m.id !== parsed.id);
      if (parsed.action === "project.delete") {
        data.projects = data.projects.filter((p) => p.id !== parsed.id);
        data.memories = data.memories.filter((m) => m.projectId !== parsed.id);
        data.chats = data.chats.map((c) =>
          c.projectId === parsed.id ? { ...c, projectId: null } : c,
        );
      }
    },
  };
}
export function ContextPreview() {
  const client = useMemo(fixtureClient, []);
  const [mode, setMode] = useState("manage");
  const [ready, setReady] = useState(false);
  const onChange = useCallback(
    (_selection: unknown, nextReady: boolean) => setReady(nextReady),
    [],
  );
  return (
    <SidebarProvider>
      <div className="flex h-dvh w-full min-w-0 flex-col bg-background">
        <div className="shrink-0 border-b border-border px-4 py-2">
          <p className="text-xs leading-relaxed text-muted-foreground">
            Local F09 fixture. Memory stays in this component. No
            authentication, database or provider requests.
          </p>
          <div className="mt-2 flex gap-2">
            <Button
              variant={mode === "manage" ? "secondary" : "outline"}
              onClick={() => setMode("manage")}
            >
              Memory & projects
            </Button>
            <Button
              variant={mode === "request" ? "secondary" : "outline"}
              onClick={() => setMode("request")}
            >
              Request context
            </Button>
          </div>
        </div>
        <div className="min-h-0 flex-1">
          {mode === "manage" ? (
            <ContextManager client={client} embedded />
          ) : (
            <div className="mx-auto max-w-3xl space-y-4 p-4">
              <h1 className="text-xl font-semibold">Review a request</h1>
              <p className="text-sm text-muted-foreground">
                Open Request context, choose a project and check a memory. The
                exact selected text appears before the fixture send control
                becomes available.
              </p>
              <ContextPicker
                projectId={null}
                locked={false}
                disabled={false}
                onChange={onChange}
                client={client}
              />
              <Button disabled={!ready}>Fixture send available</Button>
              <p className="text-sm text-muted-foreground">
                Temporary conversations use the same explicit selection and cost
                limits. Their transcript stays in the tab; provider retention is
                independent.
              </p>
            </div>
          )}
        </div>
      </div>
    </SidebarProvider>
  );
}
