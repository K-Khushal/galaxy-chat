import { readdirSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) {
  process.stderr.write(
    `${JSON.stringify({ level: "error", id: "persistence_unconfigured" })}\n`,
  );
  process.exit(1);
}

const sql = postgres(databaseUrl, { max: 1, prepare: false });

try {
  await sql`
    CREATE TABLE IF NOT EXISTS public.schema_migrations (
      version text PRIMARY KEY,
      applied_at timestamp NOT NULL DEFAULT now()
    )
  `;
  const directory = join(import.meta.dir, "../drizzle");
  const files = readdirSync(directory)
    .filter((name) => name.endsWith(".sql"))
    .sort();
  for (const file of files) {
    const version = file.replace(/\.sql$/, "");
    const applied = await sql<{ version: string }[]>`
      select version from public.schema_migrations where version = ${version}
    `;
    if (applied.length > 0) {
      continue;
    }
    await sql.file(join(directory, file));
    await sql`
      insert into public.schema_migrations (version)
      values (${version})
    `;
  }
  process.stdout.write("migrations applied\n");
} catch {
  process.stderr.write(
    `${JSON.stringify({ level: "error", id: "migration_failed" })}\n`,
  );
  process.exitCode = 1;
} finally {
  await sql.end();
}
