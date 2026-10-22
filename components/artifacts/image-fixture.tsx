"use client";
import { useTheme } from "next-themes";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ArtifactDocument } from "@/lib/artifacts/contract";
import type { ImageSnapshot, ImageStatus } from "@/lib/images/contract";
import type { ArtifactClient } from "./artifact-workbench";
import {
  type ImageClient,
  ImageComposer,
  ImageEditor,
} from "./image-workbench";
export const imageFixtureSnapshot: ImageSnapshot = {
  id: "offline-fixture",
  adapter: "openrouter",
  model: "fixture/image-not-a-real-model",
  provider: "fixture-endpoint",
  verified: true,
  reviewedAt: "2026-01-01T00:00:00Z",
  expiresAt: "2030-01-01T00:00:00Z",
  width: 1024,
  height: 1024,
  mediaType: "image/png",
  generate: true,
  edit: false,
  mask: false,
  parameters: ["size", "n"],
  providerMaxMicrodollarsPerImage: 100000,
  worstCaseEstimateMicrodollars: 120000,
  providerBudgetVerified: true,
};
export function ImageFixture() {
  const { resolvedTheme, setTheme } = useTheme();
  const [document, setDocument] = useState<ArtifactDocument | null>(null),
    [title, setTitle] = useState("Quiet evening on an imaginary planet"),
    [held, setHeld] = useState(false);
  const state = useMemo(
    () => ({
      history: [] as ArtifactDocument[],
      requests: new Map<string, ImageStatus>(),
    }),
    [],
  );
  const api: ArtifactClient = {
    list: async () => state.history.slice(-1),
    read: async () => {
      const latest = state.history.at(-1);
      if (!latest) throw Error("not_found");
      return latest;
    },
    mutate: async (input) => {
      const latest = state.history.at(-1);
      if (!latest) throw Error("not_found");
      if (input.action === "delete") {
        state.history.length = 0;
        return { id: latest.id, deleted: true };
      }
      if (
        input.action !== "restore" ||
        input.expectedVersion !== latest.version
      )
        throw Error("artifact_conflict");
      const old = state.history.find((doc) => doc.version === input.version);
      if (!old) throw Error("not_found");
      const next = {
        ...old,
        version: latest.version + 1,
        revisions: [
          {
            version: latest.version + 1,
            title: old.title,
            restoredFrom: old.version,
            createdAt: new Date().toISOString(),
          },
          ...latest.revisions,
        ],
      };
      state.history.push(next);
      return { id: next.id };
    },
  };
  const imageApi: ImageClient = useMemo(
    () => ({
      catalog: async () => ({
        available: true,
        model: imageFixtureSnapshot,
        reviewDigest: "0".repeat(64),
        credentialRevision: "10000000-0000-4000-8000-000000000001",
      }),
      status: async (id) => {
        const current = state.requests.get(id);
        if (!current) throw Error("not_found");
        return current;
      },
      cancel: async (id) => {
        const current = {
          id,
          state: "held" as const,
          cancelled: true,
          artifactId: null,
        };
        state.requests.set(id, current);
        return current;
      },
      generate: async (input) => {
        state.requests.set(input.requestId, {
          id: input.requestId,
          state: "entered",
          cancelled: false,
          artifactId: null,
        });
        await new Promise((resolve) => setTimeout(resolve, 300));
        if (held || state.requests.get(input.requestId)?.cancelled) {
          state.requests.set(input.requestId, {
            id: input.requestId,
            state: "held",
            cancelled: !!state.requests.get(input.requestId)?.cancelled,
            artifactId: null,
          });
          throw Error("image_held");
        }
        const latest = input.target ? state.history.at(-1) : undefined;
        const id = latest?.id ?? crypto.randomUUID(),
          version = (latest?.version ?? 0) + 1,
          now = new Date().toISOString();
        const next: ArtifactDocument = {
          id,
          chatId: "fixture-chat",
          messageId: "fixture-answer",
          kind: "image",
          title: input.title,
          version,
          updatedAt: now,
          content: JSON.stringify({
            version: 1,
            operation: "generate",
            prompt: input.prompt,
            model: imageFixtureSnapshot,
            inputs: [],
            object: {
              id: "fixture-object",
              sha256: "0".repeat(64),
              bytes: 0,
              width: 1024,
              height: 1024,
              mediaType: "image/png",
            },
          }),
          revisions: [
            {
              version,
              title: input.title,
              restoredFrom: null,
              createdAt: now,
            },
            ...(latest?.revisions ?? []),
          ],
        };
        state.history.push(next);
        state.requests.set(input.requestId, {
          id: input.requestId,
          state: "complete",
          cancelled: false,
          artifactId: id,
        });
        return { id, version };
      },
    }),
    [state, held],
  );
  return (
    <main className="mx-auto min-h-svh w-full max-w-3xl space-y-6 overflow-x-clip p-5 pb-12 text-foreground">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Image workbench</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Development fixture. No provider call, billed request,
            private-storage proof, or download.
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
        >
          Switch theme
        </Button>
      </div>
      {document ? (
        <>
          <Button variant="ghost" onClick={() => setDocument(null)}>
            New fixture image
          </Button>
          <ImageEditor
            document={document}
            api={api}
            imageApi={imageApi}
            onChange={setDocument}
            onDeleted={() => setDocument(null)}
            fixture
          />
        </>
      ) : (
        <>
          <label
            htmlFor="fixture-image-title"
            className="block text-sm font-medium"
          >
            Image title
          </label>
          <Input
            id="fixture-image-title"
            value={title}
            maxLength={120}
            onChange={(e) => setTitle(e.target.value)}
          />
          <label className="flex min-h-11 items-center gap-3 text-sm">
            <input
              type="checkbox"
              checked={held}
              onChange={(e) => setHeld(e.target.checked)}
            />
            Simulate an unknown provider outcome
          </label>
          <ImageComposer
            catalog={{
              available: true,
              model: imageFixtureSnapshot,
              credentialRevision: "10000000-0000-4000-8000-000000000001",
            }}
            chatId="fixture-chat"
            messageId="fixture-answer"
            title={title}
            api={imageApi}
            onSaved={async (id) => setDocument(await api.read(id))}
            fixture
          />
        </>
      )}
    </main>
  );
}
