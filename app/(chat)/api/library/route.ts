import { NextResponse } from "next/server";
import { getChatMessagesWithMedia } from "@/lib/actions/chat/chat-message";
import { requireChatAccess } from "@/lib/auth/access";
import { AppError, logErrorId } from "@/lib/errors";

export async function GET(request: Request) {
  try {
    const access = await requireChatAccess(request.headers);
    const mediaMessages = await getChatMessagesWithMedia(access.userId);
    return NextResponse.json({ mediaMessages });
  } catch (error) {
    if (error instanceof AppError) {
      return NextResponse.json(
        { error: { id: error.id } },
        { status: error.status },
      );
    }
    logErrorId("library_failed");
    return NextResponse.json(
      { error: { id: "library_failed" } },
      { status: 500 },
    );
  }
}
