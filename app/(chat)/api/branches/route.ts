import { readBranches } from "@/lib/actions/chat/branches";
import { requireChatAccess } from "@/lib/auth/access";
import { errorResponse } from "@/lib/http/error-response";
export async function GET(request: Request) {
  try {
    const access = await requireChatAccess(request.headers);
    const url = new URL(request.url);
    return Response.json(
      await readBranches(
        url.searchParams.get("chatId") ?? "",
        access.userId,
        url.searchParams.get("branchId") ?? undefined,
      ),
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error, "branches_failed");
  }
}
