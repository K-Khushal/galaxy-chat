import type { LanguageModel } from "ai";
import type { ResumableStreamContext } from "resumable-stream";
import type { ObjectStorage } from "@/lib/attachments/storage";
import type { Db } from "@/lib/db/types";
import type { EnvSource } from "@/lib/env";
import type { ReasoningEffort } from "@/lib/models";
import type { RateLimit } from "@/lib/ratelimit";
import type { Kv } from "@/lib/redis";

export type LanguageModelFactory = (
  modelId: string,
  apiKey: string,
  options: { reasoningEffort?: ReasoningEffort },
) => LanguageModel;

export type GenerationTiming = {
  /** How often a running Reply is saved to Postgres. */
  checkpointMs: number;
  /** How often a Generation checks for a Stop signal. */
  stopPollMs: number;
  /** Expiry of the Generation locks; a crashed Generation frees them after this. */
  lockTtlMs: number;
  /** How often a running Generation renews its locks. */
  renewMs: number;
  /** When a Generation ends as Interrupted, just before the function limit. */
  deadlineMs: number;
};

/** Everything the API needs, injected so tests can run without a network. */
export type AppContext = {
  db: Db;
  kv: Kv;
  streams: Pick<
    ResumableStreamContext,
    "createNewResumableStream" | "resumeExistingStream"
  >;
  rateLimit: RateLimit;
  languageModel: LanguageModelFactory;
  /** Attachment objects (Cloudflare R2), connected on first use. */
  storage: ObjectStorage;
  /** The Platform key, read only when Credits pay for a Reply. */
  platformKey: () => string;
  /** Holds the BYOK keyring variables. */
  byokEnv: EnvSource;
  testByokKey: (key: string) => Promise<boolean>;
  /** The signed-in User's ID; throws a 401/403 AppError otherwise. */
  sessionCreatedAt: (request: Request) => Promise<Date>;
  authenticate: (request: Request) => Promise<string>;
  /** Keeps the function alive for background work (Next.js `after`). */
  waitUntil: (promise: Promise<unknown>) => void;
  timing: GenerationTiming;
};

/** Must match `maxDuration` in the Generation routes (Vercel Hobby: 300s). */
export const MAX_DURATION_SECONDS = 300;

export const DEFAULT_TIMING: GenerationTiming = {
  checkpointMs: 2_000,
  stopPollMs: 400,
  lockTtlMs: 30_000,
  renewMs: 10_000,
  // Leaves time for the final save and lock release before the hard limit.
  deadlineMs: (MAX_DURATION_SECONDS - 20) * 1_000,
};
