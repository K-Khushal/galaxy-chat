import { onTestFinished } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { setImmediate } from "node:timers/promises";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import type { EnvSource } from "../../lib/auth/env";
import type { FundingConfig } from "../../lib/credits/config";
import type { Actor, CreditStore } from "../../lib/credits/store";
import * as schema from "../../lib/db/schema";

type FixtureOptions = {
  actor: () => Actor;
  config: () => FundingConfig;
  digest: string;
  env?: () => EnvSource;
  skipPlanRegistration?: boolean;
};
export type CreditFixture = Awaited<ReturnType<typeof createCreditFixture>>;
export async function createCreditFixture(options: FixtureOptions) {
  const database = await PGlite.create();
  let socket: PGLiteSocketServer | undefined;
  let client: ReturnType<typeof postgres> | undefined;
  let closing: Promise<void> | undefined;
  const close = () => {
    if (closing) return closing;
    closing = (async () => {
      await client?.end({ timeout: 1 });
      // Socket server stop() does not await handler.detach(). Let close handlers
      // enqueue any rollback before draining the engine and disposing its WASM.
      await setImmediate();
      await socket?.stop();
      await setImmediate();
      await database.runExclusive(async () => {});
      await database.close();
    })();
    return closing;
  };
  try {
    for (const name of readdirSync("drizzle")
      .filter((name) => name.endsWith(".sql"))
      .sort())
      await database.exec(readFileSync(`drizzle/${name}`, "utf8"));
    socket = new PGLiteSocketServer({
      db: database,
      host: "127.0.0.1",
      port: 0,
      // PGlite has one PostgreSQL session. Multiplexing freshly opened clients
      // can clobber unnamed portals. Match the application's max: 1 client;
      // service requests still contend concurrently via Promise.all fixtures.
      maxConnections: 1,
    });
    await socket.start();
    client = postgres(
      `postgres://postgres:postgres@${socket.getServerConn()}/postgres`,
      { max: 1, prepare: false, connect_timeout: 2 },
    );
    const db = drizzle(client, { schema });
    const envSource = options.env ? options.env() : process.env;
    if (!options.skipPlanRegistration && envSource.PLATFORM_BUDGET_PLAN_JSON) {
      const planCandidate = JSON.parse(envSource.PLATFORM_BUDGET_PLAN_JSON);
      const { PlatformBudgetStore } = await import("../../lib/funding/store");
      const budgetStore = new PlatformBudgetStore(db);
      await budgetStore.registerReviewedPlan(planCandidate, envSource);
    }
    const { CreditStore } = await import("../../lib/credits/store");
    const store = new CreditStore(db, options.env ?? (() => process.env));
    const reserve = (
      who = options.actor(),
      microdollars = 100_000,
      overrides: Partial<Parameters<CreditStore["reserve"]>[0]> = {},
    ) =>
      store.reserve({
        actor: who,
        microdollars,
        config: options.config(),
        digest: options.digest,
        idempotencyKey: crypto.randomUUID(),
        ...overrides,
      });
    return { database, db, store, reserve, close };
  } catch (error) {
    await close();
    throw error;
  }
}
/** Each callback owns its engine/client. A timed-out callback can only reach a
 * retired client, never a later test's global store or freshly truncated rows. */
export function withCreditsFixture(
  options: FixtureOptions,
  run: (fixture: CreditFixture) => Promise<void>,
): () => Promise<void> {
  return async () => {
    const creating = createCreditFixture(options);
    onTestFinished(() =>
      creating.then(
        (fixture) => fixture.close(),
        () => {},
      ),
    );
    const fixture = await creating;
    try {
      await run(fixture);
    } finally {
      await fixture.close();
    }
  };
}
