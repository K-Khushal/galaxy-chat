import { eq } from "drizzle-orm";
import { isInvitedLogin, resolveAuthConfig } from "@/lib/auth/env";
import { getAuth } from "@/lib/auth/server";
import { getDb } from "@/lib/db/client";
import { session as sessionTable } from "@/lib/db/schema";
import { AppError, logErrorId } from "@/lib/errors";

export type ChatAccess = {
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
    const db = getDb();
    if (!db) {
      return;
    }
    await db.delete(sessionTable).where(eq(sessionTable.token, token));
  } catch {
    logErrorId("session_revoke_failed");
  }
}

export async function requireChatAccess(headers: Headers): Promise<ChatAccess> {
  const config = resolveAuthConfig(process.env);
  if (!config) {
    throw new AppError("auth_unconfigured", 503);
  }
  const auth = getAuth();
  if (!auth) {
    throw new AppError("auth_unconfigured", 503);
  }
  const session = await auth.api.getSession({ headers });
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
  if (!isInvitedLogin(githubLogin, config.inviteLogins)) {
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

export function assertOwner(actorUserId: string, recordUserId: string) {
  if (actorUserId !== recordUserId) {
    throw new AppError("forbidden", 403);
  }
}
