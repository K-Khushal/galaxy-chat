import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getUserChats } from "@/lib/actions/chat/chat";
import { requireChatAccess } from "@/lib/auth/access";
import { AppError } from "@/lib/errors";
import { errorResponse } from "@/lib/http/error-response";

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const limit = Number.parseInt(searchParams.get("limit") || "10", 10);
  const startingAfter = searchParams.get("starting_after");
  const endingBefore = searchParams.get("ending_before");
  const query = searchParams.get("q") ?? undefined;

  if (startingAfter && endingBefore) {
    return NextResponse.json(
      { error: { id: "invalid_cursor" } },
      { status: 400 },
    );
  }

  try {
    const access = await requireChatAccess(request.headers);
    if (query && query.trim().length > 200) {
      throw new AppError("invalid_request", 400);
    }
    const chats = await getUserChats({
      userId: access.userId,
      limit,
      startingAfter: startingAfter ?? undefined,
      endingBefore: endingBefore ?? undefined,
      query,
    });
    return NextResponse.json(chats);
  } catch (error) {
    return errorResponse(error, "history_failed");
  }
}
