import "server-only";
import { eq } from "drizzle-orm";
import { openKey, sealKey } from "@/lib/byok/crypto";
import { byokKey } from "@/lib/db/schema";
import type { Db } from "@/lib/db/types";
import type { EnvSource } from "@/lib/env";
import { AppError } from "@/lib/errors";

const PROVIDER = "openrouter" as const;

/** What the client may know about a saved key: never the key itself. */
export type ByokKeyStatus = {
  provider: typeof PROVIDER;
  updatedAt: string;
} | null;

export async function getByokKeyStatus(
  db: Db,
  userId: string,
): Promise<ByokKeyStatus> {
  const rows = await db
    .select({ updatedAt: byokKey.updatedAt })
    .from(byokKey)
    .where(eq(byokKey.userId, userId));
  const row = rows[0];
  return row
    ? { provider: PROVIDER, updatedAt: row.updatedAt.toISOString() }
    : null;
}

/** Saves or replaces the User's OpenRouter key, sealed under a new revision. */
export async function saveByokKey(
  db: Db,
  env: EnvSource,
  userId: string,
  key: string,
): Promise<void> {
  const revision = crypto.randomUUID();
  const sealed = sealKey(key, { userId, provider: PROVIDER, revision }, env);
  const now = new Date();
  const values = { provider: PROVIDER, revision, ...sealed, updatedAt: now };
  await db
    .insert(byokKey)
    .values({ userId, ...values })
    .onConflictDoUpdate({ target: byokKey.userId, set: values });
}

/** The decrypted key, or null when the User has none. Server use only. */
export async function loadByokKey(
  db: Db,
  env: EnvSource,
  userId: string,
): Promise<string | null> {
  const rows = await db
    .select()
    .from(byokKey)
    .where(eq(byokKey.userId, userId));
  const row = rows[0];
  if (!row) return null;
  return openKey(
    {
      keyVersion: row.keyVersion,
      nonce: row.nonce,
      ciphertext: row.ciphertext,
    },
    { userId, provider: row.provider, revision: row.revision },
    env,
  );
}

export async function deleteByokKey(db: Db, userId: string) {
  const rows = await db
    .delete(byokKey)
    .where(eq(byokKey.userId, userId))
    .returning({ userId: byokKey.userId });
  return rows.length > 0;
}

/**
 * Asks OpenRouter whether a key is valid. True for a working key, false for a
 * rejected one; throws when OpenRouter cannot answer.
 */
export async function testOpenRouterKey(
  key: string,
  fetcher: typeof fetch = fetch,
): Promise<boolean> {
  let response: Response;
  try {
    response = await fetcher("https://openrouter.ai/api/v1/key", {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new AppError("byok_test_unavailable", 502);
  }
  if (response.ok) return true;
  if (response.status === 401 || response.status === 403) return false;
  throw new AppError("byok_test_unavailable", 502);
}
