import "server-only";
import { createHash } from "node:crypto";
import type { ObjectStorage } from "@/lib/attachments/storage";

export { e2eLanguageModel } from "./e2e-model";
export const testByokKey = async (key: string) =>
  key === "e2e-byok-key-00000000000000000000000000000000";

const objects = new Map<
  string,
  { bytes: Uint8Array; contentType: string; etag: string }
>();
const grants = new Map<
  string,
  {
    key: string;
    method: string;
    expires: number;
    contentType: string;
    size?: number;
    disposition?: string;
  }
>();
function grant(
  key: string,
  method: string,
  options: {
    contentType: string;
    expiresIn: number;
    contentLength?: number;
    disposition?: string;
  },
) {
  const token = crypto.randomUUID();
  grants.set(token, {
    key,
    method,
    expires: Date.now() + options.expiresIn * 1000,
    contentType: options.contentType,
    size: options.contentLength,
    disposition: options.disposition,
  });
  return `http://127.0.0.1:3008/api/test-e2e/storage?token=${token}`;
}
export const storage: ObjectStorage = {
  presignPut: async (key, options) => grant(key, "PUT", options),
  presignGet: async (key, options) => grant(key, "GET", options),
  head: async (key) => {
    const o = objects.get(key);
    return o
      ? { size: o.bytes.length, contentType: o.contentType, etag: o.etag }
      : null;
  },
  read: async (key, range, ifMatch) => {
    const o = objects.get(key);
    if (!o || (ifMatch && o.etag !== ifMatch))
      throw new Error("Object unavailable or changed");
    return o.bytes.slice(range.start, range.end + 1);
  },
  remove: async (keys) => {
    for (const key of keys) objects.delete(key);
  },
};
export async function storageRequest(request: Request) {
  const g = grants.get(new URL(request.url).searchParams.get("token") ?? "");
  if (
    !g ||
    g.expires < Date.now() ||
    (request.method !== g.method &&
      !(request.method === "HEAD" && g.method === "GET"))
  )
    return new Response(null, { status: 403 });
  if (request.method === "PUT") {
    if (request.headers.get("if-none-match") !== "*")
      return new Response(null, { status: 400 });
    if (objects.has(g.key)) return new Response(null, { status: 412 });
    const bytes = new Uint8Array(await request.arrayBuffer());
    if (
      bytes.length !== g.size ||
      request.headers.get("content-type") !== g.contentType
    )
      return new Response(null, { status: 400 });
    if (objects.has(g.key)) return new Response(null, { status: 412 });
    objects.set(g.key, {
      bytes,
      contentType: g.contentType,
      etag: `"${createHash("sha256").update(bytes).digest("hex")}"`,
    });
    return new Response(null, { status: 200 });
  }
  const o = objects.get(g.key);
  if (!o) return new Response(null, { status: 404 });
  const headers = new Headers({
    "Content-Type": o.contentType,
    ETag: o.etag,
    "Accept-Ranges": "bytes",
    "Content-Disposition": g.disposition ?? "inline",
  });
  if (
    request.headers.has("if-match") &&
    request.headers.get("if-match") !== o.etag
  )
    return new Response(null, { status: 412 });
  const range = request.headers.get("range");
  const match = range?.match(/^bytes=(\d+)-(\d*)$/);
  const start = match ? Number(match[1]) : 0;
  const end = match?.[2]
    ? Math.min(Number(match[2]), o.bytes.length - 1)
    : o.bytes.length - 1;
  if ((range && !match) || start > end)
    return new Response(null, { status: 416 });
  const bytes = o.bytes.slice(start, end + 1);
  headers.set("Content-Length", String(bytes.length));
  if (range)
    headers.set("Content-Range", `bytes ${start}-${end}/${o.bytes.length}`);
  return new Response(request.method === "HEAD" ? null : bytes, {
    status: range ? 206 : 200,
    headers,
  });
}
