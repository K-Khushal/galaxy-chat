import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@/lib/db/schema";
import { AppError } from "@/lib/errors";

export type Database = ReturnType<typeof drizzle<typeof schema>>;
export type DatabaseTransaction = Parameters<
  Parameters<Database["transaction"]>[0]
>[0];
export type EntryValidation = (tx: DatabaseTransaction) => Promise<void>;

let database: Database | null = null;
let client: ReturnType<typeof postgres> | null = null;

/**
 * postgres.js speaks Postgres over TCP and uses the Workers socket API on
 * workerd. OpenNext still needs nodejs_compat because Better Auth uses
 * AsyncLocalStorage. This client is the Supabase Postgres role in
 * DATABASE_URL, not a Supabase Auth session.
 */
export function getDb(): Database | null {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    return null;
  }
  if (!database || !client) {
    client = postgres(url, { prepare: false, max: 1 });
    database = drizzle(client, { schema });
  }
  return database;
}

export function requireDb() {
  const db = getDb();
  if (!db) {
    throw new AppError("persistence_unconfigured", 503);
  }
  return db;
}

export async function closeDb() {
  const current = client;
  client = null;
  database = null;
  if (current) {
    await current.end({ timeout: 1 });
  }
}
