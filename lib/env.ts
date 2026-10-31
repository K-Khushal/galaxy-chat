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
  // Read and validated by lib/byok/crypto.ts when a key is sealed or opened.
  BYOK_ENCRYPTION_KEYS_JSON: z.string().optional(),
  BYOK_ACTIVE_KEY_VERSION: z.string().optional(),
  GOOGLE_CLIENT_ID: required("GOOGLE_CLIENT_ID"),
  GOOGLE_CLIENT_SECRET: required("GOOGLE_CLIENT_SECRET"),
  CREDIT_IDENTITY_KEY: required("CREDIT_IDENTITY_KEY").min(32),
  RESEND_API_KEY: required("RESEND_API_KEY"),
  AUTH_EMAIL_FROM: required("AUTH_EMAIL_FROM"),
  UPSTASH_REDIS_REST_URL: required("UPSTASH_REDIS_REST_URL").pipe(z.url()),
  UPSTASH_REDIS_REST_TOKEN: required("UPSTASH_REDIS_REST_TOKEN"),
  TURNSTILE_SECRET_KEY: required("TURNSTILE_SECRET_KEY"),
  TURNSTILE_SITE_KEY: required("TURNSTILE_SITE_KEY"),
});

export type Env = z.infer<typeof envSchema>;

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
  return parse(envSchema, source);
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
