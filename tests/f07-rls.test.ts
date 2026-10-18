import { afterAll, beforeAll, describe, expect, test } from "bun:test";

const fixtureSetupTimeout = 15_000;

describe("F07 database browser roles cannot read or mutate BYOK ciphertext or resource rows", () => {
  let database: import("@electric-sql/pglite").PGlite | undefined;

  beforeAll(
    async () => {
      const { PGlite } = await import("@electric-sql/pglite");
      const { readFileSync, readdirSync } = await import("node:fs");
      database = await PGlite.create();
      await database.exec("CREATE ROLE anon; CREATE ROLE authenticated;");
      for (const file of readdirSync("drizzle")
        .filter((name) => name.endsWith(".sql"))
        .sort())
        await database.exec(readFileSync(`drizzle/${file}`, "utf8"));
    },
    { timeout: fixtureSetupTimeout },
  );

  afterAll(
    async () => {
      await database?.close();
    },
    { timeout: fixtureSetupTimeout },
  );

  test("behavior", async () => {
    if (!database) throw new Error("fixture_database_missing");
    const grants = await database.query<{ allowed: boolean }>(
      "SELECT has_table_privilege('anon','provider_credential','SELECT') OR has_table_privilege('authenticated','provider_credential','INSERT') OR has_table_privilege('anon','byok_operation','UPDATE') OR has_table_privilege('authenticated','byok_operation','DELETE') AS allowed",
    );
    expect(grants.rows[0].allowed).toBe(false);
    const rls = await database.query<{ relrowsecurity: boolean }>(
      "SELECT relrowsecurity FROM pg_class WHERE relname IN ('provider_credential','byok_operation')",
    );
    expect(rls.rows).toHaveLength(2);
    expect(rls.rows.every((row) => row.relrowsecurity)).toBe(true);
  });
});
