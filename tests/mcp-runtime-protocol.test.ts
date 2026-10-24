import { expect, mock, test } from "bun:test";
import { generateKeyPairSync, sign } from "node:crypto";

mock.module("server-only", () => ({}));
const { runtimeFrames, parseRuntimeResult } = await import(
  "@/lib/mcp/runtime-protocol"
);
const { canonicalJson } = await import("@/lib/funding/config");
const { verifyBrokerEvidence, runtimeBodyHash } = await import(
  "@/lib/mcp/broker-evidence"
);
const frames = runtimeFrames(
  "reviewed_tool",
  { message: "safe" },
  { initialize: crypto.randomUUID(), call: crypto.randomUUID() },
);
const bytes = (v: unknown) => Buffer.from(JSON.stringify(v));
test("adapter creates only the three approved methods, with exact request/notification IDs", () => {
  expect(Object.values(frames).map((f) => f.method)).toEqual([
    "initialize",
    "notifications/initialized",
    "tools/call",
  ]);
  expect(Reflect.has(frames.initialized, "id")).toBe(false);
  expect(Object.isFrozen(frames.call.params.arguments)).toBe(true);
});
for (const result of [
  { task: { taskId: "unknown" } },
  { content: [{ type: "image", data: "untrusted" }] },
  { content: [], isError: true },
  { content: [], extra: true },
  { content: [], structuredContent: { surprise: true } },
])
  test("unsupported tool result cannot pass the synchronous result boundary", () => {
    expect(() =>
      parseRuntimeResult(
        "call",
        bytes({ jsonrpc: "2.0", id: frames.call.id, result }),
        200,
        frames.call,
        null,
      ),
    ).toThrow("mcp_runtime_protocol_rejected");
  });
for (const frame of [
  { jsonrpc: "2.0", id: "server", method: "ping" },
  { jsonrpc: "2.0", method: "notifications/progress" },
  {
    jsonrpc: "2.0",
    id: frames.call.id,
    error: { code: 1, message: "untrusted" },
  },
  { jsonrpc: "2.0", id: "different", result: { content: [] } },
  [{ jsonrpc: "2.0", id: frames.call.id, result: { content: [] } }],
])
  test("server requests, notifications, errors, batches and mismatched IDs produce no automatic replies", () => {
    expect(() =>
      parseRuntimeResult("call", bytes(frame), 200, frames.call, null),
    ).toThrow("mcp_runtime_protocol_rejected");
  });
for (const result of [
  {
    protocolVersion: "2026-07-28",
    capabilities: { tools: {} },
    serverInfo: { name: "test", version: "1" },
  },
  {
    protocolVersion: "2025-11-25",
    capabilities: { tools: {}, tasks: {} },
    serverInfo: { name: "test", version: "1" },
  },
  {
    protocolVersion: "2025-11-25",
    capabilities: { tools: {} },
    serverInfo: { name: "test", version: "1" },
    instructions: "never instructions",
  },
])
  test("initialization pins version/capability subset and rejects task/model-instruction channels", () => {
    expect(() =>
      parseRuntimeResult(
        "initialize",
        bytes({ jsonrpc: "2.0", id: frames.initialize.id, result }),
        200,
        frames.initialize,
        null,
      ),
    ).toThrow("mcp_runtime_protocol_rejected");
  });
test("notification accepts only empty 202/204; UTF8 and payload bounds fail closed", () => {
  for (const status of [202, 204])
    expect(
      parseRuntimeResult(
        "initialized",
        Buffer.alloc(0),
        status,
        frames.initialized,
        null,
      ),
    ).toBeNull();
  for (const [body, status] of [
    [Buffer.from("{}"), 202],
    [Buffer.alloc(0), 200],
    [Buffer.alloc(5000), 200],
    [Buffer.from([255]), 200],
  ] as const)
    expect(() =>
      parseRuntimeResult(
        status === 202 ? "initialized" : "call",
        body,
        status,
        frames.call,
        null,
      ),
    ).toThrow("mcp_runtime_protocol_rejected");
});
test("Ed25519 evidence binds all request/response identities, expiration and broker-only signing key", () => {
  const keys = generateKeyPairSync("ed25519"),
    other = generateKeyPairSync("ed25519"),
    now = Date.now(),
    e = {
      version: 2 as const,
      operationId: crypto.randomUUID(),
      frameId: crypto.randomUUID(),
      requestId: crypto.randomUUID(),
      manifestDigest: "a".repeat(64),
      profileDigest: "b".repeat(64),
      bodyHash: runtimeBodyHash(Buffer.from("request")),
      responseHash: runtimeBodyHash(Buffer.from("response")),
      status: 200,
      purpose: "mcp.call" as const,
      phase: "terminal" as const,
      terminal: true as const,
      issuedAt: now,
      expiresAt: now + 10000,
      keyVersion: "v1",
    },
    signature = sign(
      null,
      Buffer.from(`galaxy-mcp-transport-evidence-v2\n${canonicalJson(e)}`),
      keys.privateKey,
    ).toString("base64"),
    pub = keys.publicKey
      .export({ format: "der", type: "spki" })
      .toString("base64"),
    {
      version: _v,
      phase: _p,
      terminal: _t,
      issuedAt: _i,
      expiresAt: _x,
      ...expected
    } = e;
  expect(
    verifyBrokerEvidence({ evidence: e, signature }, expected, pub, now)
      .evidence,
  ).toEqual(e);
  for (const field of [
    "operationId",
    "frameId",
    "requestId",
    "manifestDigest",
    "profileDigest",
    "bodyHash",
    "responseHash",
    "status",
    "purpose",
    "keyVersion",
  ]) {
    expect(() =>
      verifyBrokerEvidence(
        { evidence: e, signature },
        { ...expected, [field]: "changed" },
        pub,
        now,
      ),
    ).toThrow("mcp_broker_evidence_rejected");
  }
  for (const [proof, key, time] of [
    [{ evidence: { ...e, issuedAt: now + 5000 }, signature }, pub, now],
    [{ evidence: e, signature }, pub, now + 20000],
    [
      { evidence: e, signature },
      other.publicKey
        .export({ format: "der", type: "spki" })
        .toString("base64"),
      now,
    ],
    [{ evidence: { ...e, extra: true }, signature }, pub, now],
  ] as const)
    expect(() => verifyBrokerEvidence(proof, expected, key, time)).toThrow(
      "mcp_broker_evidence_rejected",
    );
});

test("0021 upgrades populated legacy ledger states without rewriting financial evidence or commitments", async () => {
  const { readdirSync, readFileSync } = await import("node:fs");
  const { PGlite } = await import("@electric-sql/pglite");
  const { rejectionOf } = await import("./helpers/rejection");
  const db = await PGlite.create();
  try {
    for (const file of readdirSync("drizzle")
      .filter((file) => file.endsWith(".sql") && file < "0021")
      .sort())
      await db.exec(readFileSync(`drizzle/${file}`, "utf8"));
    await db.query(
      "INSERT INTO mcp_operation_period(month,plan_identity,sources_digest) VALUES('2026-10','{}', $1)",
      ["a".repeat(64)],
    );
    for (const state of [
      "reserved",
      "entered",
      "held",
      "settled",
      "released",
    ]) {
      const id = crypto.randomUUID(),
        receiptId = state === "settled" ? crypto.randomUUID() : null;
      const receipt = receiptId
        ? {
            id: receiptId,
            operationId: id,
            bindingDigest: "a".repeat(64),
            evidenceDigest: "b".repeat(64),
            incurredMicrodollars: 250,
            terminal: true,
            revision: "legacy-v1",
          }
        : null;
      await db.query(
        `INSERT INTO mcp_operation(id,actor_key,actor_version,idempotency_key,binding_digest,identity,fee_snapshot,month,day,state,reserved_microdollars,incurred_microdollars,attempts,deadline,receipt_id,receipt) VALUES($1,$2,'legacy-v1',$1,$3,'{}','{}','2026-10','2026-10-01',$4,1000,$5,$6,'2030-01-01',$7,$8::jsonb)`,
        [
          id,
          "c".repeat(64),
          "a".repeat(64),
          state,
          state === "settled" ? 250 : 0,
          ["reserved", "released"].includes(state) ? 0 : 1,
          receiptId,
          receipt ? JSON.stringify(receipt) : null,
        ],
      );
      await db.query(
        "INSERT INTO mcp_operation_commitment(month,source_id,amount_microdollars) VALUES('2026-10',$1,1000)",
        [id],
      );
      await db.query(
        "INSERT INTO mcp_operation_audit(id,operation_id,event,revision) VALUES($1,$2,$3,1)",
        [crypto.randomUUID(), id, state],
      );
    }
    const queries = [
      "SELECT * FROM mcp_operation ORDER BY id",
      "SELECT * FROM mcp_operation_period",
      "SELECT * FROM mcp_operation_commitment ORDER BY source_id",
      "SELECT * FROM mcp_operation_audit ORDER BY id",
    ];
    const before = [];
    for (const query of queries) before.push((await db.query(query)).rows);
    await db.exec(readFileSync("drizzle/0021_mcp_execution.sql", "utf8"));
    for (const [index, query] of queries.entries())
      expect((await db.query(query)).rows).toEqual(before[index]);
    expect(
      await rejectionOf(db.exec("DELETE FROM mcp_operation")),
    ).toMatchObject({ message: "mcp financial records are retained" });
    expect(
      await rejectionOf(
        db.exec(
          "UPDATE mcp_operation SET reserved_microdollars=0,revision=revision+1",
        ),
      ),
    ).toMatchObject({ message: "mcp operation identity is immutable" });
    expect(
      await rejectionOf(db.exec("DELETE FROM mcp_operation_commitment")),
    ).toMatchObject({ message: "mcp retained record is immutable" });
  } finally {
    await db.close();
  }
});
