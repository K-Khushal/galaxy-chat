"use client";
import { FileText } from "lucide-react";
import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { attachmentIdFromUrl } from "@/lib/attachments/rules";

type FilePart = {
  type: string;
  url?: string;
  filename?: string;
  mediaType?: string;
};

/** The file parts of a Message that point at stored Attachments. */
export function attachmentParts(parts: readonly FilePart[]) {
  return parts.flatMap((part) =>
    part.type === "file" && part.url && attachmentIdFromUrl(part.url)
      ? [
          {
            url: part.url,
            name: part.filename ?? "file",
            image: part.mediaType?.startsWith("image/") ?? false,
          },
        ]
      : [],
  );
}

/**
 * Files on a User Message. Images are thumbnails that open larger; PDFs and
 * text files are chips that open in a new tab (text downloads).
 */
export function MessageAttachments({ parts }: { parts: readonly FilePart[] }) {
  const [open, setOpen] = useState<{ url: string; name: string } | null>(null);
  const files = attachmentParts(parts);
  if (files.length === 0) return null;
  return (
    <>
      <ul
        aria-label="Attached files"
        className="mb-1.5 flex max-w-[85%] flex-wrap justify-end gap-2"
      >
        {files.map((file) => (
          <li key={file.url}>
            {file.image ? (
              <button
                type="button"
                aria-label={`Open ${file.name}`}
                onClick={() => setOpen(file)}
                className="block overflow-hidden rounded-xl border outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {/* biome-ignore lint/performance/noImgElement: served through a signed redirect */}
                <img
                  src={file.url}
                  alt={file.name}
                  loading="lazy"
                  className="size-24 object-cover"
                />
              </button>
            ) : (
              <a
                href={file.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex max-w-60 items-center gap-2 rounded-xl border bg-muted/40 px-3 py-2 text-sm outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
              >
                <FileText className="size-4 shrink-0 text-muted-foreground" />
                <span className="truncate">{file.name}</span>
              </a>
            )}
          </li>
        ))}
      </ul>
      {open && (
        <Dialog open onOpenChange={(next) => !next && setOpen(null)}>
          <DialogContent className="sm:max-w-3xl">
            <DialogTitle className="truncate pr-8">{open.name}</DialogTitle>
            <DialogDescription className="sr-only">
              Larger view of the attached image.
            </DialogDescription>
            {/* biome-ignore lint/performance/noImgElement: served through a signed redirect */}
            <img
              src={open.url}
              alt={open.name}
              className="max-h-[75dvh] w-full rounded-lg object-contain"
            />
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
