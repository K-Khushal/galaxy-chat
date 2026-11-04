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
                className="block rounded-xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                {/* biome-ignore lint/performance/noImgElement: served through a signed redirect */}
                <img
                  src={file.url}
                  alt={file.name}
                  loading="lazy"
                  decoding="async"
                  className="size-28 rounded-xl object-cover outline outline-1 -outline-offset-1 outline-image-outline"
                />
              </button>
            ) : (
              <a
                href={file.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex h-10 max-w-60 items-center gap-2 rounded-xl border bg-card px-3 text-sm outline-none transition-colors duration-80 hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50"
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
          <DialogContent className="p-2 sm:max-w-3xl">
            <DialogTitle className="sr-only">{open.name}</DialogTitle>
            <DialogDescription className="sr-only">
              Larger view of the attached image.
            </DialogDescription>
            {/* biome-ignore lint/performance/noImgElement: served through a signed redirect */}
            <img
              src={open.url}
              alt={open.name}
              className="max-h-[80dvh] w-full rounded-xl object-contain"
            />
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
