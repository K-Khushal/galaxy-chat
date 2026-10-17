import { NextResponse } from "next/server";
import { requireChatAccess } from "@/lib/auth/access";
import { AppError, logErrorId } from "@/lib/errors";
import { privateStorageConfig } from "@/lib/storage/private";

export async function POST(request: Request) {
  try {
    await requireChatAccess(request.headers);
    if (!privateStorageConfig()) {
      throw new AppError("storage_unconfigured", 503);
    }
    return NextResponse.json(
      { error: { id: "storage_unavailable" } },
      { status: 503 },
    );
  } catch (error) {
    if (error instanceof AppError) {
      return NextResponse.json(
        { error: { id: error.id } },
        { status: error.status },
      );
    }
    logErrorId("upload_failed");
    return NextResponse.json(
      { error: { id: "upload_failed" } },
      { status: 500 },
    );
  }
}

export async function DELETE(request: Request) {
  try {
    await requireChatAccess(request.headers);
    if (!privateStorageConfig()) {
      throw new AppError("storage_unconfigured", 503);
    }
    return NextResponse.json(
      { error: { id: "storage_unavailable" } },
      { status: 503 },
    );
  } catch (error) {
    if (error instanceof AppError) {
      return NextResponse.json(
        { error: { id: error.id } },
        { status: error.status },
      );
    }
    logErrorId("upload_failed");
    return NextResponse.json(
      { error: { id: "upload_failed" } },
      { status: 500 },
    );
  }
}
