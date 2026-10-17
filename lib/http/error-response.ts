import { NextResponse } from "next/server";
import { AppError, logErrorId } from "@/lib/errors";

export function errorResponse(error: unknown, fallbackId: string) {
  if (error instanceof AppError) {
    return NextResponse.json(
      { error: { id: error.id } },
      { status: error.status },
    );
  }
  logErrorId(fallbackId);
  return NextResponse.json({ error: { id: fallbackId } }, { status: 500 });
}
