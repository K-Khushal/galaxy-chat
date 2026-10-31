import "server-only";
import { eq } from "drizzle-orm";
import { getAuth } from "@/lib/auth/server";
import { getDb } from "@/lib/db/client";
import { session as sessionTable } from "@/lib/db/schema";
import { AppError, logErrorId } from "@/lib/errors";

export type Access = {
  sessionCreatedAt: Date;
  userId: string;
  name: string;
  email: string;
  image?: string;
};

type SessionUser = {
  id: string;
  name: string;
  email: string;
  image?: string | null;
};

async function revokeSessionToken(token: string) {
  try {
    await getDb().delete(sessionTable).where(eq(sessionTable.token, token));
  } catch {
    logErrorId("session_revoke_failed");
  }
}

/** Resolves the user behind a request, or throws a 401/403 AppError. */
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
  return {
    sessionCreatedAt: new Date(session.session.createdAt),
    userId: user.id,
    name: user.name,
    email: user.email,
    image: user.image ?? undefined,
  };
}
