import { z } from "zod";
import { requireChatAccess } from "@/lib/auth/access";
import { ByokStore } from "@/lib/byok/store";
import { boundedJson } from "@/lib/credits/http";
import { AppError } from "@/lib/errors";
import { errorResponse } from "@/lib/http/error-response";
import { assertSameOrigin } from "@/lib/http/origin";
import { resolveSearchConfig } from "@/lib/search/config";
import { SearchStore } from "@/lib/search/store";
import { toolEstimate, toolModels } from "@/lib/tools/config";
import { toolRunRequest } from "@/lib/tools/contract";
import { startToolRun } from "@/lib/tools/service";
import { ToolStore } from "@/lib/tools/store";
export const maxDuration = 30;
export async function GET(request: Request) {
  try {
    const access = await requireChatAccess(request.headers);
    const id = new URL(request.url).searchParams.get("id");
    const search = resolveSearchConfig(process.env);
    return Response.json(
      id
        ? await new ToolStore().view(access.userId, id)
        : {
            models: toolModels(process.env).map((m) => ({
              id: m.id,
              name: m.model,
              funding: m.adapter,
              estimateMicrodollars: toolEstimate(m),
            })),
            credentials: await new ByokStore().credentials(access.userId),
            searchProviders: search
              ? [
                  {
                    provider: "tavily" as const,
                    name: "Tavily Search",
                    priceRevision: search.snapshot.id,
                    estimateMicrodollars: search.snapshot.worstCaseMicrodollars,
                  },
                ]
              : [],
            searchCredentials: await new SearchStore().credentials(
              access.userId,
            ),
            revisions: await new ToolStore().catalogRevisions(access.userId),
          },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error, "tools_request_failed");
  }
}
const mutation = z.discriminatedUnion("action", [
  z.object({ action: z.literal("run"), request: toolRunRequest }).strict(),
  z.object({ action: z.literal("delete"), id: z.uuid() }).strict(),
  z
    .object({
      action: z.literal("approval"),
      id: z.uuid(),
      decision: z.enum(["approve", "deny", "revoke"]),
    })
    .strict(),
]);
export async function POST(request: Request) {
  try {
    const access = await requireChatAccess(request.headers);
    assertSameOrigin(request);
    const parsed = mutation.safeParse(await boundedJson(request, 16000));
    if (!parsed.success) throw new AppError("invalid_request", 400);
    const body = parsed.data;
    if (body.action === "run")
      return Response.json(
        await startToolRun({
          userId: access.userId,
          request: body.request,
          env: process.env,
          signal: request.signal,
        }),
        { headers: { "cache-control": "no-store" } },
      );
    const store = new ToolStore();
    if (body.action === "delete") await store.remove(access.userId, body.id);
    else await store.decideApproval(access.userId, body.id, body.decision);
    return Response.json(
      { ok: true },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error, "tools_request_failed");
  }
}
