import { z } from "zod";
import { requireChatAccess } from "@/lib/auth/access";
import { boundedJson } from "@/lib/credits/http";
import { requireDb } from "@/lib/db/client";
import { AppError } from "@/lib/errors";
import { errorResponse } from "@/lib/http/error-response";
import { assertSameOrigin } from "@/lib/http/origin";
import type { JobView } from "@/lib/jobs/contract";
import { JobStore } from "@/lib/jobs/store";

const privateHeaders = {
  "cache-control": "private, no-store",
  "x-content-type-options": "nosniff",
} as const;

const cancelRequest = z
  .object({ action: z.literal("cancel"), id: z.uuid() })
  .strict();

function serialize(job: JobView) {
  // The driver can deliver timestamps as raw strings; the JSON contract is ISO.
  const expires = job.approvalExpiresAt;
  const parsed = expires ? new Date(expires) : null;
  return {
    ...job,
    approvalExpiresAt:
      parsed && !Number.isNaN(parsed.getTime())
        ? parsed.toISOString()
        : expires,
  };
}

function store() {
  return new JobStore(requireDb());
}

function privateError(error: unknown) {
  const response = errorResponse(error, "jobs_request_failed");
  response.headers.set("cache-control", "private, no-store");
  response.headers.set("x-content-type-options", "nosniff");
  return response;
}

export async function GET(request: Request) {
  try {
    const access = await requireChatAccess(request.headers);
    const id = new URL(request.url).searchParams.get("id");
    if (!id)
      return Response.json(
        { jobs: (await store().list(access.userId)).map(serialize) },
        { headers: privateHeaders },
      );
    // Malformed or foreign identifiers are indistinguishable from absent ones.
    if (!z.uuid().safeParse(id).success) throw new AppError("not_found", 404);
    return Response.json(
      { job: serialize(await store().read(access.userId, id)) },
      { headers: privateHeaders },
    );
  } catch (error) {
    return privateError(error);
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const access = await requireChatAccess(request.headers);
    const parsed = cancelRequest.safeParse(await boundedJson(request, 4096));
    if (!parsed.success) throw new AppError("invalid_request", 400);
    return Response.json(
      { job: serialize(await store().cancel(access.userId, parsed.data.id)) },
      { headers: privateHeaders },
    );
  } catch (error) {
    return privateError(error);
  }
}
