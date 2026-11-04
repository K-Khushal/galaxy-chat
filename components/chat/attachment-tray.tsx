"use client";
import { CircleAlert, FileText, X } from "lucide-react";
import { formatSize } from "@/lib/attachments/rules";
import { cn } from "@/lib/utils";
import type { DraftAttachment } from "./use-attachments";

const RING_RADIUS = 8;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;

function ProgressRing({ item }: { item: DraftAttachment }) {
  const percent = Math.round(item.progress * 100);
  return (
    <svg
      role="progressbar"
      aria-label={`Uploading ${item.name}`}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      viewBox="0 0 20 20"
      className="size-5 -rotate-90 fill-none stroke-2"
    >
      <circle cx="10" cy="10" r={RING_RADIUS} className="stroke-border" />
      <circle
        cx="10"
        cy="10"
        r={RING_RADIUS}
        strokeLinecap="round"
        strokeDasharray={`${item.progress * RING_LENGTH} ${RING_LENGTH}`}
        className="stroke-foreground transition-[stroke-dasharray] duration-160 ease-out"
      />
    </svg>
  );
}

function Remove({
  item,
  onRemove,
}: {
  item: DraftAttachment;
  onRemove: (key: string) => void;
}) {
  return (
    <button
      type="button"
      aria-label={`Remove ${item.name}`}
      onClick={() => onRemove(item.key)}
      className="absolute -top-1.5 -right-1.5 flex size-5 items-center justify-center rounded-full bg-foreground text-background outline-none transition-[opacity,scale] duration-80 ease-out after:absolute after:-inset-2 focus-visible:ring-3 focus-visible:ring-ring/50 motion-safe:active:scale-[0.96] pointer-fine:opacity-0 pointer-fine:group-focus-within/tile:opacity-100 pointer-fine:group-hover/tile:opacity-100"
    >
      <X aria-hidden="true" className="size-3" />
    </button>
  );
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
    <ul
      aria-label="Attached files"
      className="flex gap-2 overflow-x-auto px-1.5 pt-1.5 [scrollbar-width:none]"
    >
      {items.map((item) => {
        const failed = item.status === "error";
        const image = item.kind === "image" && item.preview;
        return (
          <li
            key={item.key}
            className={cn(
              "group/tile relative shrink-0 rounded-xl",
              image
                ? "size-14"
                : "flex h-14 max-w-56 items-center gap-2 border bg-card pr-3 pl-2",
              failed && "border border-destructive",
            )}
          >
            {image ? (
              // biome-ignore lint/performance/noImgElement: a local blob preview
              <img
                src={item.preview as string}
                alt=""
                className="size-full rounded-[inherit] object-cover outline outline-1 -outline-offset-1 outline-image-outline"
              />
            ) : (
              <>
                <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                  {item.kind === "pdf" ? (
                    <span className="text-xs font-medium">PDF</span>
                  ) : (
                    <FileText aria-hidden="true" className="size-5" />
                  )}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-caption font-medium">
                    {item.name}
                  </span>
                  <span className="block text-xs text-muted-foreground tabular-nums">
                    {formatSize(item.size)}
                  </span>
                </span>
              </>
            )}
            {item.status === "uploading" && (
              <span
                className={cn(
                  "absolute inset-0 flex items-center rounded-[inherit] bg-background/60",
                  // On a chip the ring sits over its icon tile, clear of the name.
                  image ? "justify-center" : "pl-[1.125rem]",
                )}
              >
                <ProgressRing item={item} />
              </span>
            )}
            {failed && (
              <CircleAlert
                aria-hidden="true"
                className="absolute -bottom-1 -left-1 size-5 rounded-full bg-background text-destructive"
              />
            )}
            <Remove item={item} onRemove={onRemove} />
          </li>
        );
      })}
    </ul>
  );
}
