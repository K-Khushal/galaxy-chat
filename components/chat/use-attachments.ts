"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  type AttachmentKind,
  type ModelSupport,
  rejectionCopy,
  selectFiles,
} from "@/lib/attachments/rules";
import {
  removeAttachment,
  type UploadedAttachment,
  type Uploader,
  uploadAttachment,
} from "./attachment-upload";

export type DraftAttachment = {
  key: string;
  name: string;
  kind: AttachmentKind;
  size: number;
  /** Uploading, verified and ready to send, or failed. */
  status: "uploading" | "ready" | "error";
  /** 0 to 1 while uploading. */
  progress: number;
  /** An object URL of the file, or its saved URL, for image thumbnails. */
  preview: string | null;
  /** Set once uploaded and verified. */
  uploaded: UploadedAttachment | null;
  error: string | null;
};

const uploadErrors: Record<string, string> = {
  rate_limited: "Too many uploads. Wait a few minutes and try again.",
  attachment_limit:
    "Too many files are waiting to be sent. Send or remove some first.",
  attachment_invalid:
    "This file doesn’t look like the type it says it is, so it wasn’t attached.",
  attachment_too_large: "This file is larger than 10 MB.",
  attachment_type_unsupported: "This type of file can’t be attached.",
  server_misconfigured: "Uploads are unavailable right now.",
};

let counter = 0;

function release(item: DraftAttachment) {
  if (item.preview?.startsWith("blob:")) URL.revokeObjectURL(item.preview);
}

/** Restores files already uploaded, e.g. carried over from a new Chat. */
export function savedAttachment(saved: UploadedAttachment): DraftAttachment {
  return {
    key: `saved-${saved.id}`,
    name: saved.filename,
    kind: saved.kind,
    size: saved.size,
    status: "ready",
    progress: 1,
    preview: saved.kind === "image" ? `/api/attachments/${saved.id}` : null,
    uploaded: saved,
    error: null,
  };
}

/** Files on a draft Message: picking, validating, uploading and removing. */
export function useAttachments({
  support,
  upload = uploadAttachment,
  initial = [],
}: {
  support: ModelSupport;
  upload?: Uploader;
  initial?: UploadedAttachment[];
}) {
  const [items, setItems] = useState<DraftAttachment[]>(() =>
    initial.map(savedAttachment),
  );
  const [notice, setNotice] = useState("");
  const controllers = useRef(new Map<string, AbortController>());
  const itemsRef = useRef(items);
  itemsRef.current = items;

  const patch = useCallback(
    (key: string, change: Partial<DraftAttachment>) =>
      setItems((current) =>
        current.map((item) =>
          item.key === key ? { ...item, ...change } : item,
        ),
      ),
    [],
  );

  const add = useCallback(
    (files: File[]) => {
      if (files.length === 0) return;
      const { accepted, rejected } = selectFiles(
        files,
        itemsRef.current.length,
        support,
      );
      setNotice(
        rejected.map((entry) => rejectionCopy(entry, support)).join(" "),
      );
      const added = accepted.map(({ file, kind }): DraftAttachment => {
        const key = `new-${++counter}`;
        return {
          key,
          name: file.name,
          kind,
          size: file.size,
          status: "uploading",
          progress: 0,
          preview: kind === "image" ? URL.createObjectURL(file) : null,
          uploaded: null,
          error: null,
        };
      });
      if (added.length === 0) return;
      itemsRef.current = [...itemsRef.current, ...added];
      setItems(itemsRef.current);
      accepted.forEach(({ file }, index) => {
        const key = added[index]?.key as string;
        const controller = new AbortController();
        controllers.current.set(key, controller);
        upload(file, {
          signal: controller.signal,
          onProgress: (progress) => patch(key, { progress }),
        })
          .then((saved) =>
            patch(key, { status: "ready", progress: 1, uploaded: saved }),
          )
          .catch((error: Error) => {
            if (controller.signal.aborted) return;
            patch(key, {
              status: "error",
              error:
                uploadErrors[error.message] ??
                "This file couldn’t be uploaded. Remove it and try again.",
            });
          })
          .finally(() => controllers.current.delete(key));
      });
    },
    [support, upload, patch],
  );

  const remove = useCallback((key: string) => {
    const item = itemsRef.current.find((entry) => entry.key === key);
    if (!item) return;
    controllers.current.get(key)?.abort();
    release(item);
    if (item.uploaded) void removeAttachment(item.uploaded.id);
    itemsRef.current = itemsRef.current.filter((entry) => entry.key !== key);
    setItems(itemsRef.current);
    setNotice("");
  }, []);

  /** After a send: the files now belong to the Message. */
  const clear = useCallback(() => {
    for (const item of itemsRef.current) release(item);
    itemsRef.current = [];
    setItems([]);
    setNotice("");
  }, []);

  useEffect(
    () => () => {
      for (const controller of controllers.current.values()) controller.abort();
    },
    [],
  );

  const ready = items.flatMap((item) =>
    item.status === "ready" && item.uploaded ? [item.uploaded] : [],
  );
  return {
    items,
    notice,
    add,
    remove,
    clear,
    ready,
    uploading: items.some((item) => item.status === "uploading"),
    failed: items.some((item) => item.status === "error"),
  };
}
