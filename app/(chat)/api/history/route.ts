import { getUserChats } from "@/lib/actions/chat/chat";
import { auth } from "@clerk/nextjs/server";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;

  const limit = Number.parseInt(searchParams.get("limit") || "10", 10);
  const startingAfter = searchParams.get("starting_after");
  const endingBefore = searchParams.get("ending_before");

  if (startingAfter && endingBefore) {
    return NextResponse.json(
      { error: "Only one of starting_after or ending_before can be provided." },
      { status: 400 },
    );
  }

  const { isAuthenticated, userId } = await auth();

  if (!isAuthenticated) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const chats = await getUserChats({
    userId,
    limit,
    startingAfter: startingAfter ?? undefined,
    endingBefore: endingBefore ?? undefined,
  });

  return Response.json(chats);
}
