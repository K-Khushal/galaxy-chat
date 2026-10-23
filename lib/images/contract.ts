import { z } from "zod";
export const imageLimits = {
  bytes: 4 * 1024 * 1024,
  milliseconds: 60_000,
  prompt: 4000,
} as const;
const money = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
const identifier = z
  .string()
  .min(1)
  .max(200)
  .refine((v) => !v.includes("\0"));
export const imageRequest = z
  .object({
    action: z.literal("generate"),
    requestId: z.uuid(),
    chatId: identifier,
    messageId: identifier,
    title: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .refine((v) => !v.includes("\0")),
    prompt: z
      .string()
      .trim()
      .min(1)
      .max(imageLimits.prompt)
      .refine((v) => !v.includes("\0")),
    target: z
      .object({
        id: identifier,
        expectedVersion: z.number().int().min(1).max(39),
      })
      .strict()
      .optional(),
    funding: z.literal("byok:openrouter"),
    modelId: z.string().min(1).max(80),
    reviewDigest: z.string().regex(/^[a-f0-9]{64}$/),
    credentialRevision: z.uuid(),
    estimateMicrodollars: money,
    ceilingMicrodollars: money,
    providerBudgetAcknowledged: z.literal(true),
    operation: z.literal("generate"),
    // Reserved seam: these are never accepted by the generation-only adapter.
    reference: z
      .object({ id: z.uuid(), sha256: z.string().regex(/^[a-f0-9]{64}$/) })
      .strict()
      .optional(),
    mask: z
      .object({ id: z.uuid(), sha256: z.string().regex(/^[a-f0-9]{64}$/) })
      .strict()
      .optional(),
  })
  .strict();
export type ImageRequest = z.infer<typeof imageRequest>;
export type ImageSnapshot = {
  id: string;
  adapter: "openrouter";
  model: string;
  provider: string;
  verified: true;
  reviewedAt: string;
  expiresAt: string;
  width: 1024;
  height: 1024;
  mediaType: "image/png";
  generate: true;
  edit: false;
  mask: false;
  parameters: ["size", "n"];
  providerMaxMicrodollarsPerImage: number;
  worstCaseEstimateMicrodollars: number;
  providerBudgetVerified: true;
};
export type ImageCatalog = {
  available: boolean;
  recent?: ImageStatus[];
  model?: ImageSnapshot;
  reviewDigest?: string;
  credentialRevision?: string;
  reason?: string;
};
export type ImageStatus = {
  id: string;
  state: "reserved" | "entered" | "held" | "complete" | "failed" | "cancelled";
  cancelled: boolean;
  artifactId: string | null;
};
export function imageError(id: string) {
  const errors: Record<string, string> = {
    images_unavailable:
      "Image generation is unavailable until a reviewed model and private storage are configured.",
    image_review_changed:
      "The model review or estimate changed. Reload before generating.",
    image_capability_unavailable:
      "Editing and masks are unavailable because this adapter has no verified support.",
    image_held:
      "The provider outcome is unknown. This request stays held and will not be retried automatically.",
    image_cancelled:
      "Cancelled. Entered provider work may still run and incur provider charges.",
    image_storage_limit:
      "Private storage capacity is full. Download and delete older files before generating.",
    image_invalid_png:
      "The provider did not return a supported bounded 1024 × 1024 PNG. No revision was saved.",
    byok_key_changed: "Your provider key changed. Reload before generating.",
    artifact_conflict:
      "A newer revision exists. Reopen the artifact before generating.",
    invalid_image_request:
      "Check the prompt, ceiling, and provider budget acknowledgement.",
  };
  return (
    errors[id] ??
    "The image could not be saved. Check status before trying another request; provider charges may apply."
  );
}
export type ImageProvenance = {
  version: 1;
  operation: "generate";
  prompt: string;
  model: ImageSnapshot;
  inputs: [];
  object: {
    id: string;
    sha256: string;
    bytes: number;
    width: 1024;
    height: 1024;
    mediaType: "image/png";
  };
};

/** Exact integer-microdollar conversion; floating point must not raise a bound. */
export function imageUsd(microdollars: number) {
  return `${Math.floor(microdollars / 1_000_000)}.${String(microdollars % 1_000_000).padStart(6, "0")}`;
}
