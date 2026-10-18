import { z } from "zod";

export const artifactLimits = {
  contentBytes: 128 * 1024,
  artifacts: 50,
  revisions: 40,
  ownerBytes: 8 * 1024 * 1024,
  requestBytes: 800 * 1024,
} as const;
export const artifactKind = z.enum(["markdown", "html", "chart", "table"]);
export const artifactKindLabel = {
  markdown: "Markdown",
  html: "HTML",
  chart: "Chart",
  table: "Table",
} as const;
export const artifactIdentifier = z
  .string()
  .min(1)
  .max(200)
  .refine((value) => !value.includes("\0"));
export const artifactTitle = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .refine((value) => !value.includes("\0"));
export const artifactContent = z
  .string()
  .refine(
    (value) =>
      new TextEncoder().encode(value).byteLength <=
        artifactLimits.contentBytes && !value.includes("\0"),
    "Content must be at most 128 KiB and contain no null characters.",
  );
export const artifactMutation = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("create"),
      chatId: artifactIdentifier,
      messageId: artifactIdentifier,
      kind: artifactKind,
      title: artifactTitle,
    })
    .strict(),
  z
    .object({
      action: z.literal("save"),
      id: artifactIdentifier,
      expectedVersion: z.number().int().min(1).max(40),
      title: artifactTitle,
      content: artifactContent,
    })
    .strict(),
  z
    .object({
      action: z.literal("restore"),
      id: artifactIdentifier,
      expectedVersion: z.number().int().min(1).max(40),
      version: z.number().int().min(1).max(40),
    })
    .strict(),
  z.object({ action: z.literal("delete"), id: artifactIdentifier }).strict(),
]);
export type ArtifactMutation = z.infer<typeof artifactMutation>;
export type ArtifactKind = z.infer<typeof artifactKind>;
export type ArtifactSummary = {
  id: string;
  chatId: string;
  messageId: string;
  kind: ArtifactKind;
  version: number;
  title: string;
  updatedAt: string;
};
export type ArtifactDocument = ArtifactSummary & {
  content: string;
  revisions: Array<{
    version: number;
    title: string;
    restoredFrom: number | null;
    createdAt: string;
  }>;
};
export function artifactFilename(title: string, kind: ArtifactKind) {
  const stem =
    title
      .normalize("NFKD")
      .replace(/[^a-zA-Z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 72) || "artifact";
  // Source is deliberately delivered as text, never as an executable HTML page.
  return `${stem}.${kind === "html" ? "html.txt" : kind === "chart" ? "chart.json" : kind === "table" ? "table.json" : "md"}`;
}
export function tableExportFilename(
  title: string,
  version: number,
  format: "csv" | "xlsx",
) {
  return artifactFilename(title, "table").replace(
    /\.table\.json$/,
    `-v${version}.${format}`,
  );
}
export function artifactSource(parts: unknown, kind: ArtifactKind) {
  if (!Array.isArray(parts)) return "";
  const text = parts
    .flatMap((part) =>
      part &&
      typeof part === "object" &&
      part.type === "text" &&
      typeof part.text === "string"
        ? [part.text]
        : [],
    )
    .join("\n\n");
  const fenced =
    /^\s*```(html|markdown|md|chart|table|json)\s*\n([\s\S]*?)\n```\s*$/i.exec(
      text,
    );
  return fenced &&
    (kind === "chart"
      ? ["chart", "json"].includes(fenced[1].toLowerCase())
      : kind === "table"
        ? ["table", "json"].includes(fenced[1].toLowerCase())
        : kind === "html"
          ? fenced[1].toLowerCase() === "html"
          : ["markdown", "md"].includes(fenced[1].toLowerCase()))
    ? fenced[2]
    : text;
}
export function artifactError(id: string) {
  const messages: Record<string, string> = {
    artifact_conflict:
      "A newer revision exists. Close and reopen the artifact before saving.",
    artifact_limit:
      "The artifact limit has been reached. Download and delete an older artifact to make space.",
    artifact_revision_limit:
      "This artifact has 40 revisions. Download the source or create another artifact.",
    artifact_storage_limit:
      "Artifact storage is full. Download and delete an older artifact to make space.",
    artifact_export_limit: "The generated file exceeds the 8 MiB export limit.",
    invalid_artifact:
      "Check the title and source. Content must fit within 128 KiB.",
    not_found:
      "This saved message or artifact is unavailable. Temporary conversations cannot save artifacts.",
  };
  return (
    messages[id] ?? "The artifact could not be saved or loaded. Try again."
  );
}
