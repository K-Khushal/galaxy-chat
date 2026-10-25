import { expect, test } from "bun:test";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";

test("migration CLI loads Next env precedence and creates OAuth tables idempotently", async () => {
  const directory = mkdtempSync(join(tmpdir(), "galaxy-migrate-"));
  const database = await PGlite.create();
  const socket = new PGLiteSocketServer({
    db: database,
    host: "127.0.0.1",
    port: 0,
    maxConnections: 1,
  });
  try {
    await socket.start();
    const url = `postgres://postgres:postgres@${socket.getServerConn()}/postgres`;
    // .env.local must override .env, just as it does in next dev.
    writeFileSync(
      join(directory, ".env"),
      "DATABASE_URL=postgres://invalid:1/db\n",
    );
    writeFileSync(join(directory, ".env.local"), `DATABASE_URL=${url}\n`);
    const env: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: "development" };
    delete env.DATABASE_URL;
    const script = resolve("scripts/db-migrate.ts");
    for (let attempt = 0; attempt < 2; attempt++) {
      const child = Bun.spawn([process.execPath, "--no-env-file", script], {
        cwd: directory,
        env,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [code, stdout, stderr] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ]);
      expect({ code, stderr }).toEqual({ code: 0, stderr: "" });
      expect(stdout).toContain("migrations applied");
    }
    const versions = await database.query(
      "select version from schema_migrations order by version",
    );
    expect(versions.rows).toEqual(
      readdirSync(resolve("drizzle"))
        .filter((name) => name.endsWith(".sql"))
        .sort()
        .map((name) => ({ version: name.replace(/\.sql$/, "") })),
    );
    // The exact insert which failed during sign-in, without calling GitHub.
    const inserted = await database.query(
      `insert into verification (id, identifier, value, expires_at, created_at, updated_at)
       values ('test-state', 'auth-state:test', '{}', now() + interval '10 minutes', now(), now())
       returning id, identifier, value, expires_at, created_at, updated_at`,
    );
    expect(inserted.rows).toHaveLength(1);
  } finally {
    await socket.stop();
    await database.close();
    rmSync(directory, { recursive: true, force: true });
  }
}, 15000);
