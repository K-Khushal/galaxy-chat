import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadEnvConfig } from "@next/env";
import postgres from "postgres";
import {
  applyVersionedMigrations,
  type MigrationExecutor,
} from "../lib/db/migrate";

// Match next dev by default; operators can explicitly select production.
// Run with Bun's automatic env loading disabled so Next's precedence wins.
loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production");

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) {
  process.stderr.write(
    `${JSON.stringify({ level: "error", id: "persistence_unconfigured" })}\n`,
  );
  process.exit(1);
}

const sql = postgres(databaseUrl, { max: 1, prepare: false });

const executor: MigrationExecutor = {
  transaction: (run) =>
    sql.begin(async (tx) => {
      await run({
        appliedVersions: async () => {
          const rows = await tx<{ version: string }[]>`
            select version from public.schema_migrations
          `;
          return rows.map((row) => row.version);
        },
        applySql: async (sqlText) => {
          await tx.unsafe(sqlText);
        },
        ensureMigrationsTable: async () => {
          await tx`
            CREATE TABLE IF NOT EXISTS public.schema_migrations (
              version text PRIMARY KEY,
              applied_at timestamp NOT NULL DEFAULT now()
            )
          `;
        },
        lock: async () => {
          await tx.unsafe("select pg_advisory_xact_lock(41021401)");
        },
        recordVersion: async (version) => {
          await tx`
            insert into public.schema_migrations (version)
            values (${version})
          `;
        },
      });
    }),
};

try {
  const directory = join(import.meta.dir, "../drizzle");
  const migrations = readdirSync(directory)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .map((name) => ({
      sql: readFileSync(join(directory, name), "utf8"),
      version: name.replace(/\.sql$/, ""),
    }));
  await applyVersionedMigrations(executor, migrations);
  process.stdout.write("migrations applied\n");
} catch {
  process.stderr.write(
    `${JSON.stringify({ level: "error", id: "migration_failed" })}\n`,
  );
  process.exitCode = 1;
} finally {
  await sql.end();
}
