import { requireChatAccess } from "@/lib/auth/access";
import { contextLibrary, mutateContext } from "@/lib/context/service";
import { boundedJson } from "@/lib/credits/http";
import { errorResponse } from "@/lib/http/error-response";
import { assertSameOrigin } from "@/lib/http/origin";
export async function GET(request: Request) {
  try {
    const access = await requireChatAccess(request.headers);
    return Response.json(await contextLibrary(access.userId), {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    const response = errorResponse(error, "context_failed");
    response.headers.set("cache-control", "no-store");
    return response;
  }
}
export async function POST(request: Request) {
  try {
    const access = await requireChatAccess(request.headers);
    assertSameOrigin(request);
    return Response.json(
      await mutateContext(access.userId, await boundedJson(request)),
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    const response = errorResponse(error, "context_failed");
    response.headers.set("cache-control", "no-store");
    return response;
  }
}
