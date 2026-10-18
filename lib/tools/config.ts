import "server-only";
import { z } from "zod";
import type { EnvSource } from "@/lib/auth/env";
import { requireByok } from "@/lib/byok/config";
import { LIMITS } from "@/lib/credits/config";
import { AppError } from "@/lib/errors";

const snapshot = z
  .object({
    id: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_./:-]{0,99}$/),
    adapter: z.enum(["openrouter", "gateway"]),
    model: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_./:-]{0,99}$/),
    provider: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_./-]{0,99}$/),
    verified: z.literal(true),
    tools: z.literal(true),
    reasoning: z.literal(false),
    providerBudgetVerified: z.literal(true),
    expiresAt: z.iso.datetime(),
    inputMicrodollarsPerMillion: z.number().int().min(0).max(1_000_000_000),
    outputMicrodollarsPerMillion: z.number().int().min(0).max(1_000_000_000),
  })
  .strict();
export function toolModels(env: EnvSource) {
  try {
    requireByok(env);
    if (
      env.TOOLS_ENABLED !== "1" ||
      !env.TOOL_APPROVAL_SECRET ||
      env.TOOL_APPROVAL_SECRET.length < 32
    )
      return [];
    const raw = env.TOOL_MODELS_JSON ?? "";
    if (raw.length > 30000) return [];
    const models = z.array(snapshot).max(30).parse(JSON.parse(raw));
    if (new Set(models.map((m) => m.id)).size !== models.length) return [];
    return models.filter((m) => new Date(m.expiresAt).getTime() > Date.now());
  } catch {
    return [];
  }
}
export function resolveToolModel(env: EnvSource, id: string, adapter: string) {
  const model = toolModels(env).find(
    (m) => m.id === id && m.adapter === adapter,
  );
  if (!model) throw new AppError("tools_unavailable", 503);
  return model;
}
export function toolEstimate(model: ReturnType<typeof resolveToolModel>) {
  return Math.max(
    1,
    Math.ceil(
      (3 * LIMITS.inputTokens * model.inputMicrodollarsPerMillion) / 1_000_000,
    ) +
      Math.ceil(
        (LIMITS.outputTokens * model.outputMicrodollarsPerMillion) / 1_000_000,
      ),
  );
}
