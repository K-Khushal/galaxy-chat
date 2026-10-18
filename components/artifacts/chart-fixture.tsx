"use client";
import { useTheme } from "next-themes";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  type ChartType,
  parseChartSource,
  sampleChart,
} from "@/lib/artifacts/chart-spec";
import {
  type ArtifactDocument,
  artifactLimits,
} from "@/lib/artifacts/contract";
import {
  type ArtifactClient,
  ConversationArtifacts,
} from "./artifact-workbench";

export function ChartFixture() {
  const [type, setType] = useState<ChartType>("bar");
  const { resolvedTheme, setTheme } = useTheme();
  const [hostile, setHostile] = useState(false);
  const store = useMemo(() => new Map<string, ArtifactDocument[]>(), []);
  const spec = sampleChart(type);
  if (hostile) {
    spec.title = "Support <script>parent.compromised=true</script>";
    spec.rows[0].label =
      "A long team name that should wrap inside the data table without widening the page";
    spec.series[0].label =
      "<img src=https://chart-network.invalid/x onerror=alert(1)>";
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
        if (input.kind !== "chart" || !parseChartSource(source).success)
          throw new Error("invalid_artifact");
        const id = crypto.randomUUID(),
          now = new Date().toISOString();
        const document: ArtifactDocument = {
          id,
          chatId: "chart-fixture",
          messageId: "chart-response",
          kind: "chart",
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
      const history = store.get(input.id),
        document = history?.at(-1);
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
      if (!original || !parseChartSource(original.content).success)
        throw new Error("invalid_artifact");
      const version = document.version + 1,
        now = new Date().toISOString();
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
          <h1 className="text-2xl font-semibold">Chart workbench</h1>
          <p className="text-sm text-muted-foreground">
            Local in-memory fixture. Uses the real editor and renderer; no
            sign-in or model call. Chart downloads contain the saved revision.
          </p>
        </header>
        <div className="flex flex-wrap items-center gap-3">
          <label htmlFor="chart-example" className="text-sm font-medium">
            Chart example
          </label>
          <select
            id="chart-example"
            value={type}
            onChange={(event) => setType(event.target.value as ChartType)}
            className="min-h-11 rounded-md border bg-background px-3 text-base"
          >
            <option value="bar">Bar</option>
            <option value="line">Line</option>
            <option value="area">Area</option>
            <option value="scatter">Scatter</option>
          </select>
          <Button variant="outline" onClick={() => setHostile(!hostile)}>
            {hostile ? "Use ordinary labels" : "Use long and hostile labels"}
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
            Choose “Chart from JSON” in the create form. Edit the JSON, preview
            it, save, and restore an older revision. Remove a required field to
            check invalid save recovery.
          </p>
          <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words text-xs">
            {source}
          </pre>
          <ConversationArtifacts
            chatId="chart-fixture"
            messageId="chart-response"
            api={api}
            fixture
          />
        </section>
        <ConversationArtifacts chatId="chart-fixture" api={api} fixture />
      </div>
    </main>
  );
}
