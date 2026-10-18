"use client";

import { useTheme } from "next-themes";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  type ArtifactDocument,
  artifactLimits,
} from "@/lib/artifacts/contract";
import { parseTableSource, sampleTable } from "@/lib/artifacts/table-spec";
import {
  type ArtifactClient,
  ConversationArtifacts,
} from "./artifact-workbench";

export function TableFixture() {
  const { resolvedTheme, setTheme } = useTheme();
  const [hostile, setHostile] = useState(false);
  const store = useMemo(() => new Map<string, ArtifactDocument[]>(), []);
  const spec = sampleTable();
  if (hostile) {
    spec.title = "Unicode and formula-like text";
    spec.columns[0].label = "＝1+1";
    spec.rows[0].label =
      "A long row label that wraps without widening the phone viewport";
    spec.rows[0].values[0] = "  =SUM(A1:A2)";
    spec.rows[0].values[3] = "\t@cmd\nمرحبا 😀 <script>alert(1)</script>";
  }
  const source = JSON.stringify(spec, null, 2);
  const api: ArtifactClient = {
    list: async () =>
      [...store.values()].flatMap((history) => history.slice(-1)),
    read: async (id) => {
      const document = store.get(id)?.at(-1);
      if (!document) throw new Error("not_found");
      return document;
    },
    mutate: async (input) => {
      if (input.action === "create") {
        if (input.kind !== "table" || !parseTableSource(source).success)
          throw new Error("invalid_artifact");
        const id = crypto.randomUUID();
        const now = new Date().toISOString();
        const document: ArtifactDocument = {
          id,
          chatId: "table-fixture",
          messageId: "table-response",
          kind: "table",
          title: input.title,
          content: source,
          version: 1,
          updatedAt: now,
          revisions: [
            {
              version: 1,
              title: input.title,
              restoredFrom: null,
              createdAt: now,
            },
          ],
        };
        store.set(id, [document]);
        return { id };
      }
      const history = store.get(input.id);
      const document = history?.at(-1);
      if (!document || !history) throw new Error("not_found");
      if (input.action === "delete") {
        store.delete(input.id);
        return { id: input.id, deleted: true };
      }
      if (input.expectedVersion !== document.version)
        throw new Error("artifact_conflict");
      if (document.version >= artifactLimits.revisions)
        throw new Error("artifact_revision_limit");
      const original =
        input.action === "save"
          ? input
          : history.find((item) => item.version === input.version);
      if (!original || !parseTableSource(original.content).success)
        throw new Error("invalid_artifact");
      const version = document.version + 1;
      const now = new Date().toISOString();
      history.push({
        ...document,
        title: original.title,
        content: original.content,
        version,
        updatedAt: now,
        revisions: [
          {
            version,
            title: original.title,
            restoredFrom: input.action === "restore" ? input.version : null,
            createdAt: now,
          },
          ...document.revisions,
        ],
      });
      return { id: input.id };
    },
  };
  return (
    <main className="min-h-dvh bg-background px-5 py-8 text-foreground">
      <div className="mx-auto max-w-3xl space-y-6">
        <header className="space-y-2">
          <h1 className="text-2xl font-semibold">Typed table workbench</h1>
          <p className="text-sm text-muted-foreground">
            Local in-memory fixture using the real editor and table preview. No
            sign-in, model call, stored object, or client-side XLSX library.
          </p>
        </header>
        <div className="flex flex-wrap gap-3">
          <Button variant="outline" onClick={() => setHostile(!hostile)}>
            {hostile ? "Use ordinary values" : "Use hostile and long values"}
          </Button>
          <Button
            variant="outline"
            onClick={() =>
              setTheme(resolvedTheme === "dark" ? "light" : "dark")
            }
          >
            Switch theme
          </Button>
        </div>
        <section className="space-y-3 rounded-lg border p-4">
          <h2 className="font-medium">Saved assistant response</h2>
          <p className="text-sm text-muted-foreground">
            Choose “Typed table from JSON.” Edit, preview, save, and restore a
            revision. Remove a required field to check invalid save recovery.
            Production downloads are intentionally disabled in this local-only
            fixture.
          </p>
          <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words text-xs">
            {source}
          </pre>
          <ConversationArtifacts
            chatId="table-fixture"
            messageId="table-response"
            api={api}
            fixture
          />
        </section>
        <ConversationArtifacts chatId="table-fixture" api={api} fixture />
      </div>
    </main>
  );
}
