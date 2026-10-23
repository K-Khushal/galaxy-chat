import { createHash } from "node:crypto";
import { encode } from "fast-png";
import { pngCrc } from "../../lib/images/png";
import { env } from "./beta-fixture";
export const snapshot = {
  id: "offline-image",
  adapter: "openrouter" as const,
  model: "fixture/image",
  provider: "fixture-endpoint",
  verified: true as const,
  reviewedAt: "2026-01-01T00:00:00Z",
  expiresAt: "2030-01-01T00:00:00Z",
  width: 1024 as const,
  height: 1024 as const,
  mediaType: "image/png" as const,
  generate: true as const,
  edit: false as const,
  mask: false as const,
  parameters: ["size", "n"] as ["size", "n"],
  providerMaxMicrodollarsPerImage: 100_000,
  worstCaseEstimateMicrodollars: 120_000,
  providerBudgetVerified: true as const,
};
export const imageEnv = {
  ...env,
  IMAGES_ENABLED: "1",
  IMAGE_MODELS_JSON: JSON.stringify([snapshot]),
};
export function png(color = 255) {
  return encode({
    width: 1024,
    height: 1024,
    channels: 4,
    depth: 8,
    data: new Uint8Array(1024 * 1024 * 4).fill(color),
  });
}
export function chunk(name: string, data: Uint8Array) {
  const out = new Uint8Array(data.length + 12),
    view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(new TextEncoder().encode(name), 4);
  out.set(data, 8);
  view.setUint32(out.length - 4, pngCrc(out.subarray(4, out.length - 4)));
  return out;
}
export function snapshotReviewDigest(s = snapshot) {
  return createHash("sha256").update(JSON.stringify(s)).digest("hex");
}
