import { getChatMessagesWithMedia } from "@/lib/actions/chat/chat-message";
import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

export async function GET() {
  try {
    const { isAuthenticated, userId } = await auth();

    if (!isAuthenticated || !userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const mediaMessages = await getChatMessagesWithMedia(userId);

    return NextResponse.json({ mediaMessages });
  } catch (error) {
    console.error("Error fetching media messages:", error);
    return NextResponse.json(
      { error: "Failed to fetch media messages" },
      { status: 500 },
    );
  }
}
