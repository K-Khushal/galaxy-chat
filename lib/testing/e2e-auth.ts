import "server-only";
import { and, eq, gt } from "drizzle-orm";
import type { Access } from "@/lib/auth/access";
import { getDb } from "@/lib/db/client";
import { session, user } from "@/lib/db/schema";
import { AppError } from "@/lib/errors";

/** Opaque random token, looked up in the real session table. */
export async function e2eAccess(headers: Headers): Promise<Access> {
  const token = headers
    .get("cookie")
    ?.split("; ")
    .find((v) => v.startsWith("galaxy-e2e="))
    ?.slice(11);
  if (!token) throw new AppError("unauthenticated", 401);
  const [row] = await getDb()
    .select()
    .from(session)
    .innerJoin(user, eq(session.userId, user.id))
    .where(and(eq(session.token, token), gt(session.expiresAt, new Date())));
  if (!row) throw new AppError("unauthenticated", 401);
  return {
    userId: row.user.id,
    name: row.user.name,
    email: row.user.email,
    sessionCreatedAt: row.session.createdAt,
  };
}
