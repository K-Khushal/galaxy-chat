import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { betterAuth } from "better-auth/minimal";
import { nextCookies } from "better-auth/next-js";
import { resolveAuthConfig } from "@/lib/auth/env";
import { getDb } from "@/lib/db/client";
import { authSchema } from "@/lib/db/schema";

type ResolvedAuth = NonNullable<ReturnType<typeof resolveAuthConfig>>;
type Database = NonNullable<ReturnType<typeof getDb>>;

function createAuth(config: ResolvedAuth, db: Database) {
  return betterAuth({
    baseURL: config.baseUrl,
    secret: config.secret,
    emailAndPassword: { enabled: false },
    socialProviders: {
      github: {
        clientId: config.githubClientId,
        clientSecret: config.githubClientSecret,
        mapProfileToUser: (profile: { login?: string }) => ({
          githubLogin: profile.login ?? null,
        }),
      },
    },
    user: {
      additionalFields: {
        githubLogin: {
          type: "string",
          required: false,
          input: false,
        },
      },
    },
    database: drizzleAdapter(db, {
      provider: "pg",
      schema: authSchema,
    }),
    plugins: [nextCookies()],
  });
}

type AuthInstance = ReturnType<typeof createAuth>;

let cached: AuthInstance | null = null;

export function getAuth(): AuthInstance | null {
  const config = resolveAuthConfig(process.env);
  if (!config) {
    return null;
  }
  if (cached) {
    return cached;
  }
  const db = getDb();
  if (!db) {
    return null;
  }
  cached = createAuth(config, db);
  return cached;
}
