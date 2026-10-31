import "server-only";
import { UI_MESSAGE_STREAM_HEADERS } from "ai";
import type { z } from "zod";
import { EnvError } from "@/lib/env";
import { AppError, logErrorId } from "@/lib/errors";

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
    process.stderr.write(
      `${JSON.stringify({ level: "error", id: "env_invalid", message: error.message })}\n`,
    );
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

export async function readJson<T extends z.ZodType>(
  request: Request,
  schema: T,
): Promise<z.output<T>> {
  let body: unknown;
  try {
    body = await request.json();
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
