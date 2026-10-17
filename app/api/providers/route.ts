import { z } from "zod";
import { requireChatAccess } from "@/lib/auth/access";
import { byokCatalog } from "@/lib/byok/config";
import { testCredential } from "@/lib/byok/service";
import { ByokStore } from "@/lib/byok/store";
import { boundedJson } from "@/lib/credits/http";
import { AppError } from "@/lib/errors";
import { errorResponse } from "@/lib/http/error-response";
import { assertSameOrigin } from "@/lib/http/origin";

const provider = z.enum(["openrouter", "gateway"]);
const revision = z.uuid();
const target = z.object({ provider, revision }).strict();
const save = z
  .object({
    provider,
    revision: revision.nullable(),
    key: z.string().min(32).max(512),
  })
  .strict();
async function handle(
  request: Request,
  action: "list" | "save" | "delete" | "test",
) {
  try {
    const access = await requireChatAccess(request.headers);
    if (action !== "list") assertSameOrigin(request);
    const store = new ByokStore();
    if (action === "save") {
      const parsed = save.safeParse(await boundedJson(request, 2048));
      if (!parsed.success) throw new AppError("invalid_request", 400);
      await store.save(
        access.userId,
        parsed.data.provider,
        parsed.data.key,
        process.env,
        parsed.data.revision,
      );
    } else if (action !== "list") {
      const parsed = target.safeParse(await boundedJson(request, 1024));
      if (!parsed.success) throw new AppError("invalid_request", 400);
      if (action === "delete")
        await store.delete(
          access.userId,
          parsed.data.provider,
          parsed.data.revision,
        );
      else
        await testCredential({
          userId: access.userId,
          ...parsed.data,
          env: process.env,
          signal: request.signal,
        });
    }
    return Response.json(
      {
        ...(await store.view(access.userId, process.env)),
        models: byokCatalog(process.env),
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    const response = errorResponse(error, "provider_settings_failed");
    response.headers.set("cache-control", "no-store");
    return response;
  }
}
export const GET = (request: Request) => handle(request, "list");
export const PUT = (request: Request) => handle(request, "save");
export const DELETE = (request: Request) => handle(request, "delete");
export const POST = (request: Request) => handle(request, "test");
