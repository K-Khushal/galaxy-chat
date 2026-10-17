import { requireChatAccess } from "@/lib/auth/access";
import { creditStatus } from "@/lib/credits/status";
import { actorFor } from "@/lib/credits/store";
import { errorResponse } from "@/lib/http/error-response";
export async function GET(request: Request) {
  try {
    const access = await requireChatAccess(request.headers);
    // Disabled funding still returns an honest status when its HMAC secret is absent.
    const actor =
      (process.env.CREDIT_ACTOR_SECRET?.length ?? 0) >= 32
        ? actorFor("user", access.userId, process.env.CREDIT_ACTOR_SECRET ?? "")
        : { kind: "user" as const, key: "unconfigured" };
    return Response.json(await creditStatus(process.env, actor), {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    const response = errorResponse(error, "credits_failed");
    response.headers.set("cache-control", "no-store");
    return response;
  }
}
