import "server-only";
import { z } from "zod";
import type { AppContext } from "@/lib/api/context";
import { handle, json, readJson } from "@/lib/api/respond";
import {
  confirmUpload,
  createUpload,
  removeUnattached,
  viewUrl,
} from "@/lib/attachments/store";
import { AppError } from "@/lib/errors";

/** Control characters and path separators have no place in a display name. */
const displayName = (name: string) =>
  [...name]
    .map((char) =>
      char.charCodeAt(0) < 32 ||
      char === "\u007f" ||
      char === "/" ||
      char === "\\"
        ? "_"
        : char,
    )
    .join("")
    .trim();

const uploadSchema = z.strictObject({
  filename: z.string().transform(displayName).pipe(z.string().min(1).max(255)),
  contentType: z.string().max(100),
  size: z.number().int().positive(),
});

/**
 * POST /api/attachments { filename, contentType, size }: records the file and
 * returns the URL to PUT it to. Rate limited per User.
 */
export function presignRoute(ctx: AppContext, request: Request) {
  return handle(async () => {
    const userId = await ctx.authenticate(request);
    const body = await readJson(request, uploadSchema);
    if (!(await ctx.rateLimit("presign", userId))) {
      throw new AppError("rate_limited", 429);
    }
    return json(await createUpload(ctx, userId, body), 201);
  });
}

/** POST /api/attachments/[id]/confirm: verifies the upload and marks it ready. */
export function confirmRoute(
  ctx: AppContext,
  request: Request,
  attachmentId: string,
) {
  return handle(async () => {
    const userId = await ctx.authenticate(request);
    return json({
      attachment: await confirmUpload(ctx, userId, attachmentId),
    });
  });
}

/** GET /api/attachments/[id]: redirects to a short-lived read URL. */
export function viewRoute(
  ctx: AppContext,
  request: Request,
  attachmentId: string,
) {
  return handle(async () => {
    const userId = await ctx.authenticate(request);
    const url = await viewUrl(ctx, userId, attachmentId);
    return new Response(null, {
      status: 302,
      headers: { Location: url, "Cache-Control": "private, no-store" },
    });
  });
}

/** DELETE /api/attachments/[id]: removes a file not yet sent in a Message. */
export function deleteAttachmentRoute(
  ctx: AppContext,
  request: Request,
  attachmentId: string,
) {
  return handle(async () => {
    const userId = await ctx.authenticate(request);
    await removeUnattached(ctx, userId, attachmentId);
    return new Response(null, { status: 204 });
  });
}
