# Native PostgreSQL verification

`bun run --no-env-file test:native-postgres` runs the existing F10/F11 native
concurrency case against a new disposable loopback-only cluster. It adds no
production code, migrations or dependencies. The exact existing test retains
its distinct-backend PID assertions, `pg_blocking_pids` observations, real
application operations, quota checks and parent-deletion serialization.

## Process and data isolation

The launcher detects installed `initdb` and `postgres` from `pg_config --bindir`,
then versioned `/usr/lib/postgresql/*/bin`, `/usr/pgsql-*/bin`, Homebrew opt bin
directories and standard Homebrew/local bin locations. It fails nonzero when
binaries are unavailable; it never installs packages or substitutes PGlite.

The private random temp root, home and socket directories have0700 permissions.
Initialization uses synthetic per-run SCRAM credentials. PostgreSQL runs as an
owned foreground child with an immediately captured PID/process group, not as a
`pg_ctl`-detached daemon. The server binds literal127.0.0.1 on an OS-selected
candidate port; bind races have bounded retries. Readiness requires the owned
server's ready message, its own PID/data directory/port identity and a TCP check.
Settings are written as escaped PostgreSQL configuration values rather than a
shell-parsed `pg_ctl -o` string, including temp paths with spaces/punctuation.
No machine-wide service, existing cluster, sudo, external database or process-name
kill is used.

Every tool and test subprocess gets an allowlisted environment. PostgreSQL tools
receive no ambient PG settings or application database URL; the test receives
only the generated F10_F11_POSTGRES_URL, a private HOME/TMPDIR, fixed test/locale
settings and PATH. Both the documented outer invocation and package script use
`--no-env-file`; the test child also disables dotenv loading. Calling plain
`bun run` without that flag can load dotenv in the *outer* Bun launcher before
our script starts, so use the documented invocation. No inherited database or
provider credentials are forwarded. Captured output is bounded and generated
passwords/database URLs are redacted before printing.

## Cancellation and evidence

Signals only cancel ongoing work. Main owns one awaited teardown path; startup
and cleanup cannot run concurrently or launch another stage after cancellation.
Owned tool/test process groups receive termination followed by bounded kill
escalation when needed. The foreground server receives fast shutdown (SIGINT),
then immediate shutdown (SIGQUIT), then a last-resort kill of its own group.
Every spawned process, including failed startup, is tracked before any await.
Ready clusters require the port to be closed after the owned postmaster exits;
a failed startup is checked through the owned child's exit, without probing or
stopping an unrelated server that won a port race. Only then is this invocation's
temp directory removed. Teardown failure makes the command nonzero.

The test child has a five-minute timeout. Passing requires exactly1PASS/0SKIP/
0FAIL, exit0 and the expected native case's passing marker. The normal full Bun
suite remains unchanged and may still show its conditional native skip; this
dedicated command proves that case separately.

Direct root review reproduced an unreaped initdb process after cancellation and
ambient PG/database settings leaking to tools. A synthetic lifecycle fault probe
now confirms the child is reaped and those settings are absent. Such probes are
**not native database proof**. A real unskipped native pass must come from CI or
a machine with installed server binaries; local missing binaries remain an
explicit nonzero limitation.

## CI and limits

The existing check job is pinned to ubuntu-24.04 and adds one native step before
the unchanged full suite/build. Installed binaries/version are checked by the
actual command. The [official runner inventory](https://github.com/actions/runner-images/blob/main/images/ubuntu/Ubuntu2404-Readme.md)
was checked for the preinstalled PostgreSQL and upcoming ubuntu-latest change;
this is not a claim of free CI or operating-cost acceptance. No runner-tier,
billing, package installation, Docker, managed database or deployment change.

This proves only the F10/F11 artifact-FK/quota/deletion concurrency case under the
reported native conditions. Broader native financial/MCP/sandbox concurrency,
Supabase, application-hosted behavior and live budget proof remain separate.
Connector and advanced-execution work is deferred to the next phase and is not
a current-phase blocker.
