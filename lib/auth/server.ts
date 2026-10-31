import "server-only";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { betterAuth } from "better-auth/minimal";
import { nextCookies } from "better-auth/next-js";
import { emailOTP } from "better-auth/plugins";
import { eq } from "drizzle-orm";
import { protectEmailCode } from "@/lib/auth/abuse";
import { authServices } from "@/lib/auth/services";
import {
  type GrantIdentity,
  grantSignupCredits,
  hashGrantIdentity,
} from "@/lib/credits";
import { type Database, getDb } from "@/lib/db/client";
import { account, authSchema, user } from "@/lib/db/schema";
import { type AuthEnv, authEnv } from "@/lib/env";

export function createAuth(
  config: AuthEnv,
  db: Database,
  services = authServices(config),
) {
  async function grant(userId: string, extra?: GrantIdentity) {
    const [u] = await db.select().from(user).where(eq(user.id, userId));
    if (!u?.emailVerified) return;
    const accounts = await db
      .select()
      .from(account)
      .where(eq(account.userId, userId));
    const identities: GrantIdentity[] = [{ kind: "email", value: u.email }];
    for (const a of accounts)
      if (a.providerId === "github" || a.providerId === "google")
        identities.push({ kind: a.providerId, value: a.accountId });
    if (extra) identities.push(extra);
    await grantSignupCredits(db, userId, [
      ...new Set(
        identities.map((identity) =>
          hashGrantIdentity(identity, config.CREDIT_IDENTITY_KEY),
        ),
      ),
    ]);
  }
  return betterAuth({
    baseURL: config.BETTER_AUTH_URL,
    secret: config.BETTER_AUTH_SECRET,
    database: drizzleAdapter(db, { provider: "pg", schema: authSchema }),
    emailAndPassword: { enabled: false },
    secondaryStorage: services.secondaryStorage,
    session: { storeSessionInDatabase: true },
    rateLimit: { enabled: true, storage: "secondary-storage" },
    account: {
      accountLinking: {
        enabled: true,
        trustedProviders: [],
        requireLocalEmailVerified: true,
      },
    },
    databaseHooks: {
      session: {
        create: {
          before: async (session) => {
            await grant(session.userId);
            return { data: session };
          },
        },
      },
      user: {
        create: {
          after: async (u, ctx) => {
            // OAuth must wait for account insertion so provider IDs participate.
            if (ctx?.path === "/sign-in/email-otp") await grant(u.id);
          },
        },
        update: {
          after: async (u, ctx) => {
            if (
              !ctx?.path?.startsWith("/callback/") &&
              ctx?.path !== "/sign-in/social"
            )
              await grant(u.id);
          },
        },
      },
      account: {
        create: {
          after: async (a) => {
            await grant(
              a.userId,
              a.providerId === "github" || a.providerId === "google"
                ? { kind: a.providerId, value: a.accountId }
                : undefined,
            );
          },
        },
      },
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (
          ctx.path.includes("password") ||
          (ctx.path === "/email-otp/send-verification-otp" &&
            ctx.body.type !== "sign-in")
        ) {
          throw new APIError("FORBIDDEN", {
            message: "Use a sign-in code or OAuth.",
          });
        }
        if (ctx.path === "/email-otp/send-verification-otp") {
          try {
            await protectEmailCode(
              ctx.body.email,
              ctx.headers?.get("x-real-ip") ?? "unknown",
              ctx.headers?.get("x-turnstile-token") ?? "",
              services.protection,
            );
          } catch (error) {
            throw new APIError(
              error instanceof Error && error.message === "rate_limited"
                ? "TOO_MANY_REQUESTS"
                : "BAD_REQUEST",
              {
                message:
                  "Unable to send code. Check verification or try again later.",
              },
            );
          }
        }
      }),
    },
    socialProviders: {
      github: {
        clientId: config.GITHUB_CLIENT_ID,
        clientSecret: config.GITHUB_CLIENT_SECRET,
      },
      google: {
        clientId: config.GOOGLE_CLIENT_ID,
        clientSecret: config.GOOGLE_CLIENT_SECRET,
      },
    },
    plugins: [
      emailOTP({
        otpLength: 6,
        expiresIn: 300,
        storeOTP: "hashed",
        sendVerificationOTP: async ({ email, otp }) =>
          services.sendCode(email, otp),
      }),
      nextCookies(),
    ],
  });
}
let cached: ReturnType<typeof createAuth> | null = null;
export function getAuth() {
  cached ??= createAuth(authEnv(), getDb());
  return cached;
}
