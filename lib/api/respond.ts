import "server-only";
import { UI_MESSAGE_STREAM_HEADERS } from "ai";
import type { z } from "zod";
import { EnvError } from "@/lib/env";
import { AppError, logErrorId } from "@/lib/errors";
import { log } from "@/lib/logger";

export function json(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

/**
 * AppErrors become `{ error: id }`. A missing or invalid environment variable
 * is a 503 and its message (variable names only, never values) is logged.
 * Anything else is logged by ID only.
 */
export function errorResponse(error: unknown): Response {
  if (error instanceof AppError) {
    return json({ error: error.id }, error.status);
  }
  if (error instanceof EnvError) {
    log("error", error.message);
    logErrorId("server_misconfigured");
    return json({ error: "server_misconfigured" }, 503);
  }
  logErrorId("internal_error");
  return json({ error: "internal_error" }, 500);
}

export async function handle(run: () => Promise<Response>): Promise<Response> {
  try {
    return await run();
  } catch (error) {
    return errorResponse(error);
  }
}

/** Default cap on a JSON request body; routes with large bodies pass their own. */
export const MAX_JSON_BYTES = 16 * 1024;

const tooLarge = () => new AppError("payload_too_large", 413);

/**
 * Reads at most `maxBytes` of the body. A larger declared `content-length` is
 * rejected before reading, and the stream is cut off as soon as it passes the
 * cap, so an oversized body is never buffered or parsed.
 */
async function readBody(request: Request, maxBytes: number): Promise<string> {
  const declared = request.headers.get("content-length");
  if (declared !== null && !(Number(declared) <= maxBytes)) throw tooLarge();
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => {});
      throw tooLarge();
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new AppError("invalid_request", 400);
  }
}

export async function readJson<T extends z.ZodType>(
  request: Request,
  schema: T,
  maxBytes = MAX_JSON_BYTES,
): Promise<z.output<T>> {
  const text = await readBody(request, maxBytes);
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new AppError("invalid_request", 400);
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new AppError("invalid_request", 400);
  return parsed.data;
}

/** An AI SDK UI message stream (SSE), as `useChat` expects. */
export function sseResponse(stream: ReadableStream<string>): Response {
  return new Response(stream.pipeThrough(new TextEncoderStream()), {
    headers: UI_MESSAGE_STREAM_HEADERS,
  });
}

/** Reject browser mutations from any origin other than the configured app. */
export function requireSameOrigin(
  request: Request,
  origins: string | readonly string[],
) {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return;
  const allowed =
    typeof origins === "string" ? [new URL(origins).origin] : origins;
  const origin = request.headers.get("origin");
  if (origin !== null) {
    if (!allowed.includes(origin)) throw new AppError("cross_origin", 403);
  } else if (
    !allowed.includes(new URL(request.url).origin) ||
    request.headers.get("sec-fetch-site") !== "same-origin"
  )
    throw new AppError("cross_origin", 403);
}
