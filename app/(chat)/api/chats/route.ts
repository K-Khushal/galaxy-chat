import { getUserChats } from "@/lib/actions/chat/chat";
import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

export async function GET() {
  try {
    const { userId } = await auth();

    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const chats = await getUserChats();

    return NextResponse.json({ chats });
  } catch (error) {
    console.error("Error fetching user chats:", error);
    return NextResponse.json(
      { error: "Failed to fetch chats" },
      { status: 500 },
    );
  }
}
