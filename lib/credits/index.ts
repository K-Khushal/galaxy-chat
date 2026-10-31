import { createHmac } from "node:crypto";
import { and, eq, gt, inArray, sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type * as schema from "@/lib/db/schema";
import { creditBalance, creditGrantIdentity } from "@/lib/db/schema";

/** Credits granted once, at sign-up (ADR 0003). */
export const SIGNUP_CREDITS = 10;

export type CreditsDb = PgDatabase<PgQueryResultHKT, typeof schema>;

export type GrantIdentity =
  | { kind: "email"; value: string }
  | { kind: "github" | "google"; value: string };

/**
 * Keyed hash of an identity that received Credits. Emails are normalised to
 * lower case. The key must stay stable: rotating it lets returning identities
 * receive Credits again.
 */
export function hashGrantIdentity(
  identity: GrantIdentity,
  key: string,
): string {
  const value =
    identity.kind === "email"
      ? identity.value.trim().toLowerCase()
      : identity.value;
  return createHmac("sha256", key)
    .update(`${identity.kind}:${value}`)
    .digest("hex");
}

/**
 * Creates the User's Credits row. Grants SIGNUP_CREDITS only when none of the
 * identity hashes has received Credits before; otherwise the row starts at 0.
 * Idempotent per User. Returns the number of Credits granted.
 */
export async function grantSignupCredits(
  db: CreditsDb,
  userId: string,
  identityHashes: string[],
): Promise<number> {
  return db.transaction(async (tx) => {
    const existing = await tx
      .select({ userId: creditBalance.userId })
      .from(creditBalance)
      .where(eq(creditBalance.userId, userId));
    if (existing.length > 0) {
      return 0;
    }
    const seen =
      identityHashes.length === 0
        ? []
        : await tx
            .select({ hash: creditGrantIdentity.identityHash })
            .from(creditGrantIdentity)
            .where(inArray(creditGrantIdentity.identityHash, identityHashes));
    const granted =
      identityHashes.length > 0 && seen.length === 0 ? SIGNUP_CREDITS : 0;
    if (identityHashes.length > 0) {
      await tx
        .insert(creditGrantIdentity)
        .values(identityHashes.map((identityHash) => ({ identityHash })))
        .onConflictDoNothing();
    }
    await tx
      .insert(creditBalance)
      .values({ userId, remaining: granted })
      .onConflictDoNothing();
    return granted;
  });
}

/** Remaining Credits; 0 when the User has no Credits row. */
export async function getCredits(
  db: CreditsDb,
  userId: string,
): Promise<number> {
  const rows = await db
    .select({ remaining: creditBalance.remaining })
    .from(creditBalance)
    .where(eq(creditBalance.userId, userId));
  return rows[0]?.remaining ?? 0;
}

/** Atomically spends one credit. Returns false when none remain. */
export async function spendCredit(
  db: CreditsDb,
  userId: string,
): Promise<boolean> {
  const rows = await db
    .update(creditBalance)
    .set({
      remaining: sql`${creditBalance.remaining} - 1`,
      updatedAt: new Date(),
    })
    .where(
      and(eq(creditBalance.userId, userId), gt(creditBalance.remaining, 0)),
    )
    .returning({ remaining: creditBalance.remaining });
  return rows.length > 0;
}

/**
 * Returns one credit taken by spendCredit, e.g. when a Generation fails before
 * its first token. Call at most once per spend.
 */
export async function refundCredit(
  db: CreditsDb,
  userId: string,
): Promise<void> {
  await db
    .update(creditBalance)
    .set({
      remaining: sql`${creditBalance.remaining} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(creditBalance.userId, userId));
}
