import { createHash } from "node:crypto";
import { inflateSync } from "node:zlib";
import { decode, encode } from "fast-png";
import { AppError } from "@/lib/errors";

export const IMAGE_BYTES = 4 * 1024 * 1024;
const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
export function pngCrc(bytes: Uint8Array) {
  let c = 0xffffffff;
  for (const byte of bytes) c = crcTable[(c ^ byte) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function invalid(): never {
  throw new AppError("image_invalid_png", 415);
}
/** Validate BEFORE any decoder allocation or unbounded inflation. Ancillary
 * chunks are CRC checked then dropped, so compressed metadata never decodes. */
export function inspectPng(bytes: Uint8Array) {
  if (
    bytes.length > IMAGE_BYTES ||
    bytes.length < 57 ||
    !signature.every((v, i) => bytes[i] === v)
  )
    invalid();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const safe: Uint8Array[] = [signature];
  const compressed: Uint8Array[] = [];
  let offset = 8,
    count = 0,
    channels = 0,
    ended = false,
    dataEnded = false;
  while (offset < bytes.length) {
    if (++count > 1024 || offset + 12 > bytes.length) invalid();
    const size = view.getUint32(offset);
    if (size > bytes.length - offset - 12) invalid();
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    const end = offset + size + 12;
    if (
      !/^[A-Za-z]{4}$/.test(type) ||
      pngCrc(bytes.subarray(offset + 4, end - 4)) !== view.getUint32(end - 4)
    )
      invalid();
    if (count === 1) {
      if (
        type !== "IHDR" ||
        size !== 13 ||
        view.getUint32(offset + 8) !== 1024 ||
        view.getUint32(offset + 12) !== 1024 ||
        bytes[offset + 16] !== 8 ||
        ![2, 6].includes(bytes[offset + 17]) ||
        bytes[offset + 18] !== 0 ||
        bytes[offset + 19] !== 0 ||
        bytes[offset + 20] !== 0
      )
        invalid();
      channels = bytes[offset + 17] === 6 ? 4 : 3;
      safe.push(bytes.subarray(offset, end));
    } else if (type === "IDAT") {
      if (dataEnded || size === 0) invalid();
      compressed.push(bytes.subarray(offset + 8, end - 4));
      safe.push(bytes.subarray(offset, end));
    } else if (type === "IEND") {
      if (size !== 0 || !compressed.length || end !== bytes.length) invalid();
      safe.push(bytes.subarray(offset, end));
      ended = true;
    } else {
      if (
        ["acTL", "fcTL", "fdAT"].includes(type) ||
        type[0] === type[0].toUpperCase()
      )
        invalid();
      if (compressed.length) dataEnded = true;
    }
    offset = end;
  }
  if (!ended) invalid();
  const idat = Buffer.concat(compressed);
  const expected = 1024 * (1024 * channels + 1);
  try {
    const raw = inflateSync(idat, { maxOutputLength: expected + 1 });
    if (raw.length !== expected) invalid();
    for (let y = 0; y < 1024; y++)
      if (raw[y * (1024 * channels + 1)] > 4) invalid();
  } catch {
    invalid();
  }
  return { bytes: new Uint8Array(Buffer.concat(safe)), channels };
}
export function canonicalPng(bytes: Uint8Array, mediaType: string) {
  if (mediaType !== "image/png") invalid();
  const checked = inspectPng(bytes);
  try {
    const decoded = decode(checked.bytes, { checkCrc: true });
    if (
      decoded.depth !== 8 ||
      decoded.data.length !== 1024 * 1024 * checked.channels
    )
      invalid();
    const output = encode({
      width: 1024,
      height: 1024,
      channels: checked.channels,
      depth: 8,
      data: decoded.data,
    });
    inspectPng(output);
    return {
      bytes: output,
      sha256: createHash("sha256").update(output).digest("hex"),
      width: 1024,
      height: 1024,
      mediaType: "image/png" as const,
    };
  } catch {
    return invalid();
  }
}
