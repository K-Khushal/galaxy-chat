import "server-only";
import type { AppContext } from "@/lib/api/context";
import { handle, json } from "@/lib/api/respond";
import { searchChats } from "@/lib/chat/search";
import { AppError } from "@/lib/errors";
export function searchChatsRoute(ctx: AppContext, request: Request) {
  return handle(async () => {
    const userId = await ctx.authenticate(request);
    const query = (new URL(request.url).searchParams.get("q") ?? "").trim();
    if (query.length > 200) throw new AppError("invalid_request", 400);
    return json({
      chats: query ? await searchChats(ctx.db, userId, query) : [],
    });
  });
}
