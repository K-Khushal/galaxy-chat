import "server-only";
import { createHmac } from "node:crypto";
import { z } from "zod";
import type { ChatModel } from "@/lib/ai/model";
import type { EnvSource } from "@/lib/auth/env";
import { AppError } from "@/lib/errors";
import { keyring } from "./crypto";

// These bound app resources, never the provider's bill or account spending limit.
export const BYOK_LIMITS = {
  hourly: 30,
  daily: 200,
  globalDaily: 5000,
  actorConcurrency: 1,
  globalConcurrency: 8,
  actorRecords: 10000,
  globalRecords: 100000,
  metadataBytes: 16384,
} as const;
const entry = z
  .object({
    id: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_./:-]{0,99}$/),
    name: z.string().trim().min(1).max(100),
    adapter: z.enum(["openrouter", "gateway"]),
    model: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_./:-]{0,99}$/),
    provider: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_./-]{0,99}$/),
    verified: z.literal(true),
    expiresAt: z.iso.datetime(),
    capabilities: z
      .object({
        text: z.literal(true),
        reasoning: z.boolean(),
        sources: z.boolean(),
        files: z.literal(false),
        tools: z.literal(false),
        search: z.literal(false),
      })
      .strict(),
  })
  .strict();
export type ByokModel = z.infer<typeof entry>;
export function resourceDigest(payload: string, env: EnvSource) {
  const secret = env.BYOK_RESOURCE_SECRET;
  if (!secret || secret.length < 32)
    throw new AppError("byok_resources_unavailable", 503);
  return createHmac("sha256", secret)
    .update(JSON.stringify(["galaxy-byok-request-v1", payload]))
    .digest("hex");
}
export function resourceActor(userId: string, env: EnvSource) {
  const secret = env.BYOK_RESOURCE_SECRET;
  if (!secret || secret.length < 32 || !userId)
    throw new AppError("byok_resources_unavailable", 503);
  return createHmac("sha256", secret)
    .update(JSON.stringify(["galaxy-byok-resource-v1", userId]))
    .digest("hex");
}
export function requireByok(env: EnvSource) {
  resourceActor("configuration-check", env);
  if (env.BYOK_ENABLED !== "1") throw new AppError("byok_disabled", 503);
  keyring(env);
}
export function configuredModels(env: EnvSource): ByokModel[] {
  try {
    requireByok(env);
    const raw = env.BYOK_MODELS_JSON ?? "";
    if (raw.length > 100000) throw new Error();
    const parsed = z.array(entry).max(100).parse(JSON.parse(raw));
    if (new Set(parsed.map((m) => m.id)).size !== parsed.length)
      throw new Error();
    return parsed.filter((m) => new Date(m.expiresAt).getTime() > Date.now());
  } catch {
    return [];
  }
}
export function resolveByokModel(env: EnvSource, id: string, provider: string) {
  requireByok(env);
  const model = configuredModels(env).find(
    (m) => m.id === id && m.adapter === provider,
  );
  if (!model) throw new AppError("byok_model_unavailable", 403);
  return model;
}
export function byokCatalog(env: EnvSource): ChatModel[] {
  return configuredModels(env).map((m) => ({
    id: m.id,
    name: m.name,
    adapter: m.adapter,
    available: true,
    description: `Text${m.capabilities.reasoning ? " · reasoning" : ""}${m.capabilities.sources ? " · supplied sources" : ""} · your ${m.adapter === "gateway" ? "Vercel Gateway" : "OpenRouter"} key · no files, tools or search`,
    capabilities: m.capabilities,
  }));
}
