/**
 * What can be attached, and to which models. Pure and isomorphic: the
 * composer checks these before uploading and the server checks them again.
 */
import type { ModelCapabilities } from "@/lib/models";

export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_FILES_PER_MESSAGE = 5;
/** Characters of one text or code file (or one PDF's text) given to a model. */
export const INLINE_TEXT_LIMIT = 100_000;

export type AttachmentKind = "image" | "pdf" | "text";

/** What the browser needs to show and send an Attachment. */
export type AttachmentView = {
  id: string;
  filename: string;
  kind: AttachmentKind;
  contentType: string;
  size: number;
};

const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];

/** Extensions read as plain text. Browsers report no MIME type for most. */
const TEXT_EXTENSIONS = new Set(
  (
    "txt md markdown rst csv tsv json jsonl yaml yml toml ini cfg conf xml " +
    "html htm css scss less js mjs cjs jsx ts mts cts tsx py rb go rs java " +
    "kt kts swift c h cc cpp hpp cs php sh bash zsh fish ps1 sql graphql " +
    "proto lua r scala dart vue svelte tex diff patch log gradle tf"
  ).split(" "),
);

/** The content type stored for, and signed into the upload of, text files. */
export const TEXT_CONTENT_TYPE = "text/plain";

export type FileClass = { kind: AttachmentKind; contentType: string };

function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot < 0 ? "" : filename.slice(dot + 1).toLowerCase();
}

/**
 * The kind and canonical content type for a file, or null when it may not be
 * attached. The declared MIME type is a hint only: browsers report odd types
 * for code (.ts as video/mp2t), and the server verifies the bytes after
 * upload. Text files are always stored as text/plain.
 */
export function classifyFile(
  filename: string,
  declaredType: string,
): FileClass | null {
  const type = declaredType.split(";")[0]?.trim().toLowerCase() ?? "";
  if (IMAGE_TYPES.includes(type)) return { kind: "image", contentType: type };
  if (type === "application/pdf") {
    return { kind: "pdf", contentType: "application/pdf" };
  }
  if (type.startsWith("text/") || TEXT_EXTENSIONS.has(extensionOf(filename))) {
    return { kind: "text", contentType: TEXT_CONTENT_TYPE };
  }
  return null;
}

/** What `<input type="file" accept>` should list. */
export const ACCEPT_IMAGES = IMAGE_TYPES.join(",");
export const ACCEPT_FILES = [
  "application/pdf",
  "text/*",
  ...[...TEXT_EXTENSIONS].map((extension) => `.${extension}`),
].join(",");

export type Rejection =
  | { code: "too_many"; name: string }
  | { code: "too_large"; name: string }
  | { code: "empty"; name: string }
  | { code: "type"; name: string }
  | { code: "unsupported"; name: string; kind: AttachmentKind };

/** Capabilities of the model a Message is sent to; null for custom models. */
export type ModelSupport = {
  vision: boolean;
  pdf: boolean;
  /** Shown when a type is turned off: "Claude Haiku 5.5". */
  label: string;
};

export function modelSupport(
  capabilities: ModelCapabilities | null,
  label: string,
): ModelSupport {
  // A custom (BYOK) model's capabilities are unknown: send text only.
  return {
    vision: capabilities?.vision ?? false,
    pdf: capabilities?.pdf ?? false,
    label,
  };
}

/**
 * Whether a model can read a kind of file. PDFs always can: a model without
 * PDF support gets the extracted text. Text and code are plain text.
 */
export function supportsKind(support: ModelSupport, kind: AttachmentKind) {
  return kind !== "image" || support.vision;
}

export type Candidate = { name: string; type: string; size: number };

/**
 * Splits dropped, pasted or picked files into those to upload and those
 * refused, each with a reason. `existing` counts files already on the draft.
 */
export function selectFiles<T extends Candidate>(
  files: readonly T[],
  existing: number,
  support: ModelSupport,
): { accepted: { file: T; kind: AttachmentKind }[]; rejected: Rejection[] } {
  const accepted: { file: T; kind: AttachmentKind }[] = [];
  const rejected: Rejection[] = [];
  for (const file of files) {
    const name = file.name;
    const classified = classifyFile(file.name, file.type);
    if (!classified) rejected.push({ code: "type", name });
    else if (file.size <= 0) rejected.push({ code: "empty", name });
    else if (file.size > MAX_FILE_BYTES) {
      rejected.push({ code: "too_large", name });
    } else if (!supportsKind(support, classified.kind)) {
      rejected.push({ code: "unsupported", name, kind: classified.kind });
    } else if (existing + accepted.length >= MAX_FILES_PER_MESSAGE) {
      rejected.push({ code: "too_many", name });
    } else accepted.push({ file, kind: classified.kind });
  }
  return { accepted, rejected };
}

/** Plain-language copy for a refused file. */
export function rejectionCopy(
  rejection: Rejection,
  support: ModelSupport,
): string {
  switch (rejection.code) {
    case "too_many":
      return `You can attach up to ${MAX_FILES_PER_MESSAGE} files to a message. “${rejection.name}” was not added.`;
    case "too_large":
      return `“${rejection.name}” is larger than 10 MB.`;
    case "empty":
      return `“${rejection.name}” is empty.`;
    case "type":
      return `“${rejection.name}” can’t be attached. Use an image (PNG, JPEG, WebP or GIF), a PDF, or a text or code file.`;
    case "unsupported":
      return `${support.label} can’t read images. Choose another model to attach “${rejection.name}”.`;
  }
}

/** Why Send is off when a file already on the draft cannot go to the model. */
export function unreadableCopy(support: ModelSupport, name: string): string {
  return `${support.label} can’t read images. Remove “${name}” or choose another model to send it.`;
}

/** Copy for the disabled "Add photos" menu item. */
export function visionOffCopy(support: ModelSupport): string {
  return `${support.label} can’t read images.`;
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Where a stored file is served from; the Message part's `url`. */
export const attachmentUrl = (id: string) => `/api/attachments/${id}`;

const URL_PATTERN = /^\/api\/attachments\/([A-Za-z0-9_-]{1,64})$/;

/** The Attachment ID a file part points at, or null for any other URL. */
export function attachmentIdFromUrl(url: string): string | null {
  return URL_PATTERN.exec(url)?.[1] ?? null;
}

/** The image type the leading bytes prove, or null. */
export function sniffImage(bytes: Uint8Array): string | null {
  const at = (offset: number, ...expected: number[]) =>
    expected.every((value, index) => bytes[offset + index] === value);
  if (at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) {
    return "image/png";
  }
  if (at(0, 0xff, 0xd8, 0xff)) return "image/jpeg";
  if (at(0, 0x47, 0x49, 0x46, 0x38) && (at(4, 0x37) || at(4, 0x39))) {
    return "image/gif";
  }
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) {
    return "image/webp";
  }
  return null;
}

export function isPdfHeader(bytes: Uint8Array): boolean {
  return [0x25, 0x50, 0x44, 0x46, 0x2d].every(
    (value, index) => bytes[index] === value,
  );
}

/** Valid UTF-8 without NUL bytes. A cut-off last character is tolerated. */
export function looksLikeText(bytes: Uint8Array, truncated: boolean): boolean {
  if (bytes.includes(0)) return false;
  let end = bytes.length;
  if (truncated) {
    // Drop an incomplete multi-byte sequence at the cut.
    let back = 0;
    while (
      back < 3 &&
      end - back > 0 &&
      ((bytes[end - back - 1] ?? 0) & 0xc0) === 0x80
    ) {
      back++;
    }
    const lead = bytes[end - back - 1] ?? 0;
    const need = lead >= 0xf0 ? 4 : lead >= 0xe0 ? 3 : lead >= 0xc0 ? 2 : 1;
    if (need > back + 1) end -= back + 1;
  }
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, end));
    return true;
  } catch {
    return false;
  }
}
