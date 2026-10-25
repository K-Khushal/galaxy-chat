/**
 * Native PostgreSQL verification harness (issue #63).
 *
 * Provisions a disposable, private PostgreSQL cluster on 127.0.0.1 from
 * already-installed server binaries, runs the existing
 * tests/f10-f11-postgres.test.ts unskipped against it, and tears the cluster
 * down on every exit path. It proves nothing on its own: the acceptance
 * evidence is the bun test run below (1 pass / 0 skip with real
 * pg_blocking_pids lock waits). If PostgreSQL server binaries are not
 * installed, this command fails loudly and nonzero; it never falls back to
 * PGlite or reports a mocked success.
 *
 * Hard guarantees:
 * - Only binaries discovered via `pg_config --bindir` or a short fallback
 *   list are used. Nothing is installed; no machine-wide service is started,
 *   stopped, or contacted; no sudo; no processes are killed by name.
 * - The cluster is a brand-new initdb data directory under a 0700 random
 *   temp dir, bound to literal 127.0.0.1 on a dynamically selected port with
 *   a bounded retry, private socket dir and private log path. Credentials
 *   are synthetic and generated here; no DATABASE_URL, Supabase project,
 *   .env file, or persisted credential is ever read or forwarded.
 * - The bun test child runs with an allowlisted environment and Bun's
 *   documented `--no-env-file` flag, so automatic .env loading is disabled
 *   and only PATH/HOME/TMPDIR/locale variables plus F10_F11_POSTGRES_URL are
 *   visible to the test. Passwords and connection strings are never logged.
 * - On success, assertion failure, spawn failure, timeout, SIGINT or
 *   SIGTERM: wait for the test child, stop this cluster (fast, then
 *   immediate), verify it is no longer listening and its postmaster PID is
 *   gone, and remove only its own temp directory. Any teardown failure turns
 *   the command nonzero. Subprocesses are spawned via argv arrays only.
 */
import { type ChildProcess, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  accessSync,
  existsSync,
  constants as fsConstants,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const REPO_ROOT = resolve(import.meta.dir, "..");
const TEST_FILE = "tests/f10-f11-postgres.test.ts";
const TEST_NAME = "F10/F11 native concurrent artifact FK";
const REQUIRED_BINARIES = ["initdb", "pg_ctl", "postgres"] as const;

const INITDB_TIMEOUT_MS = 120_000;
const START_TIMEOUT_MS = 90_000;
const CHILD_TIMEOUT_MS = 300_000;
const CHILD_KILL_GRACE_MS = 10_000;
const LISTEN_VERIFY_TIMEOUT_MS = 20_000;
const STOP_TIMEOUT_MS = 60_000;
const PORT_ATTEMPTS = 8;

type BinarySet = {
  bindir: string;
  initdb: string;
  pg_ctl: string;
  postgres: string;
};

type ToolResult = {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
};

function log(message: string): void {
  process.stdout.write(`[native-postgres] ${message}\n`);
}

function fail(message: string): void {
  process.stderr.write(`[native-postgres] ERROR: ${message}\n`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

/** In-flight tool children so a signal never orphans initdb/pg_ctl/postgres. */
const activeToolChildren = new Set<ChildProcess>();

/** Spawn a tool via argv (never a shell) with a finite timeout. */
function runTool(
  command: readonly string[],
  options: { timeoutMs: number },
): Promise<ToolResult> {
  const [file, ...args] = command;
  if (!file) {
    return Promise.resolve({
      exitCode: null,
      stdout: "",
      stderr: "",
      timedOut: false,
    });
  }
  return new Promise((resolvePromise) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let finished = false;
    const child: ChildProcess = spawn(file, args, {
      stdio: ["ignore", "pipe", "pipe"],
    });
    activeToolChildren.add(child);
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => {
        if (!finished) child.kill("SIGKILL");
      }, 5_000);
    }, options.timeoutMs);
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    const finish = (exitCode: number | null): void => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      activeToolChildren.delete(child);
      resolvePromise({ exitCode, stdout, stderr, timedOut });
    };
    child.on("error", (error: NodeJS.ErrnoException) => {
      fail(`failed to spawn ${command[0]}: ${error.message}`);
      finish(null);
    });
    child.on("close", (exitCode) => finish(exitCode));
  });
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** True when a TCP connection to host:port succeeds within the timeout. */
function tcpConnects(
  host: string,
  port: number,
  timeoutMs: number,
): Promise<boolean> {
  return new Promise((resolvePromise) => {
    const socket = connect({ host, port });
    const done = (result: boolean): void => {
      socket.destroy();
      resolvePromise(result);
    };
    socket.setTimeout(timeoutMs, () => done(false));
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
  });
}

async function waitListening(
  host: string,
  port: number,
  deadlineMs: number,
): Promise<void> {
  const deadline = Date.now() + deadlineMs;
  while (Date.now() < deadline) {
    if (await tcpConnects(host, port, 1_000)) return;
    await sleep(200);
  }
  throw new Error(
    `cluster did not accept connections on ${host}:${port} within ${deadlineMs}ms`,
  );
}

function executable(path: string): boolean {
  try {
    if (!statSync(path).isFile()) return false;
    accessSync(path, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function subdirectories(parent: string): string[] {
  try {
    return readdirSync(parent, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(parent, entry.name));
  } catch {
    return [];
  }
}

/** Documented discovery order; see docs/operations/native-postgres.md. */
async function candidateBindirs(): Promise<string[]> {
  const dirs: string[] = [];
  const pgConfig = await runTool(["pg_config", "--bindir"], {
    timeoutMs: 10_000,
  });
  if (pgConfig.exitCode === 0) {
    const bindir = pgConfig.stdout.trim();
    if (bindir) dirs.push(bindir);
  }
  dirs.push(
    ...subdirectories("/usr/lib/postgresql")
      .map((dir) => join(dir, "bin"))
      .sort()
      .reverse(),
  );
  dirs.push(
    ...subdirectories("/usr/pgsql-")
      .map((dir) => join(dir, "bin"))
      .sort()
      .reverse(),
  );
  dirs.push(
    ...subdirectories("/opt/homebrew/opt").filter((dir) =>
      dir.includes("postgresql"),
    ),
  );
  dirs.push("/opt/homebrew/bin", "/usr/local/bin");
  dirs.push(
    ...subdirectories("/usr/local/opt").filter((dir) =>
      dir.includes("postgresql"),
    ),
  );
  return dirs;
}

async function findBinaries(): Promise<BinarySet> {
  const searched: string[] = [];
  for (const dir of await candidateBindirs()) {
    if (!existsSync(dir)) continue;
    searched.push(dir);
    if (REQUIRED_BINARIES.every((binary) => executable(join(dir, binary)))) {
      return {
        bindir: dir,
        initdb: join(dir, "initdb"),
        pg_ctl: join(dir, "pg_ctl"),
        postgres: join(dir, "postgres"),
      };
    }
  }
  throw new Error(
    "no usable PostgreSQL server binaries found (need initdb, pg_ctl and " +
      "postgres from one installation). Searched: pg_config --bindir, " +
      "/usr/lib/postgresql/*/bin, /usr/pgsql-*/bin, " +
      "/opt/homebrew/opt/postgresql*/bin, /opt/homebrew/bin, /usr/local/bin, " +
      `/usr/local/opt/postgresql*/bin. Visited: ${
        searched.length > 0 ? searched.join(", ") : "none"
      }. ` +
      "This command never installs packages, never substitutes PGlite, and " +
      "never reports a mocked success: on machines without PostgreSQL server " +
      "binaries the native case stays unproven and CI's dedicated " +
      "test:native-postgres step (ubuntu-24.04, PostgreSQL 16 preinstalled) " +
      "carries the proof.",
  );
}

type Cluster = {
  root: string;
  dataDir: string;
  socketDir: string;
  logPath: string;
  pid: number | null;
  port: number | null;
  testChild: ChildProcess | null;
};

function createTempRoot(): {
  root: string;
  dataDir: string;
  socketDir: string;
  logPath: string;
} {
  const root = mkdtempSync(join(tmpdir(), "galaxy-native-pg-"));
  const dataDir = join(root, "data");
  const socketDir = join(root, "socket");
  const logPath = join(root, "postgres.log");
  mkdirSync(socketDir, { recursive: true, mode: 0o700 });
  return { root, dataDir, socketDir, logPath };
}

/** Fresh ephemeral candidate port from the OS, before the server binds. */
function candidatePort(): number {
  const port = 20_000 + (randomBytes(2).readUInt16BE(0) % 40_000);
  return port;
}

async function initCluster(
  binaries: BinarySet,
  cluster: Cluster,
  dbUser: string,
  dbPassword: string,
): Promise<void> {
  const pwFile = join(cluster.root, "pwfile");
  writeFileSync(pwFile, `${dbPassword}\n`, { mode: 0o600 });
  const initdb = await runTool(
    [
      binaries.initdb,
      "-D",
      cluster.dataDir,
      "-U",
      dbUser,
      "-A",
      "scram-sha-256",
      "--pwfile",
      pwFile,
      "-E",
      "UTF8",
      "--no-instructions",
      "--no-sync",
    ],
    { timeoutMs: INITDB_TIMEOUT_MS },
  );
  unlinkSync(pwFile);
  if (initdb.exitCode !== 0) {
    throw new Error(
      `initdb failed (exit ${initdb.exitCode}${initdb.timedOut ? ", timed out" : ""})`,
    );
  }
  log("new cluster initialized in private temp directory");
}

async function startCluster(
  binaries: BinarySet,
  cluster: Cluster,
): Promise<number> {
  let lastFailure = "no attempt made";
  for (let attempt = 1; attempt <= PORT_ATTEMPTS; attempt++) {
    const port = candidatePort();
    const serverOptions = [
      "-c listen_addresses=127.0.0.1",
      `-c port=${port}`,
      `-c unix_socket_directories=${cluster.socketDir}`,
      "-c fsync=off",
      "-c synchronous_commit=off",
      "-c full_page_writes=off",
    ].join(" ");
    const start = await runTool(
      [
        binaries.pg_ctl,
        "-D",
        cluster.dataDir,
        "-l",
        cluster.logPath,
        "-w",
        "-t",
        "60",
        "start",
        "-o",
        serverOptions,
      ],
      { timeoutMs: START_TIMEOUT_MS },
    );
    if (start.exitCode === 0) {
      cluster.port = port;
      const pidFile = join(cluster.dataDir, "postmaster.pid");
      const pid = Number(readFileSync(pidFile, "utf8").split("\n")[0]);
      if (!Number.isInteger(pid) || pid <= 1) {
        throw new Error(`invalid postmaster PID recorded in ${pidFile}`);
      }
      cluster.pid = pid;
      await waitListening("127.0.0.1", port, LISTEN_VERIFY_TIMEOUT_MS);
      log(
        `cluster listening on 127.0.0.1:${port} (postmaster pid ${pid}, loopback only)`,
      );
      return port;
    }
    lastFailure = `pg_ctl start attempt ${attempt} exited ${start.exitCode}${start.timedOut ? " (timed out)" : ""}`;
    const logText = existsSync(cluster.logPath)
      ? readFileSync(cluster.logPath, "utf8")
      : "";
    const bindFailure = /could not bind|Address already in use/i.test(logText);
    if (!bindFailure) break;
    log(`port ${port} was taken by a concurrent bind; retrying`);
  }
  throw new Error(
    `cluster failed to start: ${lastFailure}; see log tail printed at teardown`,
  );
}

function childEnvironment(url: string): NodeJS.ProcessEnv {
  const allowed = ["HOME", "TMPDIR", "LANG", "LC_ALL", "LC_CTYPE"];
  // bun test sets NODE_ENV=test itself; make it explicit because the spawn
  // environment here is fully allowlisted rather than inherited.
  const env: NodeJS.ProcessEnv = {
    NODE_ENV: process.env.NODE_ENV || "test",
    PATH: process.env.PATH || "/usr/bin:/bin",
    F10_F11_POSTGRES_URL: url,
  };
  for (const key of allowed) {
    const value = process.env[key];
    if (value !== undefined && value !== "") env[key] = value;
  }
  return env;
}

type ChildResult = {
  exitCode: number | null;
  output: string;
  timedOut: boolean;
};

/**
 * Spawn the existing native test file with the documented Bun flag that
 * disables automatic .env loading, and an allowlisted environment.
 */
async function runTestChild(
  cluster: Cluster,
  url: string,
): Promise<ChildResult> {
  const command = [process.execPath, "test", "--no-env-file", TEST_FILE];
  log(`spawning bun test --no-env-file ${TEST_FILE} (allowlisted environment)`);
  const [file, ...args] = command;
  if (!file) throw new Error("internal error: empty bun test command");
  const child: ChildProcess = spawn(file, args, {
    cwd: REPO_ROOT,
    env: childEnvironment(url),
    stdio: ["ignore", "pipe", "pipe"],
  });
  cluster.testChild = child;
  let output = "";
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    fail(
      `bun test exceeded overall timeout of ${CHILD_TIMEOUT_MS}ms; sending SIGTERM`,
    );
    child.kill("SIGTERM");
    setTimeout(() => child.kill("SIGKILL"), CHILD_KILL_GRACE_MS);
  }, CHILD_TIMEOUT_MS);
  child.stdout?.on("data", (chunk: Buffer) => {
    output += chunk.toString();
    process.stdout.write(chunk);
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    output += chunk.toString();
    process.stderr.write(chunk);
  });
  await new Promise<void>((resolvePromise) => {
    child.on("close", () => resolvePromise());
  });
  clearTimeout(timer);
  cluster.testChild = null;
  return { exitCode: child.exitCode, output, timedOut };
}

/** The native case must show 1 PASS / 0 SKIP with a real passing marker. */
function evaluateChild(result: ChildResult): {
  ok: boolean;
  reasons: string[];
} {
  const reasons: string[] = [];
  if (result.timedOut) reasons.push("bun test exceeded the overall timeout");
  if (result.exitCode !== 0) {
    reasons.push(
      `bun test exited ${result.exitCode ?? "via signal"} (required 0)`,
    );
  }
  const lastMatch = (pattern: RegExp): number | null => {
    const matches = [...result.output.matchAll(pattern)];
    const last = matches[matches.length - 1];
    return last?.[1] ? Number(last[1]) : null;
  };
  const pass = lastMatch(/(\d+)\s+pass/g);
  // bun omits the skip/fail summary lines entirely when the counts are zero.
  const failCount = lastMatch(/(\d+)\s+fail/g) ?? 0;
  const skip = lastMatch(/(\d+)\s+skip/g) ?? 0;
  if (pass === null) {
    reasons.push("bun test summary (pass count) not found in output");
  } else {
    log(`bun test summary: ${pass} pass, ${failCount} fail, ${skip} skip`);
    if (skip !== 0)
      reasons.push(`native case was skipped (${skip} skip; required 0)`);
    if (pass < 1)
      reasons.push("no passing native case (required at least 1 pass)");
    if (failCount !== 0) {
      reasons.push(`${failCount} failing assertions`);
    }
  }
  const passMarker = result.output
    .split("\n")
    .some((line) => line.includes("(pass)") && line.includes(TEST_NAME));
  if (!passMarker) {
    reasons.push(`no '(pass)' marker found for "${TEST_NAME}"`);
  }
  return { ok: reasons.length === 0, reasons };
}

function printLogTail(cluster: Cluster, label: string): void {
  try {
    if (!existsSync(cluster.logPath)) return;
    const lines = readFileSync(cluster.logPath, "utf8").trimEnd().split("\n");
    const tail = lines.slice(-40).join("\n");
    process.stderr.write(
      `[native-postgres] --- ${label} (last ${Math.min(40, lines.length)} lines) ---\n${tail}\n`,
    );
  } catch {
    process.stderr.write(
      `[native-postgres] --- ${label} could not be read ---\n`,
    );
  }
}

async function stopCluster(
  binaries: BinarySet,
  cluster: Cluster,
): Promise<void> {
  if (
    cluster.pid !== null ||
    existsSync(join(cluster.dataDir, "postmaster.pid"))
  ) {
    let stop = await runTool(
      [
        binaries.pg_ctl,
        "-D",
        cluster.dataDir,
        "-m",
        "fast",
        "-w",
        "-t",
        "30",
        "stop",
      ],
      { timeoutMs: STOP_TIMEOUT_MS },
    );
    if (stop.exitCode !== 0) {
      log("fast stop failed; attempting immediate stop");
      stop = await runTool(
        [
          binaries.pg_ctl,
          "-D",
          cluster.dataDir,
          "-m",
          "immediate",
          "-w",
          "-t",
          "30",
          "stop",
        ],
        { timeoutMs: STOP_TIMEOUT_MS },
      );
    }
    if (stop.exitCode !== 0) {
      throw new Error(
        `pg_ctl stop failed in both fast and immediate modes (exit ${stop.exitCode})`,
      );
    }
  }
}

/**
 * Stop only this cluster, verify it is neither listening nor running, and
 * remove only its own temp directory. Throws on any teardown failure so the
 * command can never exit green with a surviving postmaster or temp dir.
 */
async function teardown(binaries: BinarySet, cluster: Cluster): Promise<void> {
  const testChild = cluster.testChild;
  if (testChild && testChild.exitCode === null) {
    log("test child still running at teardown; waiting for it to exit");
    testChild.kill("SIGTERM");
    await new Promise<void>((resolvePromise) => {
      testChild.once("close", () => resolvePromise());
      setTimeout(() => {
        testChild.kill("SIGKILL");
        resolvePromise();
      }, CHILD_KILL_GRACE_MS);
    });
    cluster.testChild = null;
  }
  try {
    await stopCluster(binaries, cluster);
  } catch (error) {
    printLogTail(cluster, "postgres.log (stop failure)");
    throw error;
  }
  if (cluster.port !== null) {
    if (await tcpConnects("127.0.0.1", cluster.port, 2_000)) {
      printLogTail(cluster, "postgres.log (port still accepting)");
      throw new Error(
        `teardown verification failed: port ${cluster.port} still accepts connections after stop`,
      );
    }
    log(`verified: port ${cluster.port} no longer accepting connections`);
  }
  if (cluster.pid !== null) {
    const deadline = Date.now() + 5_000;
    while (processAlive(cluster.pid) && Date.now() < deadline) await sleep(200);
    if (processAlive(cluster.pid)) {
      throw new Error(
        `teardown verification failed: postmaster pid ${cluster.pid} is still running`,
      );
    }
    log(`verified: postmaster pid ${cluster.pid} is gone`);
  }
  rmSync(cluster.root, { recursive: true, force: true });
  if (existsSync(cluster.root)) {
    throw new Error(
      `teardown verification failed: temp dir ${cluster.root} still present`,
    );
  }
  log("verified: temp directory removed");
}

let activeBinaries: BinarySet | null = null;
let activeCluster: Cluster | null = null;
let interrupted = false;

async function handleSignal(signal: NodeJS.Signals): Promise<void> {
  if (interrupted) return;
  interrupted = true;
  fail(`received ${signal}; tearing down cluster before exiting nonzero`);
  for (const child of activeToolChildren) child.kill("SIGTERM");
  if (activeCluster && activeBinaries) {
    try {
      await teardown(activeBinaries, activeCluster);
    } catch (error) {
      fail(
        `teardown after ${signal} failed: ${String(
          error instanceof Error ? error.message : error,
        )}`,
      );
    }
  }
  process.exit(1);
}

async function main(): Promise<number> {
  let binaries: BinarySet;
  try {
    binaries = await findBinaries();
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
    return 1;
  }
  activeBinaries = binaries;
  process.on("SIGINT", () => void handleSignal("SIGINT"));
  process.on("SIGTERM", () => void handleSignal("SIGTERM"));

  log(`using PostgreSQL binaries from ${binaries.bindir}`);
  const version = await runTool([binaries.postgres, "--version"], {
    timeoutMs: 10_000,
  });
  const versionLine = version.stdout.trim();
  if (versionLine) log(versionLine);

  const cluster: Cluster = {
    ...createTempRoot(),
    pid: null,
    port: null,
    testChild: null,
  };
  activeCluster = cluster;
  let ok = true;
  const problems: string[] = [];
  try {
    const dbUser = "galaxy_native_ci";
    const dbPassword = randomBytes(24).toString("hex");
    await initCluster(binaries, cluster, dbUser, dbPassword);
    const port = await startCluster(binaries, cluster);
    const pgVersionFile = join(cluster.dataDir, "PG_VERSION");
    if (existsSync(pgVersionFile)) {
      log(
        `cluster data directory PG_VERSION: ${readFileSync(pgVersionFile, "utf8").trim()}`,
      );
    }
    const url = `postgres://${dbUser}:${dbPassword}@127.0.0.1:${port}/postgres`;
    const result = await runTestChild(cluster, url);
    const verdict = evaluateChild(result);
    if (!verdict.ok) {
      ok = false;
      problems.push(...verdict.reasons);
      printLogTail(cluster, "postgres.log (test failure)");
    }
  } catch (error) {
    ok = false;
    problems.push(String(error instanceof Error ? error.message : error));
    printLogTail(cluster, "postgres.log (failure)");
  }
  try {
    await teardown(binaries, cluster);
  } catch (error) {
    ok = false;
    problems.push(
      `teardown: ${String(error instanceof Error ? error.message : error)}`,
    );
  }
  activeCluster = null;
  if (!ok) {
    for (const problem of problems) fail(problem);
    fail("native PostgreSQL verification did NOT pass; see reasons above");
    return 1;
  }
  log(
    "native PostgreSQL verification passed: 1 pass / 0 skip, cluster torn down cleanly",
  );
  return 0;
}

process.exitCode = 1;
main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    fail(
      `unexpected harness failure: ${String(error instanceof Error ? error.message : error)}`,
    );
    process.exitCode = 1;
  });
