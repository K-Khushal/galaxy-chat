import "server-only";
import { createHmac, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { isInvitedLogin, parseInviteLogins } from "@/lib/auth/env";
import { resourceActor, resourceDigest } from "@/lib/byok/config";
import { lockByokResources } from "@/lib/byok/store";
import {
  type Database,
  type DatabaseTransaction,
  requireDb,
} from "@/lib/db/client";
import { AppError } from "@/lib/errors";
import {
  canonicalJson,
  deepFreeze,
  resolvePlatformBudgetConfig,
} from "@/lib/funding/config";
import { resolveToolModel } from "@/lib/tools/config";
import { TOOL_LIMITS, toolRunRequest } from "@/lib/tools/contract";
import {
  type ActionBinding,
  canonical,
  decideToolApprovalInTx,
  issueToolApprovalInTx,
} from "@/lib/tools/store";
import { parseCatalogImport } from "./catalog-contract";
import { parseProfilesJson, profileKey } from "./config";
import {
  adoptionInput,
  executionInput,
  parseExecution,
  runtimeActionSchema,
} from "./execution-contract";
import {
  type OperationIntent,
  operationDigest,
  parseOperationIntent,
} from "./operation-contract";
import { computeProfileDigest } from "./registry-contract";
import {
  appProfile,
  FRAME_KINDS,
  type FrameKind,
  resolveRuntimeConfig,
} from "./runtime-config";
import { runtimeFrames } from "./runtime-protocol";
import { ownMcpArguments, parseMcpArguments } from "./schema-policy";

type Tx = DatabaseTransaction;
export type RuntimeFrame = {
  id: string;
  execution_id: string;
  user_id: string;
  ordinal: number;
  kind: FrameKind;
  operation_id: string;
  approval_id: string;
  tool_call_id: string;
  body: unknown;
  binding: ActionBinding;
  intent: OperationIntent;
  digest: string;
  state: string;
  revision: number;
};
function fail(id = "mcp_execution_changed", status = 409): never {
  throw new AppError(id, status);
}
function equal(a: unknown, b: unknown) {
  if (canonicalJson(a) !== canonicalJson(b)) fail();
}
export function executionStorageError(error: unknown): never {
  if (error instanceof AppError) throw error;
  throw new AppError("mcp_execution_storage_unavailable", 503);
}
type LiveRuntimeAuthority = {
  request: unknown;
  created_at: string;
  state: string;
  actor_key: string;
  digest: string;
  approval_state: string;
  expires_at: string;
  binding: unknown;
  call_state: string;
  call_name: string;
};
export async function runtimeContextInTx(
  tx: Tx,
  userId: string,
  id: string,
  authority?: { runId: string; toolCallId: string; approvalId: string },
) {
  // One final statement observes mutable run/credential/approval/call authority
  // together with adoption, profiles, invitation, control and the current DB clock.
  const snapshot = authority
    ? sql`(SELECT jsonb_build_object('request',tr.request,'created_at',tr.created_at,'state',tr.state,'actor_key',bo.actor_key,'digest',bo.digest,'approval_state',ta.state,'expires_at',ta.expires_at,'binding',ta.binding,'call_state',tc.state,'call_name',tc.name) FROM tool_run tr JOIN byok_operation bo ON bo.id=tr.id AND bo.state='entered' AND bo.kind='chat' AND bo.resource_units=3 AND bo.provider=tr.request->>'funding' JOIN provider_credential pc ON pc.user_id=tr.user_id AND pc.provider=bo.provider AND pc.revision=bo.credential_revision AND pc.test_state<>'invalid' JOIN tool_approval ta ON ta.run_id=tr.id AND ta.user_id=tr.user_id JOIN tool_call tc ON tc.run_id=tr.id AND tc.id=${authority.toolCallId} WHERE tr.id=${authority.runId} AND tr.user_id=${userId} AND ta.id=${authority.approvalId})`
    : sql`NULL::jsonb`;
  const [r] = await tx.execute<{
    now: Date;
    live_authority: LiveRuntimeAuthority | null;
    stopped: boolean;
    github_login: string | null;
    manifest_digest: string;
    binding: {
      initializeConnection: { id: string; revision: string };
      callConnection: { id: string; revision: string };
    };
    catalog_id: string;
    definition: unknown;
    catalog_definition: unknown;
    catalog_digest: string;
    action_definition: unknown;
    action_digest: string;
    schema_digest: string;
    output_schema_digest: string | null;
    state: string;
    i_state: string;
    i_revision: string;
    i_profile_id: string;
    i_profile_revision: string;
    i_profile_digest: string;
    i_purpose: string;
    c_state: string;
    c_revision: string;
    c_profile_id: string;
    c_profile_revision: string;
    c_profile_digest: string;
    c_purpose: string;
  }>(
    sql`SELECT clock_timestamp() AS now,${snapshot} AS live_authority,f.stopped,u.github_login,a.manifest_digest,a.binding,a.catalog_id,m.definition,v.definition AS catalog_definition,v.digest AS catalog_digest,k.definition AS action_definition,k.digest AS action_digest,k.schema_digest,k.output_schema_digest,a.state,i.state AS i_state,i.revision AS i_revision,i.profile_id AS i_profile_id,i.profile_revision AS i_profile_revision,i.profile_digest AS i_profile_digest,i.purpose AS i_purpose,c.state AS c_state,c.revision AS c_revision,c.profile_id AS c_profile_id,c.profile_revision AS c_profile_revision,c.profile_digest AS c_profile_digest,c.purpose AS c_purpose FROM mcp_runtime_adoption a JOIN funding_control f ON f.id='platform' JOIN "user" u ON u.id=a.user_id JOIN mcp_runtime_manifest m ON m.digest=a.manifest_digest JOIN mcp_connection i ON i.id=a.initialize_connection AND i.user_id=u.id JOIN mcp_connection c ON c.id=a.call_connection AND c.user_id=u.id JOIN mcp_catalog_head h ON h.connection_id=c.id AND h.catalog_id=a.catalog_id AND h.state='active' JOIN mcp_catalog_revision v ON v.id=h.catalog_id AND v.connection_id=c.id AND v.user_id=u.id JOIN mcp_catalog_action k ON k.catalog_id=v.id AND k.name=v.definition->'tools'->0->>'name' WHERE a.id=${id} AND a.user_id=${userId}`,
  );
  if (!r) fail("not_found", 404);
  if (r.stopped) fail("funded_inference_disabled", 503);
  const now = new Date(r.now),
    config = resolveRuntimeConfig(process.env, now),
    m = config.manifest;
  equal(r.definition, m);
  if (r.manifest_digest !== config.digest || r.state !== "configured") fail();
  if (
    !isInvitedLogin(
      r.github_login,
      parseInviteLogins(process.env.GITHUB_INVITE_LOGINS),
    )
  )
    fail("mcp_invite_required", 403);
  const current = parseProfilesJson(process.env.MCP_CLIENT_PROFILES_JSON);
  for (const kind of ["initialize", "call"] as const) {
    const p = m.profiles[kind],
      prefix = kind === "call" ? "c" : "i",
      connection =
        r.binding[kind === "call" ? "callConnection" : "initializeConnection"],
      live = current.get(profileKey(p.profileId, p.revision, p.purpose)),
      expected = appProfile(p, m.expiresAt);
    equal(live, expected);
    if (
      process.env.MCP_CLIENT_ENABLED !== "1" ||
      r[`${prefix}_state`] !== "configured" ||
      r[`${prefix}_revision`] !== connection.revision ||
      r[`${prefix}_purpose`] !== p.purpose ||
      r[`${prefix}_profile_id`] !== p.profileId ||
      r[`${prefix}_profile_revision`] !== p.revision ||
      r[`${prefix}_profile_digest`] !== computeProfileDigest(expected)
    )
      fail("mcp_connection_changed");
  }
  const expectedCatalog = parseCatalogImport({
    id: r.catalog_id,
    revision: m.revision,
    expectedHeadRevision: null,
    connection: r.binding.callConnection,
    profile: {
      id: m.profiles.call.profileId,
      revision: m.profiles.call.revision,
      purpose: "mcp.call",
      digest: computeProfileDigest(appProfile(m.profiles.call, m.expiresAt)),
    },
    tools: [
      {
        name: m.tool.name,
        description: m.tool.description,
        inputSchema: m.tool.inputSchema,
        outputSchema: m.tool.outputSchema,
        annotations: { readOnlyHint: true },
      },
    ],
  });
  const expectedAction = expectedCatalog.definition.tools[0];
  equal(r.catalog_definition, expectedCatalog.definition);
  equal(r.action_definition, expectedAction);
  if (
    r.catalog_digest !== expectedCatalog.digest ||
    r.action_digest !== operationDigest(expectedAction) ||
    r.schema_digest !== operationDigest(expectedAction.inputSchema) ||
    r.output_schema_digest !==
      (expectedAction.outputSchema
        ? operationDigest(expectedAction.outputSchema)
        : null)
  )
    fail();
  return { row: r, config, now };
}
async function runInTx(tx: Tx, userId: string, runId: string) {
  const [r] = await tx.execute<{
    request: unknown;
    created_at: Date;
    state: string;
    actor_key: string;
    digest: string;
  }>(
    sql`SELECT r.request,r.created_at,r.state,o.actor_key,o.digest FROM tool_run r JOIN byok_operation o ON o.id=r.id AND o.state='entered' AND o.kind='chat' AND o.resource_units=3 AND o.provider=r.request->>'funding' JOIN provider_credential c ON c.user_id=r.user_id AND c.provider=o.provider AND c.revision=o.credential_revision AND c.test_state<>'invalid' WHERE r.id=${runId} AND r.user_id=${userId} FOR UPDATE OF r,o,c`,
  );
  if (!r) fail("not_found", 404);
  return r;
}
function checkRun(
  r: Awaited<ReturnType<typeof runInTx>>,
  userId: string,
  now: Date,
) {
  const parsed = toolRunRequest.safeParse(r.request);
  if (!parsed.success) fail("mcp_tool_run_unavailable");
  const request = parsed.data,
    selected = resolveToolModel(process.env, request.model, request.funding);
  if (
    r.state !== "running" ||
    r.actor_key !== resourceActor(userId, process.env) ||
    r.digest !==
      resourceDigest(JSON.stringify({ request, selected }), process.env) ||
    new Date(r.created_at).getTime() + TOOL_LIMITS.timeoutMs <= now.getTime() ||
    new Date(selected.expiresAt) <= now
  )
    fail("mcp_tool_run_unavailable");
  return operationDigest({ request, model: selected });
}
/** Immutable frame validity is bounded from preparation, never renewed by approval or dispatch. */
function runtimeFrameDeadline(
  runCreatedAt: Date,
  preparedAt: Date,
  manifestExpiry: string,
  fee: { expiresAt: string; capacity: { wallMs: number } },
) {
  return new Date(
    Math.min(
      new Date(runCreatedAt).getTime() + TOOL_LIMITS.timeoutMs,
      new Date(preparedAt).getTime() + fee.capacity.wallMs,
      new Date(manifestExpiry).getTime(),
      new Date(fee.expiresAt).getTime(),
    ),
  );
}
/** The first runtime admission pins the retained principal secret; rotation never resets counters. */
async function runtimeCounterKeyInTx(tx: Tx) {
  const fingerprint = resourceDigest("mcp-runtime-counter-key-v1", process.env);
  const [registered] = await tx.execute<{ fingerprint: string }>(
    sql`SELECT fingerprint FROM mcp_runtime_counter_key WHERE id='counter'`,
  );
  if (registered && registered.fingerprint !== fingerprint)
    fail("mcp_actor_rotation_unknown", 503);
  await tx.execute(
    sql`INSERT INTO mcp_runtime_counter_key(id,fingerprint)VALUES('counter',${fingerprint})ON CONFLICT DO NOTHING`,
  );
}
/** The stable provider identity is read after the owner-lock wait; counters never use login/user ID. */
async function countAdmission(
  tx: Tx,
  userId: string,
  kind: "revision" | "proposal",
  amount = 1,
) {
  await tx.execute(sql`SELECT id FROM "user" WHERE id=${userId} FOR UPDATE`);
  const accounts = await tx.execute<{ account_id: string }>(
    sql`SELECT account_id FROM account WHERE user_id=${userId} AND provider_id='github' ORDER BY id LIMIT 2 FOR UPDATE`,
  );
  if (
    accounts.length !== 1 ||
    !/^[1-9][0-9]{0,19}$/.test(accounts[0].account_id)
  )
    fail("mcp_catalog_principal_unavailable", 403);
  await runtimeCounterKeyInTx(tx);
  const actor = resourceDigest(
    canonicalJson({
      domain: "mcp-catalog-admission-v1",
      providerId: "github",
      accountId: accounts[0].account_id,
    }),
    process.env,
  );
  const [r] = await tx.execute<{ owner: number; total: number }>(
    sql`SELECT count(*) FILTER(WHERE actor_key=${actor})::integer AS owner,count(*)::integer AS total FROM mcp_catalog_admission WHERE kind=${kind}`,
  );
  if (
    r.owner + amount > (kind === "revision" ? 20 : 100) ||
    r.total + amount > (kind === "revision" ? 200 : 1000)
  )
    fail("mcp_catalog_limit", 429);
  for (let i = 0; i < amount; i++)
    await tx.execute(
      sql`INSERT INTO mcp_catalog_admission(id,actor_key,kind) VALUES(${randomUUID()},${actor},${kind})`,
    );
}
export async function runtimeFrameInTx(tx: Tx, userId: string, id: string) {
  const [f] = await tx.execute<RuntimeFrame>(
    sql`SELECT * FROM mcp_runtime_frame WHERE id=${id} AND user_id=${userId}`,
  );
  if (!f) fail("not_found", 404);
  return f;
}
/** Concrete persisted authority; requires the caller's BYOK lock, with funding first when applicable. */
export async function verifyRuntimeActionInTx(
  tx: Tx,
  userId: string,
  approvalId: string,
  input: ActionBinding,
  phase = "approved",
) {
  const ref = parseExecution(runtimeActionSchema, input.runtime);
  const f = await runtimeFrameInTx(tx, userId, ref.frameId);
  equal(f.binding, input);
  if (f.digest !== ref.digest || f.approval_id !== approvalId) fail();
  const [e] = await tx.execute<{
    adoption_id: string;
    run_id: string;
    created_at: Date;
    definition: {
      requestDigest: string;
      arguments: Record<string, unknown>;
      toolCallId: string;
    };
  }>(
    sql`SELECT adoption_id,run_id,created_at,definition FROM mcp_runtime_execution WHERE id=${f.execution_id} AND user_id=${userId}`,
  );
  if (!e) fail("not_found", 404);
  // Lock mutable rows in run→approval/call order through transaction commit.
  // ToolStore.finish uses the same BYOK synchronization as every other writer.
  await runInTx(tx, userId, e.run_id);
  const [lockedApproval] = await tx.execute<{
    state: string;
    expires_at: Date;
    binding: unknown;
    call_state: string;
    call_name: string;
  }>(
    sql`SELECT a.state,a.expires_at,a.binding,k.state AS call_state,k.name AS call_name FROM tool_approval a JOIN tool_call k ON k.run_id=a.run_id AND k.id=${f.tool_call_id} WHERE a.id=${approvalId} AND a.user_id=${userId} AND a.run_id=${e.run_id} FOR UPDATE OF a,k`,
  );
  if (!lockedApproval) fail("not_found", 404);
  const c = await runtimeContextInTx(tx, userId, e.adoption_id, {
    runId: e.run_id,
    toolCallId: f.tool_call_id,
    approvalId,
  });
  const live = c.row.live_authority;
  if (!live) fail("not_found", 404);
  const run = {
      request: live.request,
      created_at: new Date(live.created_at),
      state: live.state,
      actor_key: live.actor_key,
      digest: live.digest,
    },
    a = {
      state: live.approval_state,
      expires_at: new Date(live.expires_at),
      binding: live.binding,
      call_state: live.call_state,
      call_name: live.call_name,
    };
  equal(a.binding, input);
  const requestDigest = checkRun(run, userId, c.now);
  if (
    requestDigest !== e.definition.requestDigest ||
    a.call_name !== input.tool ||
    !(
      phase === "consumed" && f.state === "completed"
        ? ["completed"]
        : ["queued", "running"]
    ).includes(a.call_state) ||
    new Date(a.expires_at) <= c.now ||
    new Date(f.intent.deadline) <= c.now ||
    new Date(a.expires_at).getTime() >
      new Date(run.created_at).getTime() + 20000
  )
    fail("mcp_tool_run_unavailable");
  const allowed = phase === "decision" ? ["pending", "approved"] : [phase];
  if (!allowed.includes(a.state)) fail("tool_approval_denied", 403);
  const fee = c.config.manifest.fees[f.kind];
  if (
    f.intent.feeDigest !== operationDigest(fee) ||
    input.costMicrodollars !== fee.upperBoundMicrodollars ||
    f.intent.requestDigest !== operationDigest(f.body) ||
    f.intent.requestBytes !== Buffer.byteLength(canonicalJson(f.body))
  )
    fail();
  const m = c.config.manifest,
    p = m.profiles[f.kind === "call" ? "call" : "initialize"],
    connection =
      c.row.binding[
        f.kind === "call" ? "callConnection" : "initializeConnection"
      ],
    args = parseMcpArguments(m.tool.inputSchema, e.definition.arguments),
    bodyId = f.body && typeof f.body === "object" && Reflect.get(f.body, "id"),
    bodies = runtimeFrames(m.tool.name, args, {
      initialize: typeof bodyId === "string" ? bodyId : "",
      call: typeof bodyId === "string" ? bodyId : "",
    });
  if (
    f.kind !== "initialized" &&
    (typeof bodyId !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
        bodyId,
      ))
  )
    fail();
  equal(f.body, bodies[f.kind]);
  if (f.kind === "call" && f.tool_call_id !== e.definition.toolCallId) fail();
  const digest = operationDigest({
    kind: f.kind,
    body: f.body,
    operationId: f.operation_id,
    manifestDigest: c.config.digest,
    profileDigest: operationDigest(p),
    feeDigest: operationDigest(fee),
    plan: f.intent.plan,
    runId: e.run_id,
    toolCallId: f.tool_call_id,
    adoptionId: e.adoption_id,
    requestDigest,
  });
  if (f.digest !== digest) fail();
  equal(input, {
    runId: e.run_id,
    toolCallId: f.tool_call_id,
    tool: f.kind === "call" ? `mcp:${m.tool.name}` : `mcp:${f.kind}`,
    toolRevision: digest,
    connectionRevision: connection.revision,
    arguments: f.kind === "call" ? args : {},
    target: m.id,
    costMicrodollars: fee.upperBoundMicrodollars,
    runtime: { frameId: f.id, digest },
  });
  equal(
    f.intent,
    parseOperationIntent({
      id: f.operation_id,
      idempotencyKey: f.id,
      connection,
      profile: {
        id: p.profileId,
        revision: p.revision,
        purpose: p.purpose,
        digest: computeProfileDigest(appProfile(p, m.expiresAt)),
      },
      catalog: {
        id: c.row.catalog_id,
        revision: m.revision,
        digest: c.row.catalog_digest,
      },
      action: {
        id: f.kind === "call" ? m.tool.name : f.kind,
        revision: m.revision,
        digest,
      },
      approval: {
        id: approvalId,
        revision: "1",
        digest: operationDigest({
          id: approvalId,
          binding: input,
          expiresAt: new Date(a.expires_at).toISOString(),
        }),
      },
      requestDigest: operationDigest(f.body),
      requestBytes: Buffer.byteLength(canonicalJson(f.body)),
      plan: f.intent.plan,
      feeDigest: operationDigest(fee),
      authority: { id: f.id, revision: "1", digest },
      deadline: runtimeFrameDeadline(
        run.created_at,
        e.created_at,
        m.expiresAt,
        fee,
      ).toISOString(),
      maxAttempts: 1,
    }),
  );
  const plan = resolvePlatformBudgetConfig(process.env, c.now);
  if (!plan || process.env.FUNDED_KILL_SWITCH !== "0")
    fail("mcp_action_unavailable", 503);
  equal(f.intent.plan, {
    month: plan.plan.month,
    revision: plan.plan.revision,
    digest: plan.digest,
    capacityDigest: plan.capacityDigest,
  });
  if (fee.capacity.sharedCapacityDigest !== plan.capacityDigest)
    fail("mcp_capacity_changed");
  return { frame: f, context: c, fee };
}
export async function verifyRuntimeOperationInTx(
  tx: Tx,
  userId: string,
  intent: OperationIntent,
  entered: boolean,
) {
  const f = await runtimeFrameInTx(tx, userId, intent.authority.id);
  equal(f.intent, intent);
  if (f.state !== (entered ? "entered" : "prepared"))
    fail("mcp_operation_already_entered");
  return verifyRuntimeActionInTx(
    tx,
    userId,
    f.approval_id,
    f.binding,
    entered ? "consumed" : "approved",
  );
}
export function createMcpExecutionStore(options: { db?: Database } = {}) {
  const db = options.db ?? requireDb();
  const transaction = <T>(run: (tx: Tx) => Promise<T>) =>
    db
      .transaction(
        async (tx) => {
          await lockByokResources(tx);
          return run(tx);
        },
        { isolationLevel: "read committed" },
      )
      .catch(executionStorageError);
  return {
    async adoptRuntimeManifest(userId: string, raw: unknown) {
      const input = parseExecution(adoptionInput, raw);
      return transaction(async (tx) => {
        const [clock] = await tx.execute<{ now: Date }>(
          sql`SELECT clock_timestamp() AS now`,
        );
        const config = resolveRuntimeConfig(process.env, new Date(clock.now)),
          m = config.manifest;
        if (input.manifestDigest !== config.digest) fail();
        for (const [kind, connection] of [
          ["initialize", input.initializeConnection],
          ["call", input.callConnection],
        ] as const) {
          const [r] = await tx.execute<{
            revision: string;
            purpose: string;
            profile_digest: string;
            state: string;
            profile_id: string;
            profile_revision: string;
          }>(
            sql`SELECT revision,purpose,profile_digest,state,profile_id,profile_revision FROM mcp_connection WHERE id=${connection.id} AND user_id=${userId}`,
          );
          if (!r) fail("not_found", 404);
          const p = m.profiles[kind];
          if (
            r.state !== "configured" ||
            r.revision !== connection.revision ||
            r.purpose !== p.purpose ||
            r.profile_id !== p.profileId ||
            r.profile_revision !== p.revision ||
            r.profile_digest !==
              computeProfileDigest(appProfile(p, m.expiresAt))
          )
            fail();
        }
        const call = m.profiles.call,
          profile = {
            id: call.profileId,
            revision: call.revision,
            purpose: "mcp.call" as const,
            digest: computeProfileDigest(appProfile(call, m.expiresAt)),
          };
        const [head] = await tx.execute<{ revision: string; state: string }>(
          sql`SELECT revision,state FROM mcp_catalog_head WHERE connection_id=${input.callConnection.id}`,
        );
        if (head?.state === "revoked") fail();
        const catalog = parseCatalogImport({
          id: input.id,
          revision: m.revision,
          expectedHeadRevision: head?.revision ?? null,
          connection: input.callConnection,
          profile,
          tools: [
            {
              name: m.tool.name,
              description: m.tool.description,
              inputSchema: m.tool.inputSchema,
              outputSchema: m.tool.outputSchema,
              annotations: { readOnlyHint: true },
            },
          ],
        });
        await countAdmission(tx, userId, "revision");
        await tx.execute(
          sql`INSERT INTO mcp_runtime_manifest(digest,definition) VALUES(${config.digest},${canonicalJson(m)}::jsonb) ON CONFLICT DO NOTHING`,
        );
        await tx.execute(
          sql`INSERT INTO mcp_catalog_revision(id,user_id,connection_id,revision,connection_revision,profile,digest,definition) VALUES(${input.id},${userId},${input.callConnection.id},${m.revision},${input.callConnection.revision},${canonicalJson(profile)}::jsonb,${catalog.digest},${canonicalJson(catalog.definition)}::jsonb)`,
        );
        const action = catalog.definition.tools[0];
        await tx.execute(
          sql`INSERT INTO mcp_catalog_action(catalog_id,name,digest,schema_digest,output_schema_digest,definition) VALUES(${input.id},${action.name},${operationDigest(action)},${operationDigest(action.inputSchema)},${action.outputSchema ? operationDigest(action.outputSchema) : null},${canonicalJson(action)}::jsonb)`,
        );
        await tx.execute(
          sql`INSERT INTO mcp_catalog_head(connection_id,user_id,catalog_id,revision,state) VALUES(${input.callConnection.id},${userId},${input.id},${randomUUID()},'active') ON CONFLICT(connection_id) DO UPDATE SET catalog_id=excluded.catalog_id,revision=excluded.revision`,
        );
        await tx.execute(
          sql`UPDATE tool_approval SET state='revoked' WHERE state IN('pending','approved') AND id IN(SELECT p.approval_id FROM mcp_action_proposal p JOIN mcp_catalog_revision v ON v.id=p.catalog_id WHERE v.connection_id=${input.callConnection.id})`,
        );
        await tx.execute(
          sql`INSERT INTO mcp_runtime_adoption(id,user_id,manifest_digest,initialize_connection,call_connection,catalog_id,binding) VALUES(${input.id},${userId},${config.digest},${input.initializeConnection.id},${input.callConnection.id},${input.id},${canonicalJson(input)}::jsonb)`,
        );
        const final = await runtimeContextInTx(tx, userId, input.id);
        if (final.config.digest !== config.digest) fail();
        return { id: input.id, manifestDigest: config.digest, revision: 1 };
      });
    },
    async prepareRuntimeExecution(userId: string, raw: unknown) {
      const parsed = parseExecution(executionInput, raw),
        input = deepFreeze({
          ...parsed,
          arguments: ownMcpArguments(parsed.arguments),
        });
      return transaction(async (tx) => {
        const c = await runtimeContextInTx(tx, userId, input.adoptionId),
          m = c.config.manifest,
          run = await runInTx(tx, userId, input.runId),
          requestDigest = checkRun(run, userId, c.now),
          args = parseMcpArguments(m.tool.inputSchema, input.arguments);
        const [call] = await tx.execute<{ state: string; name: string }>(
          sql`SELECT state,name FROM tool_call WHERE run_id=${input.runId} AND id=${input.toolCallId}`,
        );
        if (!call) fail("not_found", 404);
        if (call.state !== "queued" || call.name !== `mcp:${m.tool.name}`)
          fail();
        const [counts] = await tx.execute<{ count: number }>(
          sql`SELECT count(*)::integer AS count FROM tool_call WHERE run_id=${input.runId}`,
        );
        if (counts.count + 2 > TOOL_LIMITS.calls) fail("tool_call_limit");
        const plan = resolvePlatformBudgetConfig(process.env, c.now);
        if (!plan) fail("platform_budget_disabled", 503);
        const planIdentity = {
          month: plan.plan.month,
          revision: plan.plan.revision,
          digest: plan.digest,
          capacityDigest: plan.capacityDigest,
        };
        await countAdmission(tx, userId, "proposal", 3);
        const [execution] = await tx.execute<{ created_at: Date }>(
          sql`INSERT INTO mcp_runtime_execution(id,user_id,run_id,adoption_id,definition) VALUES(${input.id},${userId},${input.runId},${input.adoptionId},${canonicalJson({ ...input, arguments: args, requestDigest })}::jsonb) RETURNING created_at`,
        );
        const bodies = runtimeFrames(m.tool.name, args, {
            initialize: randomUUID(),
            call: randomUUID(),
          }),
          result = [];
        const [catalog] = await tx.execute<{ digest: string }>(
          sql`SELECT digest FROM mcp_catalog_revision WHERE id=${c.row.catalog_id}`,
        );
        for (const [ordinal, kind] of FRAME_KINDS.entries()) {
          const id = randomUUID(),
            operationId = randomUUID(),
            toolCallId = kind === "call" ? input.toolCallId : randomUUID(),
            tool = kind === "call" ? `mcp:${m.tool.name}` : `mcp:${kind}`,
            p = m.profiles[kind === "call" ? "call" : "initialize"],
            connection =
              c.row.binding[
                kind === "call" ? "callConnection" : "initializeConnection"
              ],
            fee = m.fees[kind],
            body = bodies[kind];
          if (kind !== "call")
            await tx.execute(
              sql`INSERT INTO tool_call(run_id,id,name,state) VALUES(${input.runId},${toolCallId},${tool},'queued')`,
            );
          const definition = {
            kind,
            body,
            operationId,
            manifestDigest: c.config.digest,
            profileDigest: operationDigest(p),
            feeDigest: operationDigest(fee),
            plan: planIdentity,
            runId: input.runId,
            toolCallId,
            adoptionId: input.adoptionId,
            requestDigest,
          };
          const digest = operationDigest(definition);
          const binding: ActionBinding = {
            runId: input.runId,
            toolCallId,
            tool,
            toolRevision: digest,
            connectionRevision: connection.revision,
            arguments: kind === "call" ? args : {},
            target: m.id,
            costMicrodollars: fee.upperBoundMicrodollars,
            runtime: { frameId: id, digest },
          };
          const deadline = runtimeFrameDeadline(
            run.created_at,
            execution.created_at,
            m.expiresAt,
            fee,
          );
          const approvalId = await issueToolApprovalInTx(
            tx,
            userId,
            binding,
            deadline,
          );
          const [approval] = await tx.execute<{ expires_at: Date }>(
            sql`SELECT expires_at FROM tool_approval WHERE id=${approvalId}`,
          );
          const intent = parseOperationIntent({
            id: operationId,
            idempotencyKey: id,
            connection,
            profile: {
              id: p.profileId,
              revision: p.revision,
              purpose: p.purpose,
              digest: computeProfileDigest(appProfile(p, m.expiresAt)),
            },
            catalog: {
              id: c.row.catalog_id,
              revision: m.revision,
              digest: catalog.digest,
            },
            action: {
              id: kind === "call" ? m.tool.name : kind,
              revision: m.revision,
              digest,
            },
            approval: {
              id: approvalId,
              revision: "1",
              digest: operationDigest({
                id: approvalId,
                binding,
                expiresAt: new Date(approval.expires_at).toISOString(),
              }),
            },
            requestDigest: operationDigest(body),
            requestBytes: Buffer.byteLength(canonicalJson(body)),
            plan: planIdentity,
            feeDigest: operationDigest(fee),
            authority: { id, revision: "1", digest },
            deadline: deadline.toISOString(),
            maxAttempts: 1,
          });
          canonical(binding);
          await tx.execute(
            sql`INSERT INTO mcp_runtime_frame(id,execution_id,user_id,ordinal,kind,operation_id,approval_id,tool_call_id,body,binding,intent,digest) VALUES(${id},${input.id},${userId},${ordinal},${kind},${operationId},${approvalId},${toolCallId},${canonicalJson(body)}::jsonb,${canonicalJson(binding)}::jsonb,${canonicalJson(intent)}::jsonb,${digest})`,
          );
          result.push({
            id,
            kind,
            approvalId,
            body,
            expiresAt: deadline.toISOString(),
          });
        }
        for (const f of result) {
          const row = await runtimeFrameInTx(tx, userId, f.id);
          await verifyRuntimeActionInTx(
            tx,
            userId,
            row.approval_id,
            row.binding,
            "pending",
          );
        }
        return { id: input.id, frames: result };
      });
    },
    async decideRuntimeApproval(
      userId: string,
      approvalId: string,
      decision: "approve" | "deny" | "revoke",
    ) {
      if (!["approve", "deny", "revoke"].includes(decision))
        fail("invalid_mcp_execution", 400);
      return transaction(async (tx) => {
        const [f] = await tx.execute<{ id: string }>(
          sql`SELECT id FROM mcp_runtime_frame WHERE approval_id=${approvalId} AND user_id=${userId}`,
        );
        if (!f) fail("not_found", 404);
        await decideToolApprovalInTx(tx, userId, approvalId, decision);
      });
    },
    async exportMetadata(userId: string) {
      return transaction(async (tx) => {
        const adoptions = await tx.execute<{
          id: string;
          catalog_id: string;
          manifest_digest: string;
          state: string;
          revision: number;
        }>(
          sql`SELECT id,catalog_id,manifest_digest,state,revision FROM mcp_runtime_adoption WHERE user_id=${userId} ORDER BY created_at,id LIMIT 20`,
        );
        const frames = await tx.execute<{
          id: string;
          execution_id: string;
          operation_id: string;
          kind: FrameKind;
          state: string;
          revision: number;
        }>(
          sql`SELECT id,execution_id,operation_id,kind,state,revision FROM mcp_runtime_frame WHERE user_id=${userId} ORDER BY created_at,id LIMIT 100`,
        );
        return { adoptions: [...adoptions], frames: [...frames] };
      });
    },
    async status(userId: string, id: string) {
      return transaction(async (tx) => {
        const rows = await tx.execute<{
          id: string;
          kind: FrameKind;
          state: string;
          revision: number;
          operation_id: string;
        }>(
          sql`SELECT id,kind,state,revision,operation_id FROM mcp_runtime_frame WHERE execution_id=${id} AND user_id=${userId} ORDER BY ordinal`,
        );
        if (!rows.length) fail("not_found", 404);
        return [...rows];
      });
    },
    async revokeAdoption(userId: string, id: string, expectedRevision: number) {
      return transaction(async (tx) => {
        const rows = await tx.execute(
          sql`UPDATE mcp_runtime_adoption SET state='revoked',revision=revision+1 WHERE id=${id} AND user_id=${userId} AND state='configured' AND revision=${expectedRevision} RETURNING id`,
        );
        if (!rows.length) fail("not_found", 404);
        await tx.execute(
          sql`UPDATE tool_approval SET state='revoked' WHERE state IN('pending','approved') AND id IN(SELECT f.approval_id FROM mcp_runtime_frame f JOIN mcp_runtime_execution e ON e.id=f.execution_id WHERE e.adoption_id=${id} AND e.user_id=${userId})`,
        );
      });
    },
  };
}

/** Financial runtime identity is stable across auth-row deletion and configured actor-key rotation. */
export async function runtimeActorInTx(
  tx: Tx,
  userId: string,
  runtime: { actorKeys: Record<string, string>; activeKeyVersion: string },
) {
  await tx.execute(sql`SELECT id FROM "user" WHERE id=${userId} FOR UPDATE`);
  const accounts = await tx.execute<{ account_id: string }>(
    sql`SELECT account_id FROM account WHERE user_id=${userId} AND provider_id='github' ORDER BY id LIMIT 2 FOR UPDATE`,
  );
  if (
    accounts.length !== 1 ||
    !/^[1-9][0-9]{0,19}$/.test(accounts[0].account_id)
  )
    fail("mcp_catalog_principal_unavailable", 403);
  const principal = resourceDigest(
    canonicalJson({
      domain: "mcp-runtime-financial-principal-v1",
      providerId: "github",
      accountId: accounts[0].account_id,
    }),
    process.env,
  );
  await runtimeCounterKeyInTx(tx);
  const [prior] = await tx.execute<{
    actor_key: string;
    actor_version: string;
  }>(
    sql`SELECT actor_key,actor_version FROM mcp_runtime_principal WHERE principal_digest=${principal}`,
  );
  const version = prior?.actor_version ?? runtime.activeKeyVersion,
    key = runtime.actorKeys[version];
  if (!key) fail("mcp_actor_rotation_unknown", 503);
  const actor = createHmac("sha256", key)
    .update(`galaxy-mcp-runtime-github-owner-v1:${accounts[0].account_id}`)
    .digest("hex");
  if (prior && prior.actor_key !== actor)
    fail("mcp_actor_rotation_unknown", 503);
  await tx.execute(
    sql`INSERT INTO mcp_runtime_principal(principal_digest,actor_key,actor_version)VALUES(${principal},${actor},${version})ON CONFLICT DO NOTHING`,
  );
  return { key: actor, version };
}
