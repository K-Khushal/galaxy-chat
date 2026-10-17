import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getUserChats } from "@/lib/actions/chat/chat";
import { requireChatAccess } from "@/lib/auth/access";
import { AppError, logErrorId } from "@/lib/errors";

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const limit = Number.parseInt(searchParams.get("limit") || "10", 10);
  const startingAfter = searchParams.get("starting_after");
  const endingBefore = searchParams.get("ending_before");

  if (startingAfter && endingBefore) {
    return NextResponse.json(
      { error: { id: "invalid_cursor" } },
      { status: 400 },
    );
  }

  try {
    const access = await requireChatAccess(request.headers);
    const chats = await getUserChats({
      userId: access.userId,
      limit,
      startingAfter: startingAfter ?? undefined,
      endingBefore: endingBefore ?? undefined,
    });
    return NextResponse.json(chats);
  } catch (error) {
    if (error instanceof AppError) {
      return NextResponse.json(
        { error: { id: error.id } },
        { status: error.status },
      );
    }
    logErrorId("history_failed");
    return NextResponse.json(
      { error: { id: "history_failed" } },
      { status: 500 },
    );
  }
}
