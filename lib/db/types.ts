import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type * as schema from "@/lib/db/schema";

/** Any Drizzle Postgres database with the app schema (postgres.js or PGlite). */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;
