import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createServer, type Server } from "node:https";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type ConnectionOptions, connect, type TLSSocket } from "node:tls";
import type { BrokerConfig } from "../src/config.js";
import type { TransportDependencies } from "../src/pinned-https.js";
import { type Profile, parseProfiles } from "../src/profile.js";
import type { Envelope } from "../src/protocol.js";

export const PUBLIC = "93.184.216.34";
export function rawProfile(overrides: Record<string, unknown> = {}) {
  return {
    profileId: "reviewed",
    revision: "r1",
    purpose: "mcp.call",
    endpoint: "https://broker.example/mcp",
    contentType: "application/json",
    responseTypes: ["application/json"],
    maxRequestBytes: 65536,
    maxResponseBytes: 65536,
    timeoutMs: 1000,
    connectMs: 500,
    firstByteMs: 500,
    resource: "https://resource.example/mcp",
    issuer: "https://issuer.example/",
    credential: "none",
    ...overrides,
  };
}
export function profile(overrides: Record<string, unknown> = {}): Profile {
  return parseProfiles([rawProfile(overrides)])[0];
}
export function config(profiles = [profile()]): BrokerConfig {
  return {
    bind: "127.0.0.1",
    port: 0,
    production: false,
    hmacKey: Buffer.alloc(32, 1),
    envelopeKey: Buffer.alloc(32, 2),
    profiles,
    secrets: {},
    concurrency: 2,
    maxConnections: 8,
  };
}
export function envelope(
  p = profile(),
  body = Buffer.from("{}"),
  overrides: Partial<Envelope> = {},
): Envelope {
  return {
    version: 1,
    requestId: randomUUID(),
    operationId: randomUUID(),
    issuedAt: Date.now(),
    deadline: Date.now() + 1000,
    profileId: p.profileId,
    revision: p.revision,
    purpose: p.purpose,
    bodyHash: createHash("sha256").update(body).digest("hex"),
    body: body.toString("base64"),
    ...overrides,
  };
}
export function certificates() {
  const dir = mkdtempSync(join(tmpdir(), "galaxy-egress-ca-"));
  const run = (...args: string[]) =>
    execFileSync("openssl", args, { cwd: dir, stdio: "ignore" });
  run(
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-keyout",
    "ca.key",
    "-out",
    "ca.crt",
    "-days",
    "2",
    "-subj",
    "/CN=Galaxy offline CA",
  );
  writeFileSync(
    join(dir, "ext"),
    "subjectAltName=DNS:broker.example\nextendedKeyUsage=serverAuth\n",
  );
  run(
    "req",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-keyout",
    "server.key",
    "-out",
    "server.csr",
    "-subj",
    "/CN=broker.example",
  );
  run(
    "x509",
    "-req",
    "-in",
    "server.csr",
    "-CA",
    "ca.crt",
    "-CAkey",
    "ca.key",
    "-CAcreateserial",
    "-out",
    "server.crt",
    "-days",
    "2",
    "-extfile",
    "ext",
  );
  return {
    ca: readFileSync(join(dir, "ca.crt")),
    key: readFileSync(join(dir, "server.key")),
    cert: readFileSync(join(dir, "server.crt")),
    close: () => rmSync(dir, { recursive: true, force: true }),
  };
}
export async function upstream(
  cert: ReturnType<typeof certificates>,
  handler: (req: IncomingMessage, res: ServerResponse) => void,
) {
  const server = createServer({ key: cert.key, cert: cert.cert }, handler);
  server.on("tlsClientError", () => {});
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    server,
    port: (server.address() as AddressInfo).port,
    close: () => closeServer(server),
  };
}
export async function closeServer(server: Server): Promise<void> {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}
export function offlineDial(
  port: number,
  ca: Buffer,
  options: {
    remoteAddress?: string;
    trust?: boolean;
    inspect?: (options: ConnectionOptions) => void;
  } = {},
) {
  const sockets: TLSSocket[] = [];
  const dial = (input: ConnectionOptions) => {
    options.inspect?.(input);
    assert.equal(input.rejectUnauthorized, true);
    assert.equal(input.servername, "broker.example");
    assert.equal(typeof input.checkServerIdentity, "function");
    assert.equal(typeof input.lookup, "function");
    input.lookup?.(
      "broker.example",
      { family: 4 },
      (error, address, family) => {
        assert.equal(error, null);
        assert.equal(address, PUBLIC);
        assert.equal(family, 4);
      },
    );
    const socket = connect({
      ...input,
      host: "127.0.0.1",
      port,
      lookup: undefined,
      ...(options.trust === false ? {} : { ca }),
    });
    // This fixture maps the public pin onto an offline loopback socket. The
    // production secureConnect check remains intact; mismatch tests vary it.
    Object.defineProperty(socket, "remoteAddress", {
      get: () => options.remoteAddress ?? PUBLIC,
    });
    sockets.push(socket);
    return socket;
  };
  const dependencies: TransportDependencies = {
    resolve: async () => [{ address: PUBLIC, family: 4 }],
    connect: dial,
  };
  return { dependencies, sockets };
}
