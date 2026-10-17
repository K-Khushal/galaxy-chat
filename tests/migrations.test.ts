import { expect, test } from "bun:test";
import {
  applyVersionedMigrations,
  type MigrationExecutor,
  type MigrationFile,
  type MigrationWork,
} from "../lib/db/migrate";

type MigrationRuntime = {
  events: () => string[];
  executor: () => MigrationExecutor;
  failSql: Set<string>;
  versions: () => string[];
};

function createMigrationRuntime(): MigrationRuntime {
  const applied = new Set<string>();
  const failSql = new Set<string>();
  const events: string[] = [];
  let locked = false;
  const waiters: Array<() => void> = [];

  const executor = (): MigrationExecutor => ({
    transaction: async (run) => {
      events.push("begin");
      const staged: string[] = [];
      let acquired = false;
      const work: MigrationWork = {
        appliedVersions: async () => {
          if (!acquired) {
            throw new Error("ledger read before transaction lock");
          }
          events.push("read-ledger");
          return [...applied];
        },
        applySql: async (sqlText) => {
          if (!acquired) {
            throw new Error("sql before transaction lock");
          }
          await new Promise((resolve) => {
            setTimeout(resolve, 20);
          });
          events.push(`sql:${sqlText}`);
          if (failSql.has(sqlText)) {
            throw new Error("migration sql failed");
          }
        },
        ensureMigrationsTable: async () => {
          if (!acquired) {
            throw new Error("ledger create before transaction lock");
          }
          events.push("ensure-ledger");
        },
        lock: async () => {
          if (locked) {
            events.push("wait-xact-lock");
            await new Promise<void>((resolve) => {
              waiters.push(resolve);
            });
          } else {
            locked = true;
          }
          acquired = true;
          events.push("xact-lock");
        },
        recordVersion: async (version) => {
          if (!acquired) {
            throw new Error("version record before transaction lock");
          }
          staged.push(version);
          events.push(`stage:${version}`);
        },
      };
      try {
        await run(work);
        for (const version of staged) {
          applied.add(version);
        }
        events.push("commit");
      } catch (error) {
        events.push("rollback");
        throw error;
      } finally {
        if (acquired) {
          acquired = false;
          const next = waiters.shift();
          if (next) {
            next();
          } else {
            locked = false;
          }
        }
      }
    },
  });

  return {
    events: () => [...events],
    executor,
    failSql,
    versions: () => [...applied],
  };
}

const migrations: MigrationFile[] = [
  { sql: "create-one", version: "0000" },
  { sql: "create-two", version: "0001" },
];

test("pending files and ledger rows commit or roll back as one transaction", async () => {
  const runtime = createMigrationRuntime();
  runtime.failSql.add("create-two");
  await expect(
    applyVersionedMigrations(runtime.executor(), migrations),
  ).rejects.toThrow("migration sql failed");
  expect(runtime.versions()).toEqual([]);
  expect(runtime.events()).toEqual([
    "begin",
    "xact-lock",
    "ensure-ledger",
    "read-ledger",
    "sql:create-one",
    "stage:0000",
    "sql:create-two",
    "rollback",
  ]);

  runtime.failSql.delete("create-two");
  await applyVersionedMigrations(runtime.executor(), migrations);
  expect(runtime.versions()).toEqual(["0000", "0001"]);
});

test("a transaction lock serializes runners and the second sees the committed ledger", async () => {
  const runtime = createMigrationRuntime();
  await Promise.all([
    applyVersionedMigrations(runtime.executor(), migrations),
    applyVersionedMigrations(runtime.executor(), migrations),
  ]);
  expect(runtime.versions()).toEqual(["0000", "0001"]);
  const events = runtime.events();
  const firstCommit = events.indexOf("commit");
  const secondLock = events.indexOf("xact-lock", firstCommit);
  expect(firstCommit).toBeGreaterThan(-1);
  expect(secondLock).toBeGreaterThan(firstCommit);
  expect(events.filter((event) => event === "sql:create-one")).toEqual([
    "sql:create-one",
  ]);
  expect(events.filter((event) => event === "sql:create-two")).toEqual([
    "sql:create-two",
  ]);
});
