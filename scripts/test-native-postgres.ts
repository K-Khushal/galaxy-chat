/** Disposable native verification only. Never installs binaries or uses an
 * external database. One cancellation path, one awaited teardown; postgres is
 * an owned foreground child rather than a detached pg_ctl-managed daemon. */
import { type ChildProcess, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  accessSync,
  chmodSync,
  constants,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { connect, createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const REPO_ROOT = resolve(import.meta.dir, "..");
const TEST_FILE = "tests/f10-f11-postgres.test.ts";
const TEST_NAME = "F10/F11 native concurrent artifact FK";
const cancel = new AbortController();
const owned = new Set<OwnedProcess>();
const secrets: string[] = [];
let signalCode = 1;
const log = (message: string) =>
  process.stdout.write(`[native-postgres] ${message}\n`);
function sanitized(value: string): string {
  let result = value;
  for (const secret of secrets)
    result = result.replaceAll(secret, "[redacted]");
  return result.replace(
    /postgres(?:ql)?:\/\/[^\s'"<>]+/gi,
    "[redacted database URL]",
  );
}
const fail = (message: string) =>
  process.stderr.write(`[native-postgres] ERROR: ${sanitized(message)}\n`);
function checkCancelled() {
  if (cancel.signal.aborted) throw new Error("verification_cancelled");
}
function environment(root?: string): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH || "/usr/bin:/bin",
    LANG: "C",
    LC_ALL: "C",
    NODE_ENV: "test",
    ...(root ? { HOME: join(root, "home"), TMPDIR: root } : {}),
  };
}
function delay(ms: number) {
  return new Promise<void>((resolvePromise) => setTimeout(resolvePromise, ms));
}
type Result = { exitCode: number | null; output: string; stdout: string };

/** All subprocesses have an owned process group, bounded output and a close
 * promise installed synchronously at spawn. No ambient PG/loader settings. */
class OwnedProcess {
  readonly child: ChildProcess;
  readonly done: Promise<Result>;
  readonly pid: number | undefined;
  closed = false;
  overflow = false;
  output = "";
  stdout = "";
  private onOverflow: () => void = () => {};
  readonly limitReached = new Promise<null>((resolvePromise) => {
    this.onOverflow = () => resolvePromise(null);
  });
  constructor(
    argv: readonly string[],
    env: NodeJS.ProcessEnv,
    cwd: string,
    limit = 65_536,
  ) {
    const [file, ...args] = argv;
    if (!file) throw new Error("empty_verification_command");
    this.child = spawn(file, args, {
      cwd,
      env,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    this.pid = this.child.pid;
    owned.add(this);
    this.done = new Promise((resolvePromise) => {
      let bytes = 0;
      const capture = (chunk: Buffer, stdout: boolean) => {
        bytes += chunk.byteLength;
        if (bytes > limit) {
          this.overflow = true;
          this.signal("SIGTERM");
          this.onOverflow();
          return;
        }
        const text = chunk.toString();
        this.output += text;
        if (stdout) this.stdout += text;
      };
      this.child.stdout?.on("data", (chunk) => capture(chunk, true));
      this.child.stderr?.on("data", (chunk) => capture(chunk, false));
      const finish = (exitCode: number | null) => {
        if (this.closed) return;
        this.closed = true;
        owned.delete(this);
        resolvePromise({ exitCode, output: this.output, stdout: this.stdout });
      };
      this.child.once("error", () => {
        if (this.pid === undefined) finish(null);
      });
      this.child.once("close", (exitCode) => finish(exitCode));
    });
  }
  signal(signal: NodeJS.Signals) {
    if (this.closed || this.pid === undefined) return;
    try {
      process.kill(-this.pid, signal);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
    }
  }
}
async function waitClosed(
  child: OwnedProcess,
  ms: number,
): Promise<Result | null> {
  return new Promise((resolvePromise) => {
    const timer = setTimeout(() => resolvePromise(null), ms);
    void child.done.then((result) => {
      clearTimeout(timer);
      resolvePromise(result);
    });
  });
}
async function stop(child: OwnedProcess, first: NodeJS.Signals = "SIGTERM") {
  if (child.closed) return;
  child.signal(first);
  if (await waitClosed(child, 10_000)) return;
  child.signal(first === "SIGINT" ? "SIGQUIT" : "SIGKILL");
  if (await waitClosed(child, 5_000)) return;
  child.signal("SIGKILL");
  if (!(await waitClosed(child, 5_000)))
    throw new Error("owned_process_did_not_exit");
}
async function command(
  argv: readonly string[],
  env: NodeJS.ProcessEnv,
  cwd: string,
  timeoutMs: number,
  limit?: number,
): Promise<Result> {
  checkCancelled();
  const child = new OwnedProcess(argv, env, cwd, limit);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort: (() => void) | undefined;
  try {
    const interrupted = new Promise<null>((resolvePromise) => {
      abort = () => resolvePromise(null);
      cancel.signal.addEventListener("abort", abort, { once: true });
      if (cancel.signal.aborted) abort();
      timer = setTimeout(() => resolvePromise(null), timeoutMs);
    });
    const result = await Promise.race([
      child.done,
      interrupted,
      child.limitReached,
    ]);
    if (!result || child.overflow) {
      await stop(child);
      throw new Error(
        cancel.signal.aborted
          ? "verification_cancelled"
          : child.overflow
            ? "verification_output_limit"
            : "verification_command_timeout",
      );
    }
    checkCancelled();
    return result;
  } finally {
    if (timer) clearTimeout(timer);
    if (abort) cancel.signal.removeEventListener("abort", abort);
    if (!child.closed) await stop(child);
  }
}
function executable(path: string) {
  try {
    accessSync(path, constants.X_OK);
    return statSync(path).isFile();
  } catch {
    return false;
  }
}
function children(parent: string, prefix = ""): string[] {
  try {
    return readdirSync(parent, { withFileTypes: true })
      .filter(
        (e) =>
          (e.isDirectory() || e.isSymbolicLink()) && e.name.startsWith(prefix),
      )
      .map((e) => join(parent, e.name));
  } catch {
    return [];
  }
}
async function binaries() {
  const pg = await command(
    ["pg_config", "--bindir"],
    environment(),
    REPO_ROOT,
    10_000,
  );
  const candidates = [
    ...(pg.exitCode === 0 ? [pg.stdout.trim()] : []),
    ...children("/usr/lib/postgresql")
      .sort()
      .reverse()
      .map((p) => join(p, "bin")),
    ...children("/usr", "pgsql-")
      .sort()
      .reverse()
      .map((p) => join(p, "bin")),
    ...children("/opt/homebrew/opt", "postgresql").map((p) => join(p, "bin")),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    ...children("/usr/local/opt", "postgresql").map((p) => join(p, "bin")),
  ];
  for (const directory of candidates) {
    checkCancelled();
    if (
      directory &&
      ["initdb", "postgres"].every((name) => executable(join(directory, name)))
    )
      return {
        initdb: join(directory, "initdb"),
        postgres: join(directory, "postgres"),
        directory,
      };
  }
  throw new Error(
    "native_postgres_binaries_unavailable: need installed initdb and postgres; no install, skip or PGlite substitution is performed",
  );
}
async function candidatePort(): Promise<number> {
  checkCancelled();
  return new Promise((resolvePromise, reject) => {
    const server = createServer();
    server.once("error", () =>
      reject(new Error("native_port_allocation_failed")),
    );
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close((error) => {
        if (error || !address || typeof address === "string")
          reject(new Error("native_port_allocation_failed"));
        else resolvePromise(address.port);
      });
    });
  });
}
function tcpConnects(port: number): Promise<boolean> {
  return new Promise((resolvePromise) => {
    const socket = connect({ host: "127.0.0.1", port });
    let finished = false;
    const done = (result: boolean) => {
      if (finished) return;
      finished = true;
      socket.destroy();
      resolvePromise(result);
    };
    socket.setTimeout(1000, () => done(false));
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
  });
}
type Cluster = {
  root: string;
  data: string;
  sockets: string;
  log: string;
  server: OwnedProcess | null;
  port: number | null;
  ready: boolean;
};
function configString(value: string) {
  return `'${value.replaceAll("\\", "\\\\").replaceAll("'", "''")}'`;
}
async function startCluster(
  bin: Awaited<ReturnType<typeof binaries>>,
  cluster: Cluster,
) {
  for (let attempt = 0; attempt < 8; attempt++) {
    checkCancelled();
    const port = await candidatePort();
    checkCancelled();
    // Config file values avoid pg_ctl -o's shell-parsed option string, including
    // when a private temp path contains spaces or shell punctuation.
    writeFileSync(
      join(cluster.data, "postgresql.auto.conf"),
      `listen_addresses = '127.0.0.1'\nport = ${port}\nunix_socket_directories = ${configString(cluster.sockets)}\nlogging_collector = off\n`,
      { mode: 0o600 },
    );
    const server = new OwnedProcess(
      [bin.postgres, "-D", cluster.data],
      environment(cluster.root),
      cluster.root,
    );
    cluster.server = server;
    cluster.port = port;
    cluster.ready = false;
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      checkCancelled();
      if (server.closed) break;
      if (server.overflow) throw new Error("postgres_log_limit");
      if (
        server.output.includes("database system is ready to accept connections")
      ) {
        const lines = readFileSync(
          join(cluster.data, "postmaster.pid"),
          "utf8",
        ).split("\n");
        if (
          Number(lines[0]) !== server.pid ||
          lines[1] !== cluster.data ||
          Number(lines[3]) !== port
        )
          throw new Error("owned_postmaster_identity_mismatch");
        cluster.ready = true;
        if (await tcpConnects(port)) {
          log(`owned postmaster ${server.pid} ready on 127.0.0.1:${port}`);
          return port;
        }
      }
      await delay(50);
    }
    await stop(server, "SIGINT");
    if (!/could not bind|Address already in use/i.test(server.output))
      throw new Error("native_postgres_start_failed");
    log("port bind raced; retrying with a new OS-selected port");
  }
  throw new Error("native_postgres_port_attempts_exhausted");
}
function verifyTest(result: Result) {
  const count = (name: string) => {
    const matches = [
      ...result.output.matchAll(new RegExp(`^\\s*(\\d+) ${name}\\s*$`, "gm")),
    ];
    return matches.length === 1 ? Number(matches[0]?.[1]) : null;
  };
  const pass = count("pass"),
    failCount = count("fail") ?? 0,
    skip = count("skip") ?? 0;
  const marker = result.output
    .split("\n")
    .some((line) => line.startsWith("(pass) ") && line.includes(TEST_NAME));
  if (
    result.exitCode !== 0 ||
    pass !== 1 ||
    failCount !== 0 ||
    skip !== 0 ||
    !marker
  )
    throw new Error(
      "native_case_required_exactly_one_pass_zero_skip_zero_fail",
    );
  log("native test verdict: 1 pass / 0 skip / 0 fail");
}
async function teardown(cluster: Cluster, failed: boolean) {
  // No startup/test continuation runs concurrently with teardown. Every process
  // created before an await is tracked, including failed startup attempts.
  for (const child of [...owned])
    if (child !== cluster.server) await stop(child);
  if (cluster.server) {
    await stop(cluster.server, "SIGINT");
    await cluster.server.done;
    if (!cluster.server.closed) throw new Error("owned_postmaster_not_closed");
    writeFileSync(cluster.log, sanitized(cluster.server.output), {
      mode: 0o600,
    });
    if (
      cluster.ready &&
      cluster.port !== null &&
      (await tcpConnects(cluster.port))
    )
      throw new Error("owned_postgres_port_still_listening");
    if (failed && cluster.server.output)
      process.stderr.write(
        `[native-postgres] bounded startup/server log:\n${sanitized(cluster.server.output).slice(-16_384)}\n`,
      );
    log(
      cluster.ready
        ? "verified: owned postmaster exited and its port is closed"
        : "verified: owned startup process exited (no ready listener was attested)",
    );
  }
  rmSync(cluster.root, { recursive: true, force: true });
  if (existsSync(cluster.root))
    throw new Error("native_temp_directory_not_removed");
  log("verified: private cluster directory removed");
}

// Signal handlers only cancel. Main owns the single awaited cleanup path and
// cannot start another stage after cancellation, even during binary discovery.
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    if (cancel.signal.aborted) return;
    signalCode = signal === "SIGINT" ? 130 : 143;
    fail(`received ${signal}; awaiting child shutdown and cluster teardown`);
    cancel.abort();
  });
async function main() {
  let cluster: Cluster | null = null;
  let passed = false;
  try {
    const bin = await binaries();
    checkCancelled();
    const version = await command(
      [bin.postgres, "--version"],
      environment(),
      REPO_ROOT,
      10_000,
    );
    if (
      version.exitCode !== 0 ||
      !/^postgres \(PostgreSQL\) [^\r\n]{1,120}$/.test(version.stdout.trim())
    )
      throw new Error("native_postgres_version_unavailable");
    log(version.stdout.trim());
    checkCancelled();
    const root = realpathSync(mkdtempSync(join(tmpdir(), "galaxy-native-pg-")));
    chmodSync(root, 0o700);
    cluster = {
      root,
      data: join(root, "data"),
      sockets: join(root, "socket"),
      log: join(root, "postgres.log"),
      server: null,
      port: null,
      ready: false,
    };
    mkdirSync(cluster.sockets, { mode: 0o700 });
    mkdirSync(join(root, "home"), { mode: 0o700 });
    const password = randomBytes(24).toString("hex");
    secrets.push(password);
    const pwfile = join(root, "pwfile");
    writeFileSync(pwfile, `${password}\n`, { mode: 0o600 });
    try {
      const initialized = await command(
        [
          bin.initdb,
          "-D",
          cluster.data,
          "-U",
          "galaxy_native_ci",
          "-A",
          "scram-sha-256",
          "--pwfile",
          pwfile,
          "-E",
          "UTF8",
          "--no-instructions",
        ],
        environment(root),
        root,
        120_000,
      );
      if (initialized.exitCode !== 0) throw new Error("native_initdb_failed");
    } finally {
      if (existsSync(pwfile)) unlinkSync(pwfile);
    }
    checkCancelled();
    const port = await startCluster(bin, cluster);
    checkCancelled();
    const url = `postgres://galaxy_native_ci:${password}@127.0.0.1:${port}/postgres`;
    secrets.push(url);
    const childEnv = {
      ...environment(root),
      F10_F11_POSTGRES_URL: url,
      NO_COLOR: "1",
    };
    log(
      `running ${TEST_FILE} with an isolated environment and dotenv disabled`,
    );
    const result = await command(
      [process.execPath, "test", "--no-env-file", TEST_FILE],
      childEnv,
      REPO_ROOT,
      300_000,
      2 * 1024 * 1024,
    );
    process.stdout.write(sanitized(result.output));
    verifyTest(result);
    passed = true;
  } catch (error) {
    fail(error instanceof Error ? error.message : "native_verification_failed");
  } finally {
    try {
      if (cluster) await teardown(cluster, !passed || cancel.signal.aborted);
      else for (const child of [...owned]) await stop(child);
    } catch (error) {
      passed = false;
      fail(error instanceof Error ? error.message : "native_teardown_failed");
    }
  }
  if (cancel.signal.aborted) return signalCode;
  if (!passed) return 1;
  log(
    "native PostgreSQL verification passed; all owned processes and cluster removed",
  );
  return 0;
}
process.exitCode = 1;
await main().then(
  (code) => {
    process.exitCode = code;
  },
  () => {
    fail("unexpected_native_harness_failure");
    process.exitCode = 1;
  },
);
