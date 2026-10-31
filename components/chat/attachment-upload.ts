import type { AttachmentView } from "@/lib/attachments/rules";

/** What the browser keeps of an Attachment once it is uploaded and verified. */
export type UploadedAttachment = Pick<
  AttachmentView,
  "id" | "filename" | "kind" | "contentType" | "size"
>;

export type Uploader = (
  file: File,
  options: { onProgress: (fraction: number) => void; signal: AbortSignal },
) => Promise<UploadedAttachment>;

async function failure(response: Response): Promise<Error> {
  const data = await response.json().catch(() => ({}));
  return new Error(data.error ?? "upload_failed");
}

/** PUTs to the presigned URL with progress; fetch cannot report upload progress. */
function put(
  url: string,
  file: File,
  headers: Record<string, string>,
  onProgress: (fraction: number) => void,
  signal: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("PUT", url);
    for (const [name, value] of Object.entries(headers)) {
      request.setRequestHeader(name, value);
    }
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total);
    };
    request.onload = () =>
      request.status >= 200 && request.status < 300
        ? resolve()
        : reject(new Error("upload_failed"));
    request.onerror = () => reject(new Error("upload_failed"));
    request.onabort = () => reject(new DOMException("aborted", "AbortError"));
    signal.addEventListener("abort", () => request.abort(), { once: true });
    request.send(file);
  });
}

/** Presigns, uploads straight to R2, then has the server verify the file. */
export const uploadAttachment: Uploader = async (
  file,
  { onProgress, signal },
) => {
  const presign = await fetch("/api/attachments", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      filename: file.name,
      contentType: file.type,
      size: file.size,
    }),
    signal,
  });
  if (!presign.ok) throw await failure(presign);
  const { attachment, upload } = (await presign.json()) as {
    attachment: UploadedAttachment;
    upload: { url: string; headers: Record<string, string> };
  };
  try {
    await put(upload.url, file, upload.headers, onProgress, signal);
    const confirm = await fetch(`/api/attachments/${attachment.id}/confirm`, {
      method: "POST",
      signal,
    });
    if (!confirm.ok) throw await failure(confirm);
    return ((await confirm.json()) as { attachment: UploadedAttachment })
      .attachment;
  } catch (error) {
    // Do not leave a half-made file behind.
    void removeAttachment(attachment.id);
    throw error;
  }
};

/** Deletes a file that was attached to a draft and never sent. */
export function removeAttachment(id: string): Promise<unknown> {
  return fetch(`/api/attachments/${id}`, { method: "DELETE" }).catch(() => {});
}
