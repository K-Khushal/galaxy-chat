import { z } from "zod";

export type EnvSource = Record<string, string | undefined>;

const required = (name: string) =>
  z
    .string({ error: `${name} is required` })
    .trim()
    .min(1, `${name} is required`);

const databaseShape = {
  DATABASE_URL: required("DATABASE_URL"),
};

export type ByokKeyring = { keys: Map<string, Buffer>; active: string };

const KEYRING_MESSAGE =
  'BYOK_ENCRYPTION_KEYS_JSON must map 1-16 version names to base64 of 32 bytes, e.g. {"v1":"<base64>"}';

/**
 * BYOK encryption keys: a JSON object mapping a version name to canonical
 * base64 of 32 random bytes, plus the active version used to seal new keys.
 */
const byokSchema = z
  .object({
    BYOK_ENCRYPTION_KEYS_JSON: required("BYOK_ENCRYPTION_KEYS_JSON").max(
      4000,
      KEYRING_MESSAGE,
    ),
    BYOK_ACTIVE_KEY_VERSION: required("BYOK_ACTIVE_KEY_VERSION"),
  })
  .transform((value, ctx): ByokKeyring => {
    const keys = new Map<string, Buffer>();
    let parsed: unknown;
    try {
      parsed = JSON.parse(value.BYOK_ENCRYPTION_KEYS_JSON);
    } catch {
      parsed = null;
    }
    const entries =
      parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? Object.entries(parsed)
        : [];
    for (const [version, encoded] of entries) {
      if (
        !/^[a-zA-Z0-9_-]{1,40}$/.test(version) ||
        typeof encoded !== "string" ||
        !/^[A-Za-z0-9+/]{43}=$/.test(encoded)
      ) {
        break;
      }
      const bytes = Buffer.from(encoded, "base64");
      if (bytes.length !== 32 || bytes.toString("base64") !== encoded) {
        break;
      }
      keys.set(version, bytes);
    }
    if (
      entries.length === 0 ||
      entries.length > 16 ||
      keys.size !== entries.length
    ) {
      ctx.addIssue({ code: "custom", message: KEYRING_MESSAGE });
      return z.NEVER;
    }
    if (!keys.has(value.BYOK_ACTIVE_KEY_VERSION)) {
      ctx.addIssue({
        code: "custom",
        message:
          "BYOK_ACTIVE_KEY_VERSION must name a version in BYOK_ENCRYPTION_KEYS_JSON",
      });
      return z.NEVER;
    }
    return { keys, active: value.BYOK_ACTIVE_KEY_VERSION };
  });

const envSchema = z.object({
  ...databaseShape,
  BETTER_AUTH_SECRET: required("BETTER_AUTH_SECRET").min(
    32,
    "BETTER_AUTH_SECRET must be at least 32 characters",
  ),
  BETTER_AUTH_URL: required("BETTER_AUTH_URL").pipe(
    z.url("BETTER_AUTH_URL must be a URL"),
  ),
  GITHUB_CLIENT_ID: required("GITHUB_CLIENT_ID"),
  GITHUB_CLIENT_SECRET: required("GITHUB_CLIENT_SECRET"),
  GOOGLE_CLIENT_ID: required("GOOGLE_CLIENT_ID"),
  GOOGLE_CLIENT_SECRET: required("GOOGLE_CLIENT_SECRET"),
  CREDIT_IDENTITY_KEY: required("CREDIT_IDENTITY_KEY").min(32),
  RESEND_API_KEY: required("RESEND_API_KEY"),
  AUTH_EMAIL_FROM: required("AUTH_EMAIL_FROM"),
  UPSTASH_REDIS_REST_URL: required("UPSTASH_REDIS_REST_URL").pipe(z.url()),
  UPSTASH_REDIS_REST_TOKEN: required("UPSTASH_REDIS_REST_TOKEN"),
  TURNSTILE_SECRET_KEY: required("TURNSTILE_SECRET_KEY"),
  TURNSTILE_SITE_KEY: required("TURNSTILE_SITE_KEY"),
  // Upstash Redis over TCP/TLS (not the REST URL): Generation locks, Stop
  // signals, resumable-stream pub/sub and rate limits (ADR 0004).
  REDIS_URL: required("REDIS_URL").regex(
    /^rediss?:\/\/.+/,
    "REDIS_URL must be a redis:// or rediss:// URL",
  ),
  // The Platform key: OpenRouter key that serves Replies paid with Credits.
  OPENROUTER_API_KEY: required("OPENROUTER_API_KEY"),
});

export type Env = z.infer<typeof envSchema> & { BYOK_KEYRING: ByokKeyring };

export class EnvError extends Error {
  constructor(issues: readonly z.core.$ZodIssue[]) {
    const lines = issues.map((issue) => `  - ${issue.message}`);
    super(`Invalid environment configuration:\n${lines.join("\n")}`);
    this.name = "EnvError";
  }
}

function parse<T extends z.ZodType>(schema: T, source: EnvSource): z.output<T> {
  const result = schema.safeParse(source);
  if (!result.success) {
    throw new EnvError(result.error.issues);
  }
  return result.data;
}

/** Parses every variable the app needs. Throws EnvError listing what is wrong. */
export function parseEnv(source: EnvSource): Env {
  const app = envSchema.safeParse(source);
  const byok = byokSchema.safeParse(source);
  if (!app.success || !byok.success) {
    throw new EnvError([
      ...(app.error?.issues ?? []),
      ...(byok.error?.issues ?? []),
    ]);
  }
  return { ...app.data, BYOK_KEYRING: byok.data };
}

let cached: Env | null = null;

/** Validated process.env, parsed on first use so `next build` needs no secrets. */
export function env(): Env {
  cached ??= parseEnv(process.env);
  return cached;
}

/** Only the database URL, for the migration runner. */
export function databaseUrl(source: EnvSource = process.env): string {
  return parse(z.object(databaseShape), source).DATABASE_URL;
}

/** Only the BYOK keyring, for lib/byok/crypto.ts. Throws EnvError. */
export function byokKeyring(source: EnvSource): ByokKeyring {
  return parse(byokSchema, source);
}
