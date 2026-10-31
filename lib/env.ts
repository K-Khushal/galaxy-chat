import { z } from "zod";

export type EnvSource = Record<string, string | undefined>;

const required = (name: string) =>
  z
    .string({ error: `${name} is required` })
    .trim()
    .min(1, `${name} is required`);

const databaseSchema = z.object({
  DATABASE_URL: required("DATABASE_URL"),
});

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

const authSchema = z.object({
  BETTER_AUTH_SECRET: required("BETTER_AUTH_SECRET").min(
    32,
    "BETTER_AUTH_SECRET must be at least 32 characters",
  ),
  BETTER_AUTH_URL: required("BETTER_AUTH_URL").pipe(
    z.url("BETTER_AUTH_URL must be a URL"),
  ),
  APP_ORIGINS: z.string().optional(),
  VERCEL_ENV: z.enum(["production", "preview", "development"]).optional(),
  VERCEL_URL: z.string().optional(),
  VERCEL_BRANCH_URL: z.string().optional(),
  GITHUB_CLIENT_ID: required("GITHUB_CLIENT_ID"),
  GITHUB_CLIENT_SECRET: required("GITHUB_CLIENT_SECRET"),
  GOOGLE_CLIENT_ID: required("GOOGLE_CLIENT_ID"),
  GOOGLE_CLIENT_SECRET: required("GOOGLE_CLIENT_SECRET"),
  CREDIT_IDENTITY_KEY: required("CREDIT_IDENTITY_KEY").min(
    32,
    "CREDIT_IDENTITY_KEY must be at least 32 characters",
  ),
  RESEND_API_KEY: required("RESEND_API_KEY"),
  AUTH_EMAIL_FROM: required("AUTH_EMAIL_FROM"),
  TURNSTILE_SECRET_KEY: required("TURNSTILE_SECRET_KEY"),
  TURNSTILE_SITE_KEY: required("TURNSTILE_SITE_KEY"),
});

export type AuthEnv = z.infer<typeof authSchema>;

// Upstash Redis over TCP/TLS (not its REST URL): auth storage, rate limits,
// Generation locks, Stop signals and resumable-stream pub/sub (ADR 0004).
const redisSchema = z
  .object({
    REDIS_URL: required("REDIS_URL").regex(
      /^rediss?:\/\/.+/,
      "REDIS_URL must be a redis:// or rediss:// URL",
    ),
  })
  .transform((value) => value.REDIS_URL);

// The Platform key: the OpenRouter key that serves Replies paid with Credits.
const platformKeySchema = z
  .object({ OPENROUTER_API_KEY: required("OPENROUTER_API_KEY") })
  .transform((value) => value.OPENROUTER_API_KEY);

export class EnvError extends Error {
  constructor(issues: readonly z.core.$ZodIssue[]) {
    const lines = issues.map((issue) => `  - ${issue.message}`);
    super(`Invalid environment configuration:\n${lines.join("\n")}`);
    this.name = "EnvError";
  }
}

/**
 * A reader for one concern's variables. Called with a source it parses that
 * source; called with none it parses process.env on first use and caches the
 * result. Nothing is read until a caller needs it, so a route that does not use
 * a concern works without its variables (and `next build` needs no secrets).
 */
function concern<T extends z.ZodType>(schema: T) {
  let cached: z.output<T> | undefined;
  return (source?: EnvSource): z.output<T> => {
    const parse = (from: EnvSource) => {
      const result = schema.safeParse(from);
      if (!result.success) throw new EnvError(result.error.issues);
      return result.data as z.output<T>;
    };
    if (source) return parse(source);
    cached ??= parse(process.env);
    return cached;
  };
}

/** DATABASE_URL, for the database client and the migration runner. */
export const databaseUrl = concern(
  databaseSchema.transform((value) => value.DATABASE_URL),
);

/** Better Auth, OAuth, Resend, Turnstile and the Credit identity key. */
export const authEnv = concern(authSchema);

/** REDIS_URL, for lib/redis.ts. */
export const redisUrl = concern(redisSchema);

/** OPENROUTER_API_KEY, for Replies paid with Credits. */
export const platformKey = concern(platformKeySchema);

/** The BYOK keyring, for lib/byok/crypto.ts. */
export const byokKeyring = concern(byokSchema);

/** Exact HTTP(S) origins shared by mutation protection and Better Auth. */
const origin = z
  .string()
  .trim()
  .refine((value) => {
    try {
      const url = new URL(value);
      return ["http:", "https:"].includes(url.protocol) && url.origin === value;
    } catch {
      return false;
    }
  }, "APP_ORIGINS entries must be exact HTTP(S) origins");

export const appOrigins = concern(
  z
    .object({
      BETTER_AUTH_URL: required("BETTER_AUTH_URL").pipe(z.url()),
      APP_ORIGINS: z.string().optional(),
      VERCEL_ENV: z.enum(["production", "preview", "development"]).optional(),
      VERCEL_URL: z.string().optional(),
      VERCEL_BRANCH_URL: z.string().optional(),
    })
    .transform((value) => [
      new URL(value.BETTER_AUTH_URL).origin,
      ...(value.APP_ORIGINS
        ? value.APP_ORIGINS.split(",").map((entry) => entry.trim())
        : []),
      ...(value.VERCEL_ENV === "preview"
        ? [value.VERCEL_URL, value.VERCEL_BRANCH_URL]
            .filter((host): host is string => !!host)
            .map((host) => `https://${host}`)
        : []),
    ])
    .pipe(z.array(origin))
    .transform((origins) => [...new Set(origins)]),
);

/** Optional disposable Redis instance for opt-in integration tests. */
export const redisTestUrl = concern(
  z
    .object({
      REDIS_TEST_URL: required("REDIS_TEST_URL").regex(
        /^rediss?:\/\/.+/,
        "REDIS_TEST_URL must be a Redis URL",
      ),
    })
    .transform((value) => value.REDIS_TEST_URL),
);

// Runtime source is intentional: Next replaces direct NODE_ENV reads at build time.
const e2eSchema = z
  .object({
    GALAXY_TEST_E2E: z.enum(["1"]).optional(),
    NODE_ENV: z.string().optional(),
    VERCEL: z.string().optional(),
    VERCEL_ENV: z.string().optional(),
  })
  .superRefine((value, ctx) => {
    if (
      value.GALAXY_TEST_E2E &&
      (value.NODE_ENV !== "test" || value.VERCEL || value.VERCEL_ENV)
    ) {
      ctx.addIssue({
        code: "custom",
        message:
          "GALAXY_TEST_E2E requires NODE_ENV=test and cannot run on Vercel",
      });
    }
  })
  .transform((value) => value.GALAXY_TEST_E2E === "1");

/** Test-only auth and model seams; never enabled in production. */
export const testE2eEnabled = concern(e2eSchema);
