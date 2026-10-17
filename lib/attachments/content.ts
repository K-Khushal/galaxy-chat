import {
  type AttachmentKind,
  attachmentLimits,
} from "@/lib/attachments/contract";
import { AppError } from "@/lib/errors";
export type FileDescription = {
  name: string;
  mediaType: string;
  kind: AttachmentKind;
  bytes: number;
};
export function describeFile(
  name: string,
  mediaType: string,
  bytes: number,
): FileDescription {
  if (
    !name ||
    name.length > 160 ||
    Array.from(name).some(
      (char) =>
        char.charCodeAt(0) < 32 ||
        char.charCodeAt(0) === 127 ||
        char === "/" ||
        char === "\\",
    )
  )
    throw new AppError("invalid_filename", 400);
  if (
    !Number.isSafeInteger(bytes) ||
    bytes < 1 ||
    bytes > attachmentLimits.fileBytes
  )
    throw new AppError("attachment_size_limit", 413);
  const extension = name.split(".").at(-1)?.toLowerCase();
  const allowed: Record<string, [string, AttachmentKind]> = {
    txt: ["text/plain", "text"],
    md: ["text/markdown", "markdown"],
    markdown: ["text/markdown", "markdown"],
    pdf: ["application/pdf", "pdf"],
    png: ["image/png", "image"],
    jpg: ["image/jpeg", "image"],
    jpeg: ["image/jpeg", "image"],
    webp: ["image/webp", "image"],
  };
  const type = allowed[extension ?? ""];
  if (
    !type ||
    (mediaType !== type[0] &&
      !(type[1] === "markdown" && mediaType === "text/plain"))
  )
    throw new AppError("attachment_type_unsupported", 415);
  if (
    (type[1] === "text" || type[1] === "markdown") &&
    bytes > attachmentLimits.textBytes
  )
    throw new AppError("attachment_size_limit", 413);
  return { name, mediaType: type[0], kind: type[1], bytes };
}
export async function readBounded(
  stream: ReadableStream<Uint8Array> | null,
  max: number,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  if (!stream) throw new AppError("attachment_empty", 400);
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  const abort = () => {
    void reader.cancel().catch(() => {});
  };
  signal?.addEventListener("abort", abort, { once: true });
  try {
    signal?.throwIfAborted();
    while (true) {
      const { value, done } = await reader.read();
      signal?.throwIfAborted();
      if (done) break;
      length += value.byteLength;
      if (length > max) throw new AppError("attachment_size_limit", 413);
      chunks.push(value);
    }
    const output = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      output.set(chunk, offset);
      offset += chunk.length;
    }
    return output;
  } finally {
    signal?.removeEventListener("abort", abort);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
function dimensionCheck(width: number, height: number) {
  if (
    width < 1 ||
    height < 1 ||
    width > 4096 ||
    height > 4096 ||
    width * height > attachmentLimits.imagePixels
  )
    throw new AppError("attachment_image_limit", 413);
}
function imageDimensions(data: Uint8Array, type: string) {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (
    type === "image/png" &&
    data.length >= 33 &&
    data
      .slice(0, 8)
      .every((value, i) => value === [137, 80, 78, 71, 13, 10, 26, 10][i]) &&
    new TextDecoder().decode(data.slice(12, 16)) === "IHDR"
  ) {
    dimensionCheck(view.getUint32(16), view.getUint32(20));
    let offset = 8;
    let count = 0;
    while (offset + 12 <= data.length) {
      if (++count > 1024)
        throw new AppError("attachment_content_mismatch", 415);
      const size = view.getUint32(offset);
      if (size > data.length - offset - 12)
        throw new AppError("attachment_content_mismatch", 415);
      const chunk = new TextDecoder().decode(
        data.slice(offset + 4, offset + 8),
      );
      if (chunk === "acTL")
        throw new AppError("attachment_animated_image", 415);
      offset += size + 12;
      if (chunk === "IEND" && size === 0 && offset === data.length) return;
    }
    throw new AppError("attachment_content_mismatch", 415);
  }
  if (type === "image/jpeg" && data[0] === 255 && data[1] === 216) {
    let offset = 2;
    while (offset + 4 <= data.length) {
      if (data[offset] !== 255) break;
      const marker = data[offset + 1];
      offset += 2;
      if (marker === 0xda || marker === 0xd9) break;
      const size = view.getUint16(offset);
      if (size < 2 || offset + size > data.length) break;
      if ([0xc0, 0xc1, 0xc2].includes(marker) && size >= 7) {
        dimensionCheck(view.getUint16(offset + 5), view.getUint16(offset + 3));
        return;
      }
      offset += size;
    }
  }
  if (
    type === "image/webp" &&
    data.length >= 30 &&
    new TextDecoder().decode(data.slice(0, 4)) === "RIFF" &&
    new TextDecoder().decode(data.slice(8, 12)) === "WEBP"
  ) {
    const chunk = new TextDecoder().decode(data.slice(12, 16));
    if (chunk === "VP8X") {
      if (data[20] & 2) throw new AppError("attachment_animated_image", 415);
      dimensionCheck(
        1 + data[24] + (data[25] << 8) + (data[26] << 16),
        1 + data[27] + (data[28] << 8) + (data[29] << 16),
      );
      return;
    }
    if (
      chunk === "VP8 " &&
      data[23] === 0x9d &&
      data[24] === 1 &&
      data[25] === 0x2a
    ) {
      dimensionCheck(
        view.getUint16(26, true) & 0x3fff,
        view.getUint16(28, true) & 0x3fff,
      );
      return;
    }
    if (chunk === "VP8L" && data[20] === 0x2f) {
      const bits = view.getUint32(21, true);
      dimensionCheck((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1);
      return;
    }
  }
  throw new AppError("attachment_content_mismatch", 415);
}
export function validateContent(file: FileDescription, bytes: Uint8Array) {
  if (bytes.length !== file.bytes)
    throw new AppError("attachment_size_mismatch", 400);
  if (file.kind === "image") {
    imageDimensions(bytes, file.mediaType);
    return;
  }
  if (file.kind === "pdf") {
    if (!new TextDecoder().decode(bytes.slice(0, 8)).startsWith("%PDF-"))
      throw new AppError("attachment_content_mismatch", 415);
    return;
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new AppError("attachment_utf8_required", 415);
  }
  if (
    Array.from(text).some(
      (char) =>
        char.charCodeAt(0) < 32 && ![9, 10, 13].includes(char.charCodeAt(0)),
    ) ||
    /^\s*(<!doctype\s+html|<html|<svg|<script|%PDF-)/i.test(text)
  )
    throw new AppError("attachment_content_mismatch", 415);
}
