import "server-only";
import { createHmac, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { z } from "zod";
import {
  type EnvSource,
  isInvitedLogin,
  parseInviteLogins,
} from "@/lib/auth/env";
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
import { assertActivePlanInTx, lockFunding } from "@/lib/funding/store";
import { parseProfilesJson, profileKey } from "./config";
import { type McpFeeSnapshot, parseMcpFeeSnapshot } from "./fee-config";
import {
  identifierSchema,
  type OperationIntent,
  type OperationView,
  operationDigest,
  type PlanIdentity,
  parseOperationIntent,
  parseOperationReceipt,
  planIdentitySchema,
} from "./operation-contract";
import {
  computeProfileDigest,
  MCP_REGISTRY_PURPOSES,
} from "./registry-contract";

type Tx = DatabaseTransaction;
const runtimeSchema = z
  .object({
    fee: z.unknown(),
    activeKeyVersion: identifierSchema,
    actorKeys: z
      .record(identifierSchema, z.string().min(32).max(256))
      .refine((v) => Object.keys(v).length > 0 && Object.keys(v).length <= 8),
  })
  .strict();
export type McpOperationRuntime = z.infer<typeof runtimeSchema>;
type Runtime = Omit<McpOperationRuntime, "fee"> & {
  fee: Readonly<McpFeeSnapshot>;
};
type Options = {
  db?: Database;
  runtime?: () => unknown;
  env?: () => EnvSource;
};
type Row = {
  id: string;
  actor_key: string;
  actor_version: string;
  idempotency_key: string;
  binding_digest: string;
  identity: Omit<OperationIntent, "connection"> & { connectionDigest: string };
  fee_snapshot: McpFeeSnapshot;
  month: string;
  day: string;
  state: OperationView["state"];
  revision: number;
  reserved_microdollars: string;
  incurred_microdollars: string;
  attempts: number;
  deadline: Date;
  created_at: Date;
  receipt_id: string | null;
  receipt: unknown;
};
export type McpSourceCommitment = Readonly<{
  sourceId: string;
  amountMicrodollars: number;
}>;
function unavailable(): never {
  throw new AppError("mcp_operation_authority_unavailable", 503);
}
function fixtureGate() {
  if (process.env.NODE_ENV !== "test") unavailable();
}
function runtimeSnapshot(raw: unknown, now: Date): Runtime {
  const parsed = runtimeSchema.safeParse(raw);
  if (!parsed.success) throw new AppError("mcp_operation_unconfigured", 503);
  const value = parsed.data;
  if (!value.actorKeys[value.activeKeyVersion])
    throw new AppError("mcp_actor_rotation_unknown", 503);
  return deepFreeze({ ...value, fee: parseMcpFeeSnapshot(value.fee, now) });
}
function fingerprint(key: string) {
  return createHmac("sha256", key)
    .update("galaxy-mcp-key-version-v1")
    .digest("hex");
}
function actorKey(userId: string, key: string) {
  return createHmac("sha256", key)
    .update(`galaxy-mcp-owner-v1:${userId}`)
    .digest("hex");
}
function view(row: Row): OperationView {
  return Object.freeze({
    id: row.id,
    state: row.state,
    revision: row.revision,
    reservedMicrodollars: Number(row.reserved_microdollars),
    incurredMicrodollars: Number(row.incurred_microdollars),
    attempts: row.attempts,
    createdAt: new Date(row.created_at).toISOString(),
  });
}
function identity(intent: OperationIntent) {
  const { connection, ...rest } = intent;
  return { ...rest, connectionDigest: operationDigest(connection) };
}
function ensureEqual(
  a: unknown,
  b: unknown,
  id = "mcp_operation_identity_changed",
) {
  if (canonicalJson(a) !== canonicalJson(b)) throw new AppError(id, 409);
}
async function audit(tx: Tx, row: Row) {
  await tx.execute(
    sql`INSERT INTO mcp_operation_audit(id,operation_id,event,revision) VALUES (${randomUUID()},${row.id},${row.state},${row.revision})`,
  );
}

class McpOperationStore {
  readonly #fixture: boolean;
  constructor(
    private readonly db: Database,
    private readonly runtime: () => unknown,
    private readonly env: () => EnvSource,
    fixture: boolean,
  ) {
    this.#fixture = fixture;
  }
  private requireAuthority() {
    if (!this.#fixture) unavailable();
    fixtureGate();
  }
  private transaction<T>(run: (tx: Tx) => Promise<T>) {
    return this.db.transaction(
      async (tx) => {
        await lockFunding(tx);
        await lockByokResources(tx);
        return run(tx);
      },
      { isolationLevel: "read committed" },
    );
  }
  private async owned(tx: Tx, userId: string, id: string): Promise<Row> {
    const [row] = await tx.execute<Row>(
      sql`SELECT o.* FROM mcp_operation o JOIN mcp_operation_owner m ON m.operation_id=o.id WHERE m.user_id=${userId} AND o.id=${id}`,
    );
    if (!row) throw new AppError("not_found", 404);
    return row;
  }
  private cas(row: Row, revision: number) {
    if (!Number.isSafeInteger(revision) || row.revision !== revision)
      throw new AppError("mcp_operation_conflict", 409);
  }
  private async clock(tx: Tx) {
    const [row] = await tx.execute<{ now: Date }>(
      sql`SELECT clock_timestamp() AS now`,
    );
    return new Date(row.now);
  }
  private async actor(tx: Tx, userId: string, runtime: Runtime) {
    const versions = await tx.execute<{ version: string; fingerprint: string }>(
      sql`SELECT * FROM mcp_actor_key_version`,
    );
    for (const version of versions) {
      const key = runtime.actorKeys[version.version];
      if (!key || fingerprint(key) !== version.fingerprint)
        throw new AppError("mcp_actor_rotation_unknown", 503);
    }
    const current = runtime.actorKeys[runtime.activeKeyVersion];
    await tx.execute(
      sql`INSERT INTO mcp_actor_key_version(version,fingerprint) VALUES (${runtime.activeKeyVersion},${fingerprint(current)}) ON CONFLICT DO NOTHING`,
    );
    const [existing] = await tx.execute<{
      actor_key: string;
      key_version: string;
    }>(sql`SELECT * FROM mcp_actor_alias WHERE user_id=${userId}`);
    if (existing) {
      const key = runtime.actorKeys[existing.key_version];
      if (!key || actorKey(userId, key) !== existing.actor_key)
        throw new AppError("mcp_actor_rotation_unknown", 503);
      return { key: existing.actor_key, version: existing.key_version };
    }
    const key = actorKey(userId, current);
    await tx.execute(
      sql`INSERT INTO mcp_actor_alias(user_id,actor_key,key_version) VALUES (${userId},${key},${runtime.activeKeyVersion})`,
    );
    return { key, version: runtime.activeKeyVersion };
  }
  /** LAST awaited statement observes current owner, binding, persisted authority, control and DB time. */
  private async finalCheck(
    tx: Tx,
    userId: string,
    intent: OperationIntent,
    expected: Runtime,
    entered: boolean,
  ) {
    this.requireAuthority();
    const [row] = await tx.execute<{
      now: Date;
      stopped: boolean;
      github_login: string | null;
      state: string;
      revision: string;
      profile_id: string;
      profile_revision: string;
      purpose: string;
      profile_digest: string;
      intent_digest: string;
      fee_digest: string;
      authority: unknown;
      expires_at: Date;
      consumed_by: string | null;
    }>(sql`SELECT clock_timestamp() AS now,f.stopped,u.github_login,c.state,c.revision,c.profile_id,c.profile_revision,c.purpose,c.profile_digest,a.intent_digest,a.fee_digest,a.authority,a.expires_at,a.consumed_by
   FROM funding_control f JOIN "user" u ON u.id=${userId}
   JOIN mcp_connection c ON c.user_id=u.id AND c.id=${intent.connection.id}
   JOIN mcp_fixture_authority a ON a.user_id=u.id AND a.connection_id=c.id AND a.id=${intent.authority.id}
   WHERE f.id='platform'`);
    if (!row) throw new AppError("mcp_authority_missing", 403);
    this.requireAuthority();
    const now = new Date(row.now),
      env = this.env(),
      runtime = runtimeSnapshot(this.runtime(), now);
    ensureEqual(expected, runtime);
    if (row.stopped || env.FUNDED_KILL_SWITCH !== "0")
      throw new AppError("funded_inference_disabled", 503);
    if (
      !isInvitedLogin(
        row.github_login,
        parseInviteLogins(env.GITHUB_INVITE_LOGINS),
      )
    )
      throw new AppError("mcp_invite_required", 403);
    if (
      row.state !== "configured" ||
      row.revision !== intent.connection.revision ||
      row.profile_id !== intent.profile.id ||
      row.profile_revision !== intent.profile.revision ||
      row.purpose !== intent.profile.purpose ||
      row.profile_digest !== intent.profile.digest
    )
      throw new AppError("mcp_connection_changed", 409);
    // OAuth purposes have no canonical owned binding contract and are always denied.
    if (
      !MCP_REGISTRY_PURPOSES.some(
        (purpose) => purpose === intent.profile.purpose,
      )
    )
      throw new AppError("mcp_purpose_unavailable", 503);
    const profile = parseProfilesJson(env.MCP_CLIENT_PROFILES_JSON).get(
      profileKey(
        intent.profile.id,
        intent.profile.revision,
        intent.profile.purpose,
      ),
    );
    if (
      env.MCP_CLIENT_ENABLED !== "1" ||
      !profile ||
      computeProfileDigest(profile) !== intent.profile.digest ||
      new Date(profile.expiresAt) <= now
    )
      throw new AppError("mcp_profile_changed", 409);
    const config = resolvePlatformBudgetConfig(env, now);
    if (!config) throw new AppError("platform_budget_disabled", 503);
    ensureEqual(intent.plan, {
      month: config.plan.month,
      revision: config.plan.revision,
      digest: config.digest,
      capacityDigest: config.capacityDigest,
    });
    if (
      runtime.fee.capacity.sharedCapacityDigest !==
        intent.plan.capacityDigest ||
      operationDigest(runtime.fee) !== intent.feeDigest
    )
      throw new AppError("mcp_fee_changed", 409);
    if (intent.profile.purpose === "mcp.call" && !intent.approval)
      throw new AppError("mcp_approval_required", 403);
    const cap = runtime.fee.capacity;
    if (
      cap.requestBytes > profile.maxRequestBytes ||
      cap.responseBytes > profile.maxResponseBytes ||
      cap.wallMs > profile.timeoutMs ||
      intent.requestBytes > cap.requestBytes
    )
      throw new AppError("mcp_capacity_changed", 409);
    if (
      intent.plan.month !== now.toISOString().slice(0, 7) ||
      new Date(intent.deadline) <= now
    )
      throw new AppError("mcp_operation_expired", 409);
    if (
      new Date(row.expires_at) <= now ||
      row.intent_digest !== operationDigest(intent) ||
      row.fee_digest !== intent.feeDigest
    )
      throw new AppError("mcp_authority_changed", 409);
    ensureEqual(row.authority, {
      authority: intent.authority,
      catalog: intent.catalog,
      action: intent.action,
      approval: intent.approval,
    });
    if (row.consumed_by !== (entered ? intent.id : null))
      throw new AppError("mcp_approval_consumed", 409);
    return { now, runtime };
  }
  private async sources(tx: Tx, month: string): Promise<McpSourceCommitment[]> {
    const rows = await tx.execute<{ source_id: string; amount: string }>(sql`
   SELECT o.id AS source_id,greatest(
    CASE WHEN o.state='released' THEN 0 WHEN o.state='settled' THEN o.incurred_microdollars ELSE greatest(o.reserved_microdollars,o.incurred_microdollars) END,
    coalesce(c.amount,0))::text AS amount
   FROM mcp_operation o LEFT JOIN (SELECT source_id,max(amount_microdollars) AS amount FROM mcp_operation_commitment WHERE month<${month} GROUP BY source_id)c ON c.source_id=o.id
   WHERE o.month<${month} ORDER BY o.id`);
    return rows
      .map((row) => ({
        sourceId: row.source_id,
        amountMicrodollars: Number(row.amount),
      }))
      .filter((row) => row.amountMicrodollars > 0);
  }
  private async period(tx: Tx, plan: PlanIdentity) {
    const [period] = await tx.execute<{ plan_identity: unknown }>(
      sql`SELECT plan_identity FROM mcp_operation_period WHERE month=${plan.month}`,
    );
    if (!period) throw new AppError("mcp_period_unavailable", 503);
    ensureEqual(period.plan_identity, plan, "mcp_period_conflict");
    const sources = await this.sources(tx, plan.month);
    for (const source of sources) {
      const [commitment] = await tx.execute<{ amount: string }>(
        sql`SELECT amount_microdollars::text AS amount FROM mcp_operation_commitment WHERE month=${plan.month} AND source_id=${source.sourceId}`,
      );
      if (!commitment || Number(commitment.amount) < source.amountMicrodollars)
        throw new AppError("mcp_carry_insufficient", 503);
    }
  }
  private async exposure(tx: Tx, month: string) {
    const [row] = await tx.execute<{
      amount: string;
    }>(sql`SELECT coalesce(sum(greatest(
   CASE WHEN o.state='released' THEN 0 WHEN o.state='settled' THEN o.incurred_microdollars ELSE greatest(o.reserved_microdollars,o.incurred_microdollars) END,
   coalesce(c.amount,0))),0)::text AS amount FROM mcp_operation o LEFT JOIN (SELECT source_id,max(amount_microdollars) AS amount FROM mcp_operation_commitment WHERE month<=${month} GROUP BY source_id)c ON c.source_id=o.id WHERE o.month<=${month}`);
    const amount = Number(row.amount);
    if (!Number.isSafeInteger(amount))
      throw new AppError("mcp_exposure_overflow", 503);
    return amount;
  }
  async reserve(userId: string, raw: unknown): Promise<OperationView> {
    this.requireAuthority();
    const intent = parseOperationIntent(raw);
    return this.transaction(async (tx) => {
      const [replay] = await tx.execute<Row>(
        sql`SELECT o.* FROM mcp_operation o JOIN mcp_operation_owner m ON m.operation_id=o.id WHERE m.user_id=${userId} AND o.idempotency_key=${intent.idempotencyKey}`,
      );
      if (replay) {
        ensureEqual(
          replay.binding_digest,
          operationDigest(intent),
          "idempotency_conflict",
        );
        this.requireAuthority();
        return view(replay);
      }
      const [usedId] = await tx.execute<{ id: string }>(
        sql`SELECT id FROM mcp_operation WHERE id=${intent.id}`,
      );
      if (usedId) throw new AppError("not_found", 404);
      const now = await this.clock(tx),
        runtime = runtimeSnapshot(this.runtime(), now);
      await this.finalCheck(tx, userId, intent, runtime, false);
      const actor = await this.actor(tx, userId, runtime);
      const [existing] = await tx.execute<Row>(
        sql`SELECT * FROM mcp_operation WHERE actor_key=${actor.key} AND idempotency_key=${intent.idempotencyKey}`,
      );
      if (existing) {
        ensureEqual(
          existing.binding_digest,
          operationDigest(intent),
          "idempotency_conflict",
        );
        const owned = await this.owned(tx, userId, existing.id);
        return view(owned);
      }
      const plan = await assertActivePlanInTx(tx, intent.plan, this.env);
      await this.period(tx, intent.plan);
      if (
        (await this.exposure(tx, intent.plan.month)) +
          runtime.fee.upperBoundMicrodollars >
        plan.a_mcp
      )
        throw new AppError("mcp_allocation_exhausted", 429);
      const [counts] = await tx.execute<{
        owner_active: number;
        global_active: number;
        owner_day: number;
        global_day: number;
        owner_records: number;
        global_records: number;
      }>(sql`SELECT
    count(*) FILTER(WHERE actor_key=${actor.key} AND state IN ('reserved','entered','held'))::integer AS owner_active,
    count(*) FILTER(WHERE state IN ('reserved','entered','held'))::integer AS global_active,
    count(*) FILTER(WHERE actor_key=${actor.key} AND day=${now.toISOString().slice(0, 10)})::integer AS owner_day,
    count(*) FILTER(WHERE day=${now.toISOString().slice(0, 10)})::integer AS global_day,
    count(*) FILTER(WHERE actor_key=${actor.key})::integer AS owner_records,count(*)::integer AS global_records FROM mcp_operation`);
      const c = runtime.fee.capacity;
      if (
        counts.owner_active >= c.ownerActive ||
        counts.global_active >= c.globalActive ||
        counts.owner_day >= c.ownerDailyRequests ||
        counts.global_day >= c.globalDailyRequests ||
        counts.owner_records >= c.ownerRecords ||
        counts.global_records >= c.globalRecords
      )
        throw new AppError("mcp_operation_limit", 429);
      const latest = await this.finalCheck(tx, userId, intent, runtime, false);
      if (
        latest.now.toISOString().slice(0, 10) !==
          now.toISOString().slice(0, 10) ||
        new Date(intent.deadline).getTime() - latest.now.getTime() > c.wallMs
      )
        throw new AppError("mcp_operation_expired", 409);
      const [row] = await tx.execute<Row>(
        sql`INSERT INTO mcp_operation(id,actor_key,actor_version,idempotency_key,binding_digest,identity,fee_snapshot,month,day,state,reserved_microdollars,deadline) VALUES (${intent.id},${actor.key},${actor.version},${intent.idempotencyKey},${operationDigest(intent)},${JSON.stringify(identity(intent))}::jsonb,${JSON.stringify(runtime.fee)}::jsonb,${intent.plan.month},${now.toISOString().slice(0, 10)},'reserved',${runtime.fee.upperBoundMicrodollars},${intent.deadline}) RETURNING *`,
      );
      await tx.execute(
        sql`INSERT INTO mcp_operation_owner(operation_id,user_id,connection_id) VALUES (${row.id},${userId},${intent.connection.id})`,
      );
      await tx.execute(
        sql`INSERT INTO mcp_operation_commitment(month,source_id,amount_microdollars) VALUES (${intent.plan.month},${row.id},${runtime.fee.upperBoundMicrodollars})`,
      );
      await audit(tx, row);
      await assertActivePlanInTx(tx, intent.plan, this.env);
      const final = await this.finalCheck(tx, userId, intent, runtime, false);
      if (
        final.now.toISOString().slice(0, 10) !== now.toISOString().slice(0, 10)
      )
        throw new AppError("mcp_operation_expired", 409);
      return view(row);
    });
  }
  async enter(
    userId: string,
    id: string,
    expectedRevision: number,
  ): Promise<OperationView> {
    this.requireAuthority();
    return this.transaction(async (tx) => {
      const row = await this.owned(tx, userId, id);
      this.cas(row, expectedRevision);
      if (row.state !== "reserved" || row.attempts !== 0)
        throw new AppError("mcp_operation_already_entered", 409);
      const [owner] = await tx.execute<{ connection_id: string }>(
        sql`SELECT connection_id FROM mcp_operation_owner WHERE operation_id=${id}`,
      );
      const [connection] = await tx.execute<{ revision: string }>(
        sql`SELECT revision FROM mcp_connection WHERE id=${owner.connection_id}`,
      );
      if (!connection) throw new AppError("not_found", 404);
      const { connectionDigest, ...rest } = row.identity;
      const intent = parseOperationIntent({
        ...rest,
        connection: { id: owner.connection_id, revision: connection.revision },
      });
      if (
        operationDigest(intent.connection) !== connectionDigest ||
        operationDigest(intent) !== row.binding_digest
      )
        throw new AppError("mcp_connection_changed", 409);
      const now = await this.clock(tx),
        runtime = runtimeSnapshot(this.runtime(), now);
      ensureEqual(row.fee_snapshot, runtime.fee);
      await this.finalCheck(tx, userId, intent, runtime, false);
      await assertActivePlanInTx(tx, intent.plan, this.env);
      await this.period(tx, intent.plan);
      if (intent.approval) {
        const [used] = await tx.execute<{ id: string }>(
          sql`SELECT id FROM mcp_operation WHERE attempts=1 AND identity->'approval'->>'id'=${intent.approval.id} LIMIT 1`,
        );
        if (used) throw new AppError("mcp_approval_consumed", 409);
      }
      const [grant] = await tx.execute<{ id: string }>(
        sql`UPDATE mcp_fixture_authority SET consumed_by=${id} WHERE id=${intent.authority.id} AND user_id=${userId} AND consumed_by IS NULL RETURNING id`,
      );
      if (!grant) throw new AppError("mcp_approval_consumed", 409);
      const [entered] = await tx.execute<Row>(
        sql`UPDATE mcp_operation SET state='entered',attempts=1,revision=revision+1 WHERE id=${id} AND state='reserved' AND revision=${expectedRevision} RETURNING *`,
      );
      if (!entered) throw new AppError("mcp_operation_conflict", 409);
      await audit(tx, entered);
      await assertActivePlanInTx(tx, intent.plan, this.env);
      await this.finalCheck(tx, userId, intent, runtime, true);
      return view(entered);
    });
  }
  async status(userId: string, id: string): Promise<OperationView> {
    return this.transaction(async (tx) =>
      view(await this.owned(tx, userId, id)),
    );
  }
  async export(userId: string): Promise<OperationView[]> {
    const rows = await this.db.execute<Row>(
      sql`SELECT o.* FROM mcp_operation o JOIN mcp_operation_owner m ON m.operation_id=o.id WHERE m.user_id=${userId} ORDER BY o.created_at,o.id LIMIT 100`,
    );
    return rows.map(view);
  }
  /** A reserved row with attempts=0 is durable proof this store never committed entry. */
  async cancelReserved(userId: string, id: string, expectedRevision: number) {
    return this.transaction(async (tx) => {
      const row = await this.owned(tx, userId, id);
      this.cas(row, expectedRevision);
      if (row.state === "released") return view(row);
      if (row.state !== "reserved" || row.attempts !== 0)
        throw new AppError("mcp_entry_not_disproved", 409);
      const [updated] = await tx.execute<Row>(
        sql`UPDATE mcp_operation SET state='released',revision=revision+1 WHERE id=${id} AND revision=${expectedRevision} AND attempts=0 RETURNING *`,
      );
      await audit(tx, updated);
      return view(updated);
    });
  }
  async retainUnknown(userId: string, id: string, expectedRevision: number) {
    return this.transaction(async (tx) => {
      const row = await this.owned(tx, userId, id);
      this.cas(row, expectedRevision);
      if (row.state === "held") return view(row);
      if (row.state !== "entered")
        throw new AppError("mcp_operation_conflict", 409);
      const [updated] = await tx.execute<Row>(
        sql`UPDATE mcp_operation SET state='held',revision=revision+1 WHERE id=${id} AND revision=${expectedRevision} RETURNING *`,
      );
      await tx.execute(
        sql`UPDATE funding_control SET stopped=true WHERE id='platform'`,
      );
      await audit(tx, updated);
      return view(updated);
    });
  }
  /** Internal operator procedure. No endpoint; production authority is unavailable. */
  async bootstrapPeriod(rawPlan: unknown, rawSources: unknown) {
    this.requireAuthority();
    const parsed = planIdentitySchema.safeParse(rawPlan);
    const sources = z
      .array(
        z
          .object({
            sourceId: z.uuid(),
            amountMicrodollars: z
              .number()
              .int()
              .min(1)
              .max(Number.MAX_SAFE_INTEGER),
          })
          .strict(),
      )
      .max(1000)
      .safeParse(rawSources);
    if (!parsed.success || !sources.success)
      throw new AppError("invalid_mcp_period", 400);
    const plan = deepFreeze(parsed.data),
      expected = deepFreeze(
        sources.data.sort((a, b) => a.sourceId.localeCompare(b.sourceId)),
      );
    return this.transaction(async (tx) => {
      const active = await assertActivePlanInTx(tx, plan, this.env);
      const actual = await this.sources(tx, plan.month);
      ensureEqual(expected, actual, "mcp_period_sources_changed");
      const [existing] = await tx.execute<{
        plan_identity: unknown;
        sources_digest: string;
      }>(sql`SELECT * FROM mcp_operation_period WHERE month=${plan.month}`);
      if (existing) {
        ensureEqual(existing.plan_identity, plan, "mcp_period_conflict");
        ensureEqual(
          existing.sources_digest,
          operationDigest(actual),
          "mcp_period_conflict",
        );
        return;
      }
      if (
        actual.reduce((sum, row) => sum + row.amountMicrodollars, 0) >
        active.a_mcp
      )
        throw new AppError("mcp_allocation_exhausted", 429);
      await tx.execute(
        sql`INSERT INTO mcp_operation_period(month,plan_identity,sources_digest) VALUES (${plan.month},${JSON.stringify(plan)}::jsonb,${operationDigest(actual)})`,
      );
      for (const source of actual)
        await tx.execute(
          sql`INSERT INTO mcp_operation_commitment(month,source_id,amount_microdollars) VALUES (${plan.month},${source.sourceId},${source.amountMicrodollars})`,
        );
      await assertActivePlanInTx(tx, plan, this.env);
      this.requireAuthority();
    });
  }
  async reconcile(
    operationId: string,
    bindingDigest: string,
    receiptId: string,
    expectedRevision: number,
  ): Promise<OperationView> {
    this.requireAuthority();
    return this.transaction(async (tx) => {
      const [row] = await tx.execute<Row>(
        sql`SELECT * FROM mcp_operation WHERE id=${operationId} AND binding_digest=${bindingDigest}`,
      );
      if (!row) throw new AppError("not_found", 404);
      const [evidence] = await tx.execute<{ receipt: unknown }>(
        sql`SELECT receipt FROM mcp_fixture_receipt WHERE id=${receiptId} AND operation_id=${operationId}`,
      );
      if (!evidence) throw new AppError("mcp_receipt_unavailable", 503);
      const receipt = parseOperationReceipt(evidence.receipt);
      if (
        receipt.operationId !== operationId ||
        receipt.bindingDigest !== bindingDigest ||
        receipt.id !== receiptId
      )
        throw new AppError("mcp_receipt_conflict", 409);
      if (row.state === "settled") {
        ensureEqual(row.receipt, receipt, "mcp_receipt_conflict");
        return view(row);
      }
      this.cas(row, expectedRevision);
      if (
        !["entered", "held"].includes(row.state) ||
        receipt.incurredMicrodollars < Number(row.incurred_microdollars)
      )
        throw new AppError("mcp_receipt_conflict", 409);
      const [updated] = await tx.execute<Row>(
        sql`UPDATE mcp_operation SET state='settled',incurred_microdollars=${receipt.incurredMicrodollars},receipt_id=${receipt.id},receipt=${JSON.stringify(receipt)}::jsonb,revision=revision+1 WHERE id=${operationId} AND revision=${expectedRevision} RETURNING *`,
      );
      if (receipt.incurredMicrodollars > Number(row.reserved_microdollars))
        await tx.execute(
          sql`UPDATE funding_control SET stopped=true WHERE id='platform'`,
        );
      await audit(tx, updated);
      this.requireAuthority();
      return view(updated);
    });
  }
  // This issuer is explicitly fixture-only, persisted and exact-operation-bound.
  async issueFixtureAuthority(userId: string, raw: unknown, expiresAt: string) {
    this.requireAuthority();
    const intent = parseOperationIntent(raw);
    if (!z.iso.datetime().safeParse(expiresAt).success)
      throw new AppError("invalid_mcp_authority", 400);
    // Fixture policy is deliberately conservative: every call requires exact approval.
    if (intent.profile.purpose === "mcp.call" && !intent.approval)
      throw new AppError("mcp_approval_required", 403);
    await this.transaction(async (tx) => {
      if (intent.approval) {
        const [used] = await tx.execute<{ id: string }>(
          sql`SELECT id FROM mcp_fixture_authority WHERE approval_id=${intent.approval.id} UNION ALL SELECT id FROM mcp_operation WHERE attempts=1 AND identity->'approval'->>'id'=${intent.approval.id} LIMIT 1`,
        );
        if (used) throw new AppError("mcp_approval_consumed", 409);
      }
      await tx.execute(
        sql`INSERT INTO mcp_fixture_authority(id,user_id,connection_id,intent_digest,fee_digest,approval_id,authority,expires_at) VALUES (${intent.authority.id},${userId},${intent.connection.id},${operationDigest(intent)},${intent.feeDigest},${intent.approval?.id ?? null},${JSON.stringify({ authority: intent.authority, catalog: intent.catalog, action: intent.action, approval: intent.approval })}::jsonb,${expiresAt})`,
      );
      this.requireAuthority();
    });
  }
  async issueFixtureReceipt(raw: unknown) {
    this.requireAuthority();
    const receipt = parseOperationReceipt(raw);
    await this.transaction(async (tx) => {
      await tx.execute(
        sql`INSERT INTO mcp_fixture_receipt(id,operation_id,receipt) VALUES (${receipt.id},${receipt.operationId},${JSON.stringify(receipt)}::jsonb)`,
      );
      this.requireAuthority();
    });
  }
}
export function createMcpOperationStore(options: Pick<Options, "db"> = {}) {
  const store = new McpOperationStore(
    options.db ?? requireDb(),
    () => undefined,
    () => process.env,
    false,
  );
  return {
    reserve: store.reserve.bind(store),
    enter: store.enter.bind(store),
    status: store.status.bind(store),
    export: store.export.bind(store),
    cancelReserved: store.cancelReserved.bind(store),
    retainUnknown: store.retainUnknown.bind(store),
    reconcile: store.reconcile.bind(store),
  };
}
/** Never construct outside offline tests. Every authority-dependent call checks NODE_ENV again. */
export function createFixtureMcpOperationStore(options: Required<Options>) {
  fixtureGate();
  return new McpOperationStore(options.db, options.runtime, options.env, true);
}
