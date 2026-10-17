import { NextResponse } from "next/server";
import { requireChatAccess } from "@/lib/auth/access";
import { AppError } from "@/lib/errors";
import { errorResponse } from "@/lib/http/error-response";
import { assertOwnedObjectKey } from "@/lib/storage/objects";
import { privateStorageConfig } from "@/lib/storage/private";

async function readObjectKey(request: Request) {
  const url = new URL(request.url);
  const queryKey = url.searchParams.get("key");
  if (queryKey) {
    return queryKey;
  }
  if (request.method === "GET" || request.method === "DELETE") {
    return "";
  }
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    return "";
  }
  const body: unknown = await request.json();
  if (!body || typeof body !== "object" || !("key" in body)) {
    return "";
  }
  const key = body.key;
  return typeof key === "string" ? key : "";
}

async function guardedObject(request: Request) {
  const access = await requireChatAccess(request.headers);
  const key = await readObjectKey(request);
  if (!key) {
    throw new AppError("invalid_object", 400);
  }
  assertOwnedObjectKey(access.userId, key);
  if (!privateStorageConfig()) {
    throw new AppError("storage_unconfigured", 503);
  }
  return NextResponse.json(
    { error: { id: "storage_unavailable" } },
    { status: 503 },
  );
}

export async function POST(request: Request) {
  try {
    return await guardedObject(request);
  } catch (error) {
    return errorResponse(error, "upload_failed");
  }
}

export async function DELETE(request: Request) {
  try {
    return await guardedObject(request);
  } catch (error) {
    return errorResponse(error, "upload_failed");
  }
}
