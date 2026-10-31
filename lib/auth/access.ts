import { eq } from "drizzle-orm";
import { isInvitedLogin } from "@/lib/auth/invite";
import { getAuth } from "@/lib/auth/server";
import { getDb } from "@/lib/db/client";
import { session as sessionTable } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { AppError, logErrorId } from "@/lib/errors";

export type Access = {
  userId: string;
  name: string;
  email: string;
  image?: string;
  githubLogin: string;
};

type SessionUser = {
  id: string;
  name: string;
  email: string;
  image?: string | null;
  githubLogin?: string | null;
};

async function revokeSessionToken(token: string) {
  try {
    await getDb().delete(sessionTable).where(eq(sessionTable.token, token));
  } catch {
    logErrorId("session_revoke_failed");
  }
}

/** Resolves the invited user behind a request, or throws a 401/403 AppError. */
export async function requireAccess(headers: Headers): Promise<Access> {
  const session = await getAuth().api.getSession({ headers });
  if (!session?.user || !session.session) {
    throw new AppError("unauthenticated", 401);
  }
  const expiresAt = new Date(session.session.expiresAt);
  if (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() <= Date.now()) {
    await revokeSessionToken(session.session.token);
    throw new AppError("unauthenticated", 401);
  }
  const user = session.user as SessionUser;
  const githubLogin =
    typeof user.githubLogin === "string" ? user.githubLogin : null;
  if (!isInvitedLogin(githubLogin, env().GITHUB_INVITE_LOGINS)) {
    await revokeSessionToken(session.session.token);
    throw new AppError("invite_required", 403);
  }
  return {
    userId: user.id,
    name: user.name,
    email: user.email,
    image: user.image ?? undefined,
    githubLogin: githubLogin ?? "",
  };
}
