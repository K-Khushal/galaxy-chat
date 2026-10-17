import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { betterAuth } from "better-auth/minimal";
import { nextCookies } from "better-auth/next-js";
import { eq } from "drizzle-orm";
import {
  isInvitedLogin,
  parseInviteLogins,
  resolveAuthConfig,
} from "@/lib/auth/env";
import { getDb } from "@/lib/db/client";
import { authSchema, user } from "@/lib/db/schema";

type ResolvedAuth = NonNullable<ReturnType<typeof resolveAuthConfig>>;
type Database = NonNullable<ReturnType<typeof getDb>>;

const BLOCKED_AUTH_PATHS = new Set([
  "/change-password",
  "/forget-password",
  "/magic-link/verify",
  "/request-password-reset",
  "/reset-password",
  "/sign-in/email",
  "/sign-in/magic-link",
  "/sign-in/username",
  "/sign-up/email",
  "/sign-up/username",
]);

async function invitedUser(db: Database, userId: string) {
  const rows = await db
    .select({ githubLogin: user.githubLogin })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);
  const login = rows[0]?.githubLogin;
  return isInvitedLogin(
    login,
    parseInviteLogins(process.env.GITHUB_INVITE_LOGINS),
  );
}

function createAuth(config: ResolvedAuth, db: Database) {
  return betterAuth({
    baseURL: config.baseUrl,
    secret: config.secret,
    databaseHooks: {
      session: {
        create: {
          before: async (session) => {
            const userId = session.userId;
            if (typeof userId !== "string" || userId.length === 0) {
              return false;
            }
            try {
              const allowed = await invitedUser(db, userId);
              if (!allowed) {
                return false;
              }
            } catch {
              return false;
            }
            return { data: session };
          },
        },
      },
    },
    emailAndPassword: { enabled: false },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        const path = ctx.path.split("?")[0] ?? ctx.path;
        if (BLOCKED_AUTH_PATHS.has(path)) {
          throw new APIError("FORBIDDEN", { message: "invite_required" });
        }
      }),
    },
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

export function resetAuthCache() {
  cached = null;
}

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
