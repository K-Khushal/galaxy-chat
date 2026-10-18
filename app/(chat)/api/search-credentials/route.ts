import { z } from "zod";
import { requireChatAccess } from "@/lib/auth/access";
import { boundedJson } from "@/lib/credits/http";
import { AppError } from "@/lib/errors";
import { errorResponse } from "@/lib/http/error-response";
import { assertSameOrigin } from "@/lib/http/origin";
import { resolveSearchConfig } from "@/lib/search/config";
import { SearchStore } from "@/lib/search/store";

const save = z
  .object({
    provider: z.literal("tavily"),
    key: z.string().min(32).max(512),
    revision: z.uuid().nullable(),
  })
  .strict();
const remove = z
  .object({ provider: z.literal("tavily"), revision: z.uuid() })
  .strict();
async function view(userId: string) {
  return {
    configured: Boolean(resolveSearchConfig(process.env)),
    credentials: await new SearchStore().credentials(userId),
  };
}
export async function GET(request: Request) {
  try {
    const access = await requireChatAccess(request.headers);
    return Response.json(await view(access.userId), {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    return errorResponse(error, "search_credentials_failed");
  }
}
export async function PUT(request: Request) {
  try {
    const access = await requireChatAccess(request.headers);
    assertSameOrigin(request);
    const parsed = save.safeParse(await boundedJson(request, 2048));
    if (!parsed.success) throw new AppError("invalid_request", 400);
    await new SearchStore().save(
      access.userId,
      parsed.data.key,
      parsed.data.revision,
      process.env,
    );
    return Response.json(await view(access.userId), {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    return errorResponse(error, "search_credentials_failed");
  }
}
export async function DELETE(request: Request) {
  try {
    const access = await requireChatAccess(request.headers);
    assertSameOrigin(request);
    const parsed = remove.safeParse(await boundedJson(request, 1024));
    if (!parsed.success) throw new AppError("invalid_request", 400);
    await new SearchStore().delete(access.userId, parsed.data.revision);
    return Response.json(await view(access.userId), {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    return errorResponse(error, "search_credentials_failed");
  }
}
