import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { request as tlsRequest } from "node:https";
import { type AddressInfo, connect as netConnect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after, before } from "node:test";
import { setImmediate } from "node:timers/promises";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import postgres from "postgres";
import { createBroker } from "../src/broker.js";
import { loadConfig } from "../src/config.js";
import {
  canonical,
  openCredential,
  parseEnvelope,
  sealCredential,
  sign,
} from "../src/protocol.js";
import {
  MemoryReplayStore,
  PostgresReplayStore,
  type ReplayStore,
} from "../src/replay-store.js";
import { createBrokerServer } from "../src/server.js";
import {
  certificates,
  config,
  envelope,
  offlineDial,
  profile,
  rawProfile,
  upstream,
} from "./helpers.js";

let cert: ReturnType<typeof certificates>;
before(() => {
  cert = certificates();
});
after(() => cert.close());
const signal = () => new AbortController().signal;

function ingress(
  port: number,
  value: unknown,
  signature: string,
  options: { path?: string; method?: string; type?: string; raw?: string } = {},
) {
  return new Promise<{ status: number; text: string }>((resolve, reject) => {
    const body = options.raw ?? JSON.stringify(value);
    const req = request(
      {
        host: "127.0.0.1",
        port,
        path: options.path ?? "/v1/egress",
        method: options.method ?? "POST",
        headers: {
          "content-type": options.type ?? "application/json",
          "content-length": Buffer.byteLength(body),
          "x-mcp-signature": signature,
        },
        agent: false,
      },
      (res) => {
        let text = "";
        res.on("data", (chunk) => {
          text += chunk;
        });
        res.on("end", () => resolve({ status: res.statusCode ?? 0, text }));
      },
    );
    req.once("error", reject);
    req.end(body);
  });
}

test("HMAC tamper, stale/replay/substitution, encrypted AAD changes deny before DNS", async () => {
  let resolves = 0;
  const c = config([profile({ credential: "bearer" })]);
  const broker = createBroker(c, new MemoryReplayStore(), {
    resolve: async () => {
      resolves++;
      throw new Error("secret raw upstream token");
    },
  });
  const p = c.profiles[0];
  const base = envelope(p);
  const sealed = {
    ...base,
    credential: sealCredential(
      base,
      p,
      "connection1",
      "top-secret-token",
      c.envelopeKey,
    ),
  };
  const signature = sign(sealed, c.hmacKey);
  const mutations = [
    { ...sealed, operationId: "00000000-0000-0000-0000-000000000000" },
    { ...sealed, body: Buffer.from("changed").toString("base64") },
    { ...sealed, purpose: "mcp.list" },
    { ...sealed, method: "GET" },
    { ...sealed, url: "https://evil.example/" },
    { ...sealed, headers: { Authorization: "stolen" } },
    { ...sealed, issuedAt: Date.now() - 31000, deadline: Date.now() - 20000 },
  ];
  for (const change of mutations)
    await assert.rejects(broker(change, signature, signal()));
  assert.equal(resolves, 0);
  for (const change of [
    { ...sealed, requestId: "00000000-0000-0000-0000-000000000000" },
    { ...sealed, operationId: "00000000-0000-0000-0000-000000000000" },
    {
      ...sealed,
      credential: { ...sealed.credential, connectionRevision: "different" },
    },
  ]) {
    const isolated = createBroker(c, new MemoryReplayStore(), {
      resolve: async () => {
        resolves++;
        return [];
      },
    });
    await assert.rejects(
      isolated(change, sign(change, c.hmacKey), signal()),
      /authentication/,
    );
  }
  assert.equal(resolves, 0);
  // Failed credential validation still consumes the nonce, safely denying reuse.
  const broken = {
    ...sealed,
    credential: { ...sealed.credential, connectionRevision: "different" },
  };
  await assert.rejects(
    broker(broken, sign(broken, c.hmacKey), signal()),
    /authentication/,
  );
  await assert.rejects(broker(sealed, signature, signal()), /replay/);
  assert.equal(resolves, 0);
  assert(!canonical(sealed).includes("top-secret-token"));
});

test("encrypted bearer enters only fixed Authorization; no plaintext credential field", async () => {
  let seen = "";
  const fixture = await upstream(cert, (req, res) => {
    seen = req.headers.authorization ?? "";
    res.writeHead(200, { "content-type": "application/json" });
    res.end("{}");
  });
  const c = config([profile({ credential: "bearer" })]);
  const broker = createBroker(
    c,
    new MemoryReplayStore(),
    offlineDial(fixture.port, cert.ca).dependencies,
  );
  const e = envelope(c.profiles[0]);
  const signed = {
    ...e,
    credential: sealCredential(
      e,
      c.profiles[0],
      "connection1",
      "secret-access-token",
      c.envelopeKey,
    ),
  };
  try {
    await broker(signed, sign(signed, c.hmacKey), signal());
    assert.equal(seen, "Bearer secret-access-token");
    await assert.rejects(
      broker(signed, sign(signed, c.hmacKey), signal()),
      /replay/,
    );
    await assert.rejects(
      broker({ ...envelope(), token: "plaintext" }, "0".repeat(64), signal()),
    );
  } finally {
    await fixture.close();
  }
});

test("OAuth refresh/revoke tokens are envelope-only and fixed forms reject substitutions", async () => {
  for (const purpose of ["oauth.refresh", "oauth.revoke"] as const) {
    let observed = "";
    const fixture = await upstream(cert, (req, res) => {
      assert.equal(req.headers.authorization, undefined);
      req.on("data", (chunk) => {
        observed += chunk;
      });
      req.on("end", () => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end("{}");
      });
    });
    const p = profile({
      purpose,
      credential: purpose === "oauth.refresh" ? "refresh" : "revoke",
      contentType: "application/x-www-form-urlencoded",
      formFields: { client_id: "reviewed-client", scope: "read" },
      clientSecretRef: "client-secret",
    });
    const c = {
      ...config([p]),
      secrets: { "client-secret": "server-client-secret" },
    };
    const broker = createBroker(
      c,
      new MemoryReplayStore(),
      offlineDial(fixture.port, cert.ca).dependencies,
    );
    const e = envelope(p, Buffer.from(""));
    const signed = {
      ...e,
      credential: sealCredential(
        e,
        p,
        "connection1",
        "secret-refresh-token",
        c.envelopeKey,
      ),
    };
    try {
      await broker(signed, sign(signed, c.hmacKey), signal());
      const form = new URLSearchParams(observed);
      assert.equal(
        form.get(purpose === "oauth.refresh" ? "refresh_token" : "token"),
        "secret-refresh-token",
      );
      assert.equal(form.get("resource"), p.resource);
      assert.equal(form.get("client_id"), "reviewed-client");
      assert.equal(form.get("client_secret"), "server-client-secret");
      assert.equal(form.get("scope"), "read");
      for (const body of [
        "refresh_token=plaintext",
        "resource=https://evil.example/",
        "client_secret=plaintext",
        "url=https://127.0.0.1/",
        "client_id=evil",
        "scope=write",
      ]) {
        const next = envelope(p, Buffer.from(body));
        const sealed = {
          ...next,
          credential: sealCredential(
            next,
            p,
            "connection1",
            "secret-refresh-token",
            c.envelopeKey,
          ),
        };
        await assert.rejects(
          broker(sealed, sign(sealed, c.hmacKey), signal()),
          /invalid_request/,
        );
      }
    } finally {
      await fixture.close();
    }
  }
});

test("real bounded ingress rejects routes, auth, oversized envelopes and redacts upstream errors", async () => {
  const c = config();
  let resolves = 0;
  const app = await createBrokerServer(c, new MemoryReplayStore(), {
    resolve: async () => {
      resolves++;
      throw new Error("https://secret.example/?token=DO_NOT_LOG");
    },
  });
  await new Promise<void>((resolve) => app.server.listen(0, c.bind, resolve));
  const port = (app.server.address() as AddressInfo).port;
  try {
    for (const options of [
      { path: "/" },
      { method: "GET" },
      { type: "text/plain" },
      { raw: "{" },
    ]) {
      const e = envelope();
      const response = await ingress(port, e, sign(e, c.hmacKey), options);
      assert.equal(response.status, 400);
    }
    const e = envelope();
    const rejected = await ingress(port, e, "0".repeat(64));
    assert.equal(rejected.status, 401);
    assert.equal(resolves, 0);
    const oversize = await ingress(port, {}, "0".repeat(64), {
      raw: "x".repeat(96 * 1024 + 1),
    });
    assert.equal(oversize.status, 413);
    const result = await ingress(port, e, sign(e, c.hmacKey));
    assert.equal(result.status, 502);
    assert.equal(result.text, '{"error":"destination"}');
    assert.equal(resolves, 1);
    assert(!result.text.includes("DO_NOT_LOG"));
  } finally {
    await app.close();
  }
});

test("ingress concurrency cap and disconnect cancellation release the active slot", async () => {
  const c = { ...config(), concurrency: 1 };
  let entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const fixture = await upstream(cert, (_req, _res) => {
    entered();
  });
  const app = await createBrokerServer(
    c,
    new MemoryReplayStore(),
    offlineDial(fixture.port, cert.ca).dependencies,
  );
  await new Promise<void>((resolve) => app.server.listen(0, c.bind, resolve));
  const port = (app.server.address() as AddressInfo).port;
  const e = envelope();
  const req = request({
    host: "127.0.0.1",
    port,
    path: "/v1/egress",
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-mcp-signature": sign(e, c.hmacKey),
    },
  });
  req.on("error", () => {});
  req.end(JSON.stringify(e));
  try {
    await started;
    const next = envelope();
    assert.equal(
      (await ingress(port, next, sign(next, c.hmacKey))).status,
      503,
    );
    req.destroy();
    await new Promise((resolve) => setTimeout(resolve, 40));
    const fresh = envelope();
    const result = await ingress(port, fresh, sign(fresh, c.hmacKey));
    assert.equal(result.status, 502);
    assert.equal(result.text, '{"error":"timeout"}');
  } finally {
    req.destroy();
    await app.close();
    await fixture.close();
  }
});

test("production refuses ephemeral replay; unavailable durable store fails startup", async () => {
  await assert.rejects(
    createBrokerServer(
      { ...config(), production: true },
      new MemoryReplayStore(),
    ),
    /configuration/,
  );
  const bad: ReplayStore = {
    durable: true,
    ready: async () => {
      throw new Error("unavailable");
    },
    consume: async () => true,
  };
  await assert.rejects(
    createBrokerServer({ ...config(), production: true }, bad),
    /unavailable/,
  );
});

test("remote TLS listener requires a verified client certificate before ingress", async () => {
  const c = {
    ...config(),
    bind: "0.0.0.0",
    tls: { key: cert.key, cert: cert.cert, ca: cert.ca },
  };
  const app = await createBrokerServer(c, new MemoryReplayStore());
  await new Promise<void>((resolve) => app.server.listen(0, c.bind, resolve));
  const port = (app.server.address() as AddressInfo).port;
  try {
    await assert.rejects(
      new Promise((resolve, reject) => {
        const req = tlsRequest(
          {
            host: "127.0.0.1",
            port,
            servername: "broker.example",
            ca: cert.ca,
            method: "POST",
            path: "/v1/egress",
          },
          resolve,
        );
        req.once("error", reject);
        req.end();
      }),
    );
  } finally {
    await app.close();
  }
});

test("strict config reads files; nonloopback requires explicit opt-in and complete mTLS material", () => {
  const dir = mkdtempSync(join(tmpdir(), "egress-config-"));
  const profilesFile = join(dir, "profiles.json");
  writeFileSync(profilesFile, JSON.stringify([rawProfile()]));
  const env = {
    MCP_EGRESS_BROKER_ENABLED: "1",
    MCP_EGRESS_HMAC_KEY: Buffer.alloc(32, 1).toString("base64"),
    MCP_EGRESS_ENVELOPE_KEY: Buffer.alloc(32, 2).toString("base64"),
    MCP_EGRESS_PROFILES_FILE: profilesFile,
  };
  try {
    const loaded = loadConfig(env);
    assert.equal(loaded?.bind, "127.0.0.1");
    assert.equal(loaded?.production, true);
    assert.throws(() => loadConfig({ ...env, MCP_EGRESS_BIND: "0.0.0.0" }));
    assert.throws(() =>
      loadConfig({
        ...env,
        MCP_EGRESS_BIND: "0.0.0.0",
        MCP_EGRESS_REMOTE_BIND: "1",
      }),
    );
    const files = {
      MCP_EGRESS_TLS_KEY_FILE: join(dir, "key"),
      MCP_EGRESS_TLS_CERT_FILE: join(dir, "cert"),
      MCP_EGRESS_CLIENT_CA_FILE: join(dir, "ca"),
    };
    writeFileSync(files.MCP_EGRESS_TLS_KEY_FILE, cert.key);
    writeFileSync(files.MCP_EGRESS_TLS_CERT_FILE, cert.cert);
    writeFileSync(files.MCP_EGRESS_CLIENT_CA_FILE, cert.ca);
    assert.throws(() =>
      loadConfig({ ...env, ...files, MCP_EGRESS_BIND: "0.0.0.0" }),
    );
    assert(
      loadConfig({
        ...env,
        ...files,
        MCP_EGRESS_BIND: "0.0.0.0",
        MCP_EGRESS_REMOTE_BIND: "1",
      })?.tls,
    );
    assert.throws(() => loadConfig({ ...env, MCP_EGRESS_HMAC_KEY: "short" }));
    assert.throws(() =>
      loadConfig({ ...env, MCP_EGRESS_ENVELOPE_KEY: env.MCP_EGRESS_HMAC_KEY }),
    );
    writeFileSync(
      profilesFile,
      JSON.stringify([{ ...rawProfile(), accessToken: "secret" }]),
    );
    assert.throws(() => loadConfig(env));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("two broker instances share atomic durable SQL replay; persisted nonce survives store recreation", async () => {
  const db = await PGlite.create();
  // Test migration source, not a hand-written fake schema. This engine executes
  // PostgreSQL constraints; socket fixture is offline loopback only.
  await db.exec(
    readFileSync(
      join(process.cwd(), "../../drizzle/0012_mcp_egress_replay.sql"),
      "utf8",
    ),
  );
  const socket = new PGLiteSocketServer({
    db,
    host: "127.0.0.1",
    port: 0,
    maxConnections: 1,
  });
  await socket.start();
  const sql = postgres(
    `postgres://postgres:postgres@${socket.getServerConn()}/postgres`,
    { max: 1, prepare: false },
  );
  try {
    const storeA = new PostgresReplayStore(sql);
    const storeB = new PostgresReplayStore(sql);
    await storeA.ready();
    await storeB.ready();
    let resolves = 0;
    const deps = {
      resolve: async () => {
        resolves++;
        throw new Error("offline failure");
      },
    };
    const c = { ...config(), production: true };
    const a = createBroker(c, storeA, deps);
    const b = createBroker(c, storeB, deps);
    const e = envelope();
    const sig = sign(e, c.hmacKey);
    const results = await Promise.allSettled([
      a(e, sig, signal()),
      b(e, sig, signal()),
    ]);
    assert.deepEqual(
      results
        .map((r) => (r.status === "rejected" ? r.reason.message : "success"))
        .sort(),
      ["destination", "replay"],
    );
    assert.equal(resolves, 1);
    const restored = new PostgresReplayStore(sql);
    assert.equal(
      await restored.consume(e.requestId, Date.now() + 60000, Date.now()),
      false,
    );
  } finally {
    await sql.end({ timeout: 1 });
    await setImmediate();
    await socket.stop();
    await setImmediate();
    await db.runExclusive(async () => {});
    await db.close();
  }
});

test("hung replay respects operation abort/deadline and cannot dial later", async () => {
  let resolves = 0;
  const store: ReplayStore = {
    durable: true,
    ready: async () => {},
    consume: () =>
      new Promise((resolve) => setTimeout(() => resolve(true), 80)),
  };
  const c = config();
  const broker = createBroker(c, store, {
    resolve: async () => {
      resolves++;
      return [];
    },
  });
  const e = envelope(undefined, undefined, { deadline: Date.now() + 20 });
  await assert.rejects(broker(e, sign(e, c.hmacKey), signal()), /timeout/);
  const abort = new AbortController();
  const next = envelope();
  const pending = broker(next, sign(next, c.hmacKey), abort.signal);
  abort.abort();
  await assert.rejects(pending, /cancelled/);
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(resolves, 0);
});

test("strict envelope byte/hash/time/credential formats fail closed", () => {
  const e = envelope();
  for (const change of [
    { body: "YQ" },
    { bodyHash: "x" },
    { version: 2 },
    { deadline: e.issuedAt + 20001 },
    { requestId: "notuuid" },
    {
      credential: { connectionRevision: "r", iv: "", ciphertext: "", tag: "" },
    },
  ])
    assert.throws(() => parseEnvelope({ ...e, ...change }, Date.now()));
  assert.throws(() =>
    parseEnvelope(
      { ...e, issuedAt: Date.now() + 31000, deadline: Date.now() + 32000 },
      Date.now(),
    ),
  );
});

test("credential AAD binds every identity dimension including issuer and resource", () => {
  const p = profile({ credential: "bearer" });
  const c = config([p]);
  const e = envelope(p);
  const signed = {
    ...e,
    credential: sealCredential(
      e,
      p,
      "connection1",
      "secret-token",
      c.envelopeKey,
    ),
  };
  assert.equal(openCredential(signed, p, c.envelopeKey), "secret-token");
  for (const changed of [
    { ...p, profileId: "other" },
    { ...p, revision: "other" },
    { ...p, purpose: "mcp.list" as const },
    { ...p, resource: "https://other.example/" },
    { ...p, issuer: "https://other.example/" },
  ])
    assert.throws(
      () => openCredential(signed, changed, c.envelopeKey),
      /authentication/,
    );
  assert.throws(
    () => openCredential(signed, p, Buffer.alloc(32, 3)),
    /authentication/,
  );
});

test("entrypoint is inert by default even with unusable database/profiles settings", () => {
  const result = spawnSync(
    process.execPath,
    ["../../build/mcp-egress/src/main.js"],
    {
      env: {
        ...process.env,
        MCP_EGRESS_BROKER_ENABLED: "0",
        MCP_EGRESS_DATABASE_URL: "not-a-database",
        MCP_EGRESS_PROFILES_FILE: "/does-not-exist",
      },
      encoding: "utf8",
      timeout: 3000,
    },
  );
  assert.equal(result.status, 0);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "");
});

test("incomplete ingress sockets count toward the connection cap and oversized headers close", async () => {
  const c = { ...config(), concurrency: 1, maxConnections: 1 };
  const app = await createBrokerServer(c, new MemoryReplayStore());
  await new Promise<void>((resolve) => app.server.listen(0, c.bind, resolve));
  const port = (app.server.address() as AddressInfo).port;
  const open = () =>
    new Promise<ReturnType<typeof netConnect>>((resolve, reject) => {
      const socket = netConnect({ host: "127.0.0.1", port }, () =>
        resolve(socket),
      );
      socket.on("error", reject);
    });
  const first = await open();
  try {
    const second = await open();
    const dropped = new Promise<void>((resolve) =>
      second.once("close", () => resolve()),
    );
    await dropped;
    assert.equal(second.destroyed, true);
    const count = await new Promise<number>((resolve, reject) =>
      app.server.getConnections((error, count) =>
        error ? reject(error) : resolve(count),
      ),
    );
    assert.equal(count, 1);
    const closed = new Promise<void>((resolve) =>
      first.once("close", () => resolve()),
    );
    first.write(
      `POST /v1/egress HTTP/1.1\r\nHost: loopback\r\nX-Oversized: ${"x".repeat(9000)}\r\n\r\n`,
    );
    await closed;
  } finally {
    first.destroy();
    await app.close();
  }
});
