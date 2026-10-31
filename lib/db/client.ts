import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@/lib/db/schema";
import { databaseUrl } from "@/lib/env";

export type Database = ReturnType<typeof drizzle<typeof schema>>;

let database: Database | null = null;

/** Shared postgres.js client for the server process. */
export function getDb(): Database {
  if (!database) {
    const client = postgres(databaseUrl(), { prepare: false, max: 1 });
    database = drizzle(client, { schema });
  }
  return database;
}
