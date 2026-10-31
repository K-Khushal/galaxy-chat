import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import postgres from "postgres";

// Production assets, with a test runtime so production's auth bypass guard stays strict.
const build = Bun.spawn(["bun", "run", "build"], {
  env: { ...process.env, NODE_ENV: "production", GALAXY_TEST_E2E: undefined },
  stdout: "inherit",
  stderr: "inherit",
});
if (await build.exited) process.exit(1);
const directory = await mkdtemp(join(tmpdir(), "galaxy-e2e-"));
const bindir = (await Bun.$`pg_config --bindir`.text()).trim();
await Bun.$`${bindir}/initdb -D ${directory} -U postgres -A trust --no-locale`.quiet();
const database = Bun.spawn(
  [
    `${bindir}/postgres`,
    "-D",
    directory,
    "-h",
    "127.0.0.1",
    "-p",
    "5544",
    "-k",
    directory,
    "-F",
  ],
  { stdout: "ignore", stderr: "inherit" },
);
let app: ReturnType<typeof Bun.spawn> | undefined;
let redis: ReturnType<typeof Bun.spawn> | undefined;
const cleanup = () => {
  app?.kill();
  redis?.kill();
  database.kill();
};
process.on("SIGTERM", cleanup);
process.on("SIGINT", cleanup);
for (let attempt = 0; ; attempt++) {
  const ready = Bun.spawn(
    [`${bindir}/pg_isready`, "-h", "127.0.0.1", "-p", "5544"],
    { stdout: "ignore", stderr: "ignore" },
  );
  if ((await ready.exited) === 0) break;
  if (attempt === 50) {
    cleanup();
    throw new Error("Local E2E PostgreSQL did not start");
  }
  await Bun.sleep(100);
}
const databaseUrl = "postgres://postgres@127.0.0.1:5544/postgres";
const db = postgres(databaseUrl);
for (const file of (await readdir("drizzle"))
  .filter((f) => f.endsWith(".sql"))
  .sort())
  await db.unsafe(await Bun.file(`drizzle/${file}`).text());
await db.end();
redis = Bun.spawn(
  ["redis-server", "--port", "6399", "--save", "", "--appendonly", "no"],
  { stdout: "ignore", stderr: "inherit" },
);
app = Bun.spawn(
  [
    "node",
    "node_modules/next/dist/bin/next",
    "start",
    "-H",
    "127.0.0.1",
    "-p",
    "3008",
  ],
  {
    env: {
      ...process.env,
      NODE_ENV: "test",
      GALAXY_TEST_E2E: "1",
      DATABASE_URL: databaseUrl,
      REDIS_URL: "redis://127.0.0.1:6399",
      BETTER_AUTH_URL: "http://127.0.0.1:3008",
      BETTER_AUTH_SECRET: "e2e-secret-0000000000000000000000000000",
      CREDIT_IDENTITY_KEY: "e2e-identity-00000000000000000000000000",
      GITHUB_CLIENT_ID: "e2e",
      GITHUB_CLIENT_SECRET: "e2e",
      GOOGLE_CLIENT_ID: "e2e",
      GOOGLE_CLIENT_SECRET: "e2e",
      RESEND_API_KEY: "re_e2e",
      AUTH_EMAIL_FROM: "e2e@example.com",
      TURNSTILE_SECRET_KEY: "e2e",
      TURNSTILE_SITE_KEY: "e2e",
      OPENROUTER_API_KEY: "unused-e2e-platform-key",
      BYOK_ENCRYPTION_KEYS_JSON: JSON.stringify({
        v1: Buffer.alloc(32, 7).toString("base64"),
      }),
      BYOK_ACTIVE_KEY_VERSION: "v1",
    },
    stdout: "inherit",
    stderr: "inherit",
  },
);
const code = await app.exited;
cleanup();
await database.exited;
await rm(directory, { recursive: true, force: true });
process.exit(code);
