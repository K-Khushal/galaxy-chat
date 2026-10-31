"use client";
import { FileText, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatSize } from "@/lib/attachments/rules";
import type { DraftAttachment } from "./use-attachments";

function Progress({ item }: { item: DraftAttachment }) {
  const percent = Math.round(item.progress * 100);
  return (
    <div
      role="progressbar"
      aria-label={`Uploading ${item.name}`}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      className="h-1 w-full overflow-hidden rounded-full bg-muted"
    >
      <div
        className="h-full bg-primary motion-safe:transition-[width]"
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}

function Status({ item }: { item: DraftAttachment }) {
  if (item.status === "error") {
    return <span className="text-destructive">{item.error}</span>;
  }
  if (item.status === "uploading") return <Progress item={item} />;
  return null;
}

/** Files on the draft Message: thumbnails for images, chips for the rest. */
export function AttachmentTray({
  items,
  onRemove,
}: {
  items: DraftAttachment[];
  onRemove: (key: string) => void;
}) {
  if (items.length === 0) return null;
  return (
    <ul aria-label="Attached files" className="flex flex-wrap gap-2 px-2 pt-1">
      {items.map((item) => (
        <li
          key={item.key}
          className="relative flex max-w-60 min-w-0 flex-col justify-center gap-1 rounded-xl border bg-muted/40 p-1.5 text-xs"
        >
          <div className="flex min-w-0 items-center gap-2 pr-6">
            {item.preview ? (
              // biome-ignore lint/performance/noImgElement: a local blob preview
              <img
                src={item.preview}
                alt=""
                className="size-10 shrink-0 rounded-lg object-cover"
              />
            ) : (
              <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                <FileText className="size-5" />
              </span>
            )}
            <span className="min-w-0">
              <span className="block truncate font-medium">{item.name}</span>
              <span className="block text-muted-foreground">
                {formatSize(item.size)}
              </span>
            </span>
          </div>
          <Status item={item} />
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={`Remove ${item.name}`}
            className="absolute top-1 right-1 rounded-full"
            onClick={() => onRemove(item.key)}
          >
            <X />
          </Button>
        </li>
      ))}
    </ul>
  );
}
