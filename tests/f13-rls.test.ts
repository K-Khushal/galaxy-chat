import { afterAll, beforeAll, describe, expect, test } from "bun:test";

const fixtureSetupTimeout = 15_000;

describe("F13 all private and anonymous tool tables revoke browser roles and enable RLS", () => {
  let database: import("@electric-sql/pglite").PGlite | undefined;

  beforeAll(
    async () => {
      const { PGlite } = await import("@electric-sql/pglite");
      const { readFileSync, readdirSync } = await import("node:fs");
      database = await PGlite.create();
      await database.exec("CREATE ROLE anon;CREATE ROLE authenticated;");
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
    for (const table of [
      "tool_run",
      "tool_step",
      "tool_call",
      "tool_approval",
      "search_credential",
    ]) {
      const grants = await database.query<{ allowed: boolean }>(
        "SELECT has_table_privilege('anon',$1,'SELECT') OR has_table_privilege('authenticated',$1,'INSERT') OR has_table_privilege('anon',$1,'UPDATE') OR has_table_privilege('authenticated',$1,'DELETE') AS allowed",
        [table],
      );
      expect(grants.rows[0].allowed).toBe(false);
      const rls = await database.query<{ relrowsecurity: boolean }>(
        "SELECT relrowsecurity FROM pg_class WHERE relname=$1",
        [table],
      );
      expect(rls.rows[0].relrowsecurity).toBe(true);
    }
  });
});
