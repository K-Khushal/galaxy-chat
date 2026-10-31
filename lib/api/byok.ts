import "server-only";
import { z } from "zod";
import type { AppContext } from "@/lib/api/context";
import { handle, json, readJson } from "@/lib/api/respond";
import { validateKey } from "@/lib/byok/crypto";
import {
  deleteByokKey,
  getByokKeyStatus,
  loadByokKey,
  saveByokKey,
} from "@/lib/byok/store";
import { AppError } from "@/lib/errors";

async function limited(ctx: AppContext, userId: string) {
  if (!(await ctx.rateLimit("byok", userId))) {
    throw new AppError("rate_limited", 429);
  }
}

/** GET /api/byok: whether a key is saved. The key itself never leaves the server. */
export function getByokRoute(ctx: AppContext, request: Request) {
  return handle(async () => {
    const userId = await ctx.authenticate(request);
    return json({ key: await getByokKeyStatus(ctx.db, userId) });
  });
}

/** PUT /api/byok { key }: saves or replaces the key once OpenRouter accepts it. */
export function saveByokRoute(ctx: AppContext, request: Request) {
  return handle(async () => {
    const userId = await ctx.authenticate(request);
    await limited(ctx, userId);
    const body = await readJson(
      request,
      z.strictObject({ key: z.string().max(512) }),
    );
    const key = validateKey(body.key.trim());
    if (!(await ctx.testByokKey(key))) {
      throw new AppError("provider_key_rejected", 400);
    }
    await saveByokKey(ctx.db, ctx.byokEnv, userId, key);
    return json({ key: await getByokKeyStatus(ctx.db, userId) });
  });
}

/** POST /api/byok/test: checks the saved key with OpenRouter. */
export function testByokRoute(ctx: AppContext, request: Request) {
  return handle(async () => {
    const userId = await ctx.authenticate(request);
    await limited(ctx, userId);
    const key = await loadByokKey(ctx.db, ctx.byokEnv, userId);
    if (!key) throw new AppError("byok_key_missing", 404);
    return json({ ok: await ctx.testByokKey(key) });
  });
}

/** DELETE /api/byok */
export function deleteByokRoute(ctx: AppContext, request: Request) {
  return handle(async () => {
    const userId = await ctx.authenticate(request);
    await deleteByokKey(ctx.db, userId);
    return new Response(null, { status: 204 });
  });
}
