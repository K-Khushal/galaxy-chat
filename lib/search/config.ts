import "server-only";
import { z } from "zod";
import type { EnvSource } from "@/lib/auth/env";
import { resourceActor } from "@/lib/byok/config";
import { keyring } from "@/lib/byok/crypto";

const positive = z.coerce.number().int().positive().max(2_000_000_000);
const snapshotSchema = z
  .object({
    id: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,99}$/),
    provider: z.literal("tavily"),
    contract: z.literal("tavily-basic-v1"),
    endpoint: z.literal("https://api.tavily.com/search"),
    creditsPerRequest: z.literal(1),
    worstCaseMicrodollars: z.number().int().positive().max(2_000_000_000),
    verified: z.literal(true),
    verifiedAt: z.iso.datetime(),
    expiresAt: z.iso.datetime(),
  })
  .strict();

export type SearchConfig = {
  snapshot: z.infer<typeof snapshotSchema>;
  caps: {
    actorHourlyRequests: number;
    actorDailyRequests: number;
    globalDailyRequests: number;
    actorDailyMicrodollars: number;
    globalDailyMicrodollars: number;
  };
};

export function resolveSearchConfig(env: EnvSource): SearchConfig | undefined {
  try {
    if (env.SEARCH_TOOLS_ENABLED !== "1") return;
    resourceActor("search-configuration-check", env);
    keyring(env);
    const raw = env.SEARCH_PRICE_JSON ?? "";
    if (raw.length > 4000) return;
    const snapshot = snapshotSchema.parse(JSON.parse(raw));
    if (
      new Date(snapshot.verifiedAt).getTime() > Date.now() ||
      new Date(snapshot.expiresAt).getTime() <= Date.now()
    )
      return;
    const caps = {
      actorHourlyRequests: positive.parse(env.SEARCH_ACTOR_HOURLY_REQUESTS),
      actorDailyRequests: positive.parse(env.SEARCH_ACTOR_DAILY_REQUESTS),
      globalDailyRequests: positive.parse(env.SEARCH_GLOBAL_DAILY_REQUESTS),
      actorDailyMicrodollars: positive.parse(
        env.SEARCH_ACTOR_DAILY_MICRODOLLARS,
      ),
      globalDailyMicrodollars: positive.parse(
        env.SEARCH_GLOBAL_DAILY_MICRODOLLARS,
      ),
    };
    return { snapshot, caps };
  } catch {
    return;
  }
}
