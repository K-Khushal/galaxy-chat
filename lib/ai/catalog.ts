import "server-only";
import type { EnvSource } from "@/lib/auth/env";
import { resolveFundingConfig } from "@/lib/credits/config";
import type { ChatModel } from "./model";
/** Only reviewed operator snapshots become selectable. No model IDs or prices are guessed. */
export function modelCatalog(env: EnvSource): ChatModel[] {
  try {
    const config = resolveFundingConfig(env);
    return [
      {
        id: config.price.model,
        name: config.price.model,
        adapter: config.adapter,
        available: true,
        description: `Basic text · ${config.adapter} · platform credits`,
        capabilities: {
          text: true,
          reasoning: false,
          sources: false,
          files: false,
          tools: false,
          search: false,
        },
      },
    ];
  } catch {
    return [];
  }
}
