# Native PostgreSQL verification (F10/F11 concurrency case)

## Purpose

`tests/f10-f11-postgres.test.ts` is a real multi-backend acceptance case for the
artifact/attachment ownership work (issues #14/#15): three distinct database
backends reproduce the FK lock inversion, prove attachment quota retention,
observe blockers via `pg_blocking_pids()`, and serialize real application
parent deletion through the actual advisory locks. PGlite runs in a single
backend and cannot establish row/advisory-lock concurrency, so passing this
case on PGlite proves nothing about native PostgreSQL behavior.

`bun run test:native-postgres` (scripts/test-native-postgres.ts) closes that
gap: it provisions a disposable native PostgreSQL cluster on the local machine,
runs the exact existing test file unskipped against it, and tears the cluster
down on every exit path. It adds verification only — no production code,
migrations, or dependencies are involved.

## What the harness guarantees

- **Binaries only, nothing installed.** The harness uses already-installed
  server binaries (`initdb`, `pg_ctl`, `postgres`). Discovery order:
  `pg_config --bindir`, then `/usr/lib/postgresql/*/bin`,
  `/usr/pgsql-*/bin`, `/opt/homebrew/opt/postgresql*/bin`,
  `/opt/homebrew/bin`, `/usr/local/bin`, `/usr/local/opt/postgresql*/bin`.
  If no complete set is found, the command fails loudly with a nonzero exit.
  It never silently skips, never substitutes PGlite, and never reports a
  mocked success. Machines without PostgreSQL keep that explicit limitation;
  the hosted CI step carries the actual pass.
- **A private, disposable cluster.** `initdb` creates an entirely new cluster
  under a 0700 random temp directory, owned by the invoking user. The server
  binds to literal `127.0.0.1` on a dynamically selected port (bounded retry
  when a port is taken), with a private socket directory and private log file
  inside the same temp directory. Credentials are synthetic and generated per
  run; authentication is `scram-sha-256`. No machine-wide service is started
  or stopped, no sudo is used, no existing cluster or system service is ever
  touched, and no process is killed by name — the harness controls only the
  postmaster PID recorded in its own cluster's `postmaster.pid`.
- **No ambient configuration.** The bun test child is spawned with Bun's
  documented `--no-env-file` flag (automatic `.env` loading disabled) and an
  allowlisted environment: `PATH`, `HOME`, `TMPDIR`, locale variables, plus
  `F10_F11_POSTGRES_URL` pointing at the generated cluster with the generated
  credentials. User `DATABASE_URL`, Supabase variables, `.env` files, and
  persisted credentials are never read or forwarded. Passwords and connection
  strings are never logged.
- **The exact existing test, unskipped.** The harness spawns
  `bun test --no-env-file tests/f10-f11-postgres.test.ts` with
  `F10_F11_POSTGRES_URL` set. The test's distinct-backend PID checks,
  `pg_blocking_pids()` lock-wait evidence, real application operations,
  quota assertions, parent-deletion serialization, and random database
  cleanup are preserved untouched. A missing lock-wait observation, stale
  writes, or unintended rows fail the command — they are never timing skips.
  Timeouts are finite: bounded initdb/startup, a 5-minute overall test
  timeout (SIGTERM then SIGKILL), and bounded stop/teardown.
- **Deterministic teardown.** On success, assertion failure, spawn failure,
  timeout, SIGINT, or SIGTERM, the harness waits for the test child, stops
  the cluster (`pg_ctl -m fast`, then `-m immediate` if needed), verifies the
  port no longer accepts connections and the postmaster PID is gone, and
  removes only its own temp directory. Any teardown failure makes the command
  exit nonzero — a surviving postmaster or temp directory can never turn the
  command green. The test itself may destroy only the random fixture database
  it created inside this generated cluster; financial records, receipts, and
  carry are never touched.

## CI wiring

The existing `check` job in `.github/workflows/ci.yml` gained exactly one
step, `bun run test:native-postgres`, placed after installation and type
checks and before the unchanged full `bun test` suite and build. The job is
pinned to `runs-on: ubuntu-24.04` for repeatability: GitHub's Ubuntu 24.04
runner image ships PostgreSQL server binaries (16.x, service disabled — the
harness never starts the system service and does not need it), and GitHub has
announced that the `ubuntu-latest` label will move to 26.04. There is no
`continue-on-error`, no retry, no skip condition, no Docker, no external or
managed database, and no paid or new runner tier. Overall operating-cost
proof remains pending and is not claimed by this step.

## Running locally

```
bun run test:native-postgres
```

Requires PostgreSQL server binaries on the machine (e.g. from Homebrew or OS
packages). Without them the command exits nonzero by design. The full
`bun test` suite is unchanged: its conditional native skip remains, because
the dedicated step above proves that single case separately against a real
native cluster. The rest of the PGlite suite is never pointed at the native
cluster.

## Explicit limits of this proof

This proves only the existing F10/F11 native case (artifact FK concurrency,
attachment quota retention, parent-deletion serialization) on a disposable
native cluster. It does not prove: native financial/MCP/sandbox concurrency,
Supabase or hosted application behavior, vendor isolation, live budget gates,
or any overall operating cost. Those gates remain open and pending.
