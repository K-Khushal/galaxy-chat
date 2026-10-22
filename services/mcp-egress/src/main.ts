import postgres from "postgres";
import { loadConfig } from "./config.js";
import { errorCode, fail } from "./errors.js";
import { MemoryReplayStore, PostgresReplayStore } from "./replay-store.js";
import { createBrokerServer } from "./server.js";

let database: ReturnType<typeof postgres> | undefined;
try {
  const config = loadConfig(process.env);
  if (config) {
    if (config.production && !config.databaseUrl) fail("configuration");
    database = config.databaseUrl
      ? postgres(config.databaseUrl, {
          max: 2,
          prepare: false,
          connect_timeout: 3,
          idle_timeout: 10,
          debug: false,
          connection: { statement_timeout: 3000 },
        })
      : undefined;
    const store = database
      ? new PostgresReplayStore(database)
      : new MemoryReplayStore();
    const broker = await createBrokerServer(config, store);
    await new Promise<void>((resolve, reject) => {
      broker.server.once("error", reject);
      broker.server.listen(config.port, config.bind, resolve);
    });
    const stop = () => {
      void broker.close().finally(() => database?.end({ timeout: 1 }));
    };
    process.once("SIGTERM", stop);
    process.once("SIGINT", stop);
    // No configuration, upstream bodies, credentials or bind URLs in logs.
    process.stdout.write('{"event":"mcp_egress_listening"}\n');
  }
} catch (error) {
  process.stderr.write(`${JSON.stringify({ error: errorCode(error) })}\n`);
  await database?.end({ timeout: 1 });
  process.exitCode = 1;
}
