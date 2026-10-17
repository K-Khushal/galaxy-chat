export type MigrationFile = {
  sql: string;
  version: string;
};

export type MigrationWork = {
  appliedVersions: () => Promise<string[]>;
  applySql: (sqlText: string) => Promise<void>;
  ensureMigrationsTable: () => Promise<void>;
  lock: () => Promise<void>;
  recordVersion: (version: string) => Promise<void>;
};

export type MigrationExecutor = {
  transaction: (run: (work: MigrationWork) => Promise<void>) => Promise<void>;
};

export async function applyVersionedMigrations(
  executor: MigrationExecutor,
  migrations: MigrationFile[],
): Promise<void> {
  await executor.transaction(async (work) => {
    await work.lock();
    await work.ensureMigrationsTable();
    const applied = new Set(await work.appliedVersions());
    for (const migration of migrations) {
      if (applied.has(migration.version)) {
        continue;
      }
      await work.applySql(migration.sql);
      await work.recordVersion(migration.version);
    }
  });
}
