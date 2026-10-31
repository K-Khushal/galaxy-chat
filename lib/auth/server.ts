import "server-only";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { betterAuth } from "better-auth/minimal";
import { nextCookies } from "better-auth/next-js";
import { eq } from "drizzle-orm";
import { isInvitedLogin } from "@/lib/auth/invite";
import { type Database, getDb } from "@/lib/db/client";
import { authSchema, user } from "@/lib/db/schema";
import { type Env, env } from "@/lib/env";

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
  return isInvitedLogin(login, env().GITHUB_INVITE_LOGINS);
}

function createAuth(config: Env, db: Database) {
  return betterAuth({
    baseURL: config.BETTER_AUTH_URL,
    secret: config.BETTER_AUTH_SECRET,
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
        // Better Auth shares provider-field parsing with browser profile edits.
        // Only the verified GitHub profile may set this authorization field.
        if (
          path === "/update-user" &&
          Object.hasOwn(ctx.body ?? {}, "githubLogin")
        ) {
          throw new APIError("FORBIDDEN", {
            message: "github_login_read_only",
          });
        }
      }),
    },
    socialProviders: {
      github: {
        clientId: config.GITHUB_CLIENT_ID,
        clientSecret: config.GITHUB_CLIENT_SECRET,
        // Refresh existing rows too, including accounts created before the
        // provider username was persisted correctly.
        overrideUserInfoOnSignIn: true,
        mapProfileToUser: (profile: { login?: string }) => ({
          githubLogin: profile.login ?? null,
        }),
      },
    },
    user: {
      validateUserInfo: ({ user: incoming, source }) => {
        const login = source.oauth?.profile?.login;
        if (
          source.method !== "oauth" ||
          source.oauth?.providerId !== "github" ||
          typeof login !== "string" ||
          incoming.githubLogin !== login ||
          !isInvitedLogin(login, config.GITHUB_INVITE_LOGINS)
        ) {
          return { error: "invite_required" };
        }
      },
      additionalFields: {
        githubLogin: {
          type: "string",
          required: false,
          // input:false also strips fields supplied by OAuth providers in
          // Better Auth 1.7. Browser writes are blocked in the hook above.
          input: true,
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

export function getAuth(): AuthInstance {
  cached ??= createAuth(env(), getDb());
  return cached;
}
