import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import type { EnvSource } from "@/lib/auth/env";
import { requireByok } from "@/lib/byok/config";
import { AppError } from "@/lib/errors";
import type { ImageRequest, ImageSnapshot } from "./contract";

const slug = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,199}$/);
const money = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
export const imageSnapshotSchema = z
  .object({
    id: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/),
    adapter: z.literal("openrouter"),
    model: slug,
    provider: slug,
    verified: z.literal(true),
    reviewedAt: z.iso.datetime(),
    expiresAt: z.iso.datetime(),
    width: z.literal(1024),
    height: z.literal(1024),
    mediaType: z.literal("image/png"),
    generate: z.literal(true),
    edit: z.literal(false),
    mask: z.literal(false),
    parameters: z.tuple([z.literal("size"), z.literal("n")]),
    providerMaxMicrodollarsPerImage: money,
    worstCaseEstimateMicrodollars: money,
    providerBudgetVerified: z.literal(true),
  })
  .strict();
export function imageSnapshot(
  env: EnvSource = process.env,
  now = Date.now(),
): ImageSnapshot {
  try {
    if (env.IMAGES_ENABLED !== "1") throw Error();
    requireByok(env);
    const raw = env.IMAGE_MODELS_JSON;
    if (!raw || raw.length > 8192) throw Error();
    const [snapshot] = z
      .array(imageSnapshotSchema)
      .length(1)
      .parse(JSON.parse(raw));
    if (
      Date.parse(snapshot.reviewedAt) > now ||
      Date.parse(snapshot.reviewedAt) >= Date.parse(snapshot.expiresAt) ||
      Date.parse(snapshot.expiresAt) <= now ||
      snapshot.worstCaseEstimateMicrodollars <
        snapshot.providerMaxMicrodollarsPerImage
    )
      throw Error();
    return snapshot;
  } catch {
    throw new AppError("images_unavailable", 503);
  }
}
export function snapshotDigest(snapshot: ImageSnapshot) {
  return createHash("sha256")
    .update(JSON.stringify(imageSnapshotSchema.parse(snapshot)))
    .digest("hex");
}
export function validateImageReview(
  request: ImageRequest,
  snapshot: ImageSnapshot,
  pinned?: ImageSnapshot,
) {
  if (request.reference || request.mask)
    throw new AppError("image_capability_unavailable", 400);
  if (
    request.modelId !== snapshot.id ||
    request.estimateMicrodollars !== snapshot.worstCaseEstimateMicrodollars ||
    request.ceilingMicrodollars < snapshot.worstCaseEstimateMicrodollars ||
    request.providerBudgetAcknowledged !== true ||
    (pinned && snapshotDigest(snapshot) !== snapshotDigest(pinned))
  )
    throw new AppError("image_review_changed", 409);
}
