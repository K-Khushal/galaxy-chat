import "server-only";
import { createHash, createHmac } from "node:crypto";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { mutateArtifactInTransaction } from "@/lib/artifacts/service";
import {
  type EnvSource,
  isInvitedLogin,
  parseInviteLogins,
} from "@/lib/auth/env";
import {
  type Database,
  type DatabaseTransaction,
  requireDb,
} from "@/lib/db/client";
import { chatMessage } from "@/lib/db/schema";
import { AppError } from "@/lib/errors";
import {
  canonicalJson,
  resolvePlatformBudgetConfig,
} from "@/lib/funding/config";
import {
  assertActivePlanInTx,
  assertSandboxEnvelopeInTx,
  lockFunding,
} from "@/lib/funding/store";
import { JOB_LIMITS } from "@/lib/jobs/contract";
import { jobInternals } from "@/lib/jobs/store";
import { parseSandboxRuntime, type SandboxRuntime } from "./config";
import {
  SANDBOX_ACTION_REVISION,
  SANDBOX_LIMITS,
  type SandboxBinding,
  type SandboxBindingCore,
  type SandboxGatewayIdentity,
  type SandboxJobView,
  type SandboxLease,
  type SandboxOperationView,
  type SandboxPolicy,
  type SandboxRequest,
  sandboxApprovalSchema,
  sandboxBindingSchema,
  sandboxRequestSchema,
} from "./contract";
import type {
  SandboxGatewayClient,
  SandboxWireOutcome,
} from "./gateway-client";
import {
  assertSandboxGateway,
  assertSandboxOperationGateway,
} from "./gateway-client";

type Tx = DatabaseTransaction;
type Row = {
  id: string;
  actor_key: string;
  actor_version: string;
  idempotency_key: string;
  binding_digest: string;
  identity: SandboxBinding;
  fee_snapshot: unknown;
  month: string;
  day: string;
  state: SandboxOperationView["state"];
  revision: number;
  reserved_microdollars: string;
  incurred_microdollars: string;
  attempts: number;
  deadline: Date;
  create_requested_at: Date | null;
  provider_handle: string | null;
  receipt_id: string | null;
  receipt: unknown;
  created_at: Date;
};
type JobRow = {
  id: string;
  user_id: string;
  source_artifact_id: string;
  source_version: number;
  action_revision: string;
  state: string;
  checkpoint: number;
  checkpoint_digest: string | null;
  proposal: string | null;
  approval_expires_at: Date | null;
  approved_digest: string | null;
  fence: number;
  attempts: number;
  lease_expires_at: Date | null;
  started_at: Date | null;
  result_artifact_id: string | null;
  error: string | null;
};

const sha256 = (value: string) =>
  createHash("sha256").update(value).digest("hex");

function fail(id: string, status = 409): never {
  throw new AppError(id, status);
}

function view(row: Row): SandboxOperationView {
  return Object.freeze({
    id: row.id,
    state: row.state,
    revision: row.revision,
    reservedMicrodollars: Number(row.reserved_microdollars),
    incurredMicrodollars: Number(row.incurred_microdollars),
    createdAt: new Date(row.created_at).toISOString(),
  });
}

function jobView(row: JobRow): SandboxJobView {
  return {
    id: row.id,
    state: row.state as SandboxJobView["state"],
    source: { artifactId: row.source_artifact_id, version: row.source_version },
    checkpoint: row.checkpoint_digest,
    actionRevision: SANDBOX_ACTION_REVISION,
    proposal: row.proposal,
    approvalExpiresAt: row.approval_expires_at,
    resultArtifactId: row.result_artifact_id,
    attempts: row.attempts,
    error: row.error,
  };
}

async function audit(tx: Tx, row: Row) {
  await tx.execute(
    sql`INSERT INTO sandbox_operation_audit(id,operation_id,event,revision) VALUES (${crypto.randomUUID()},${row.id},${row.state},${row.revision})`,
  );
}

async function evidence(
  tx: Tx,
  operationId: string,
  ordinal: number,
  payload: Record<string, unknown>,
) {
  // Evidence digests are operation-scoped: identical wire payloads for different
  // operations must never collide.
  const digest = sha256(canonicalJson({ operationId, ...payload }));
  await tx.execute(
    sql`INSERT INTO sandbox_operation_evidence(operation_id,ordinal,digest,evidence) VALUES (${operationId},${ordinal},${digest},${JSON.stringify(payload)}::jsonb)`,
  );
  return digest;
}

async function operation(tx: Tx, id: string): Promise<Row> {
  const [row] = await tx.execute<Row>(
    sql`SELECT o.* FROM sandbox_operation o WHERE o.id=${id}`,
  );
  if (!row) fail("not_found", 404);
  return row;
}

async function jobOperation(tx: Tx, jobId: string): Promise<Row | null> {
  const [row] = await tx.execute<Row>(
    sql`SELECT o.* FROM sandbox_operation o JOIN sandbox_operation_owner m ON m.operation_id=o.id WHERE m.job_id=${jobId} ORDER BY o.created_at DESC,o.id LIMIT 1`,
  );
  return row ?? null;
}

export class SandboxStore {
  constructor(
    private readonly db: Database = requireDb(),
    private readonly runtimeProvider: () => unknown = () => undefined,
    private readonly env: () => EnvSource = () => process.env,
  ) {}

  /** Every privileged call re-checks the environment. The offline-scripted
   * adapter is rejected outside NODE_ENV=test on every call; production paths
   * resolve the provider catalog and deny with precise reasons. */
  private authority(now: Date): SandboxRuntime {
    return parseSandboxRuntime(this.runtimeProvider(), this.env(), now);
  }

  private async clock(tx: Tx) {
    const [row] = await tx.execute<{ now: Date }>(
      sql`SELECT clock_timestamp() AS now`,
    );
    return new Date(row.now);
  }

  private transaction<T>(run: (tx: Tx) => Promise<T>) {
    // Funding lock first, then the established byok -> attachments -> jobs ->
    // owner order; every post-lock statement sees a fresh committed snapshot.
    return this.db
      .transaction(
        async (tx) => {
          await lockFunding(tx);
          return run(tx);
        },
        { isolationLevel: "read committed" },
      )
      .catch((error: unknown) => {
        if (error instanceof AppError) throw error;
        throw new AppError("sandbox_storage_unavailable", 503);
      });
  }

  private async lockAll(
    tx: Tx,
    ownerId: string,
    invite = true,
    missingOkay = false,
  ) {
    return jobInternals.lock(tx, ownerId, invite, missingOkay);
  }

  private async invite(tx: Tx, ownerId: string) {
    const [owner] = await tx.execute<{ github_login: string | null }>(
      sql`SELECT github_login FROM "user" WHERE id=${ownerId}`,
    );
    if (!owner) fail("not_found", 404);
    if (
      !isInvitedLogin(
        owner.github_login,
        parseInviteLogins(this.env().GITHUB_INVITE_LOGINS),
      )
    )
      fail("sandbox_invite_required", 403);
  }

  private gatewayAuthority(
    gateway: SandboxGatewayClient,
    runtime = this.authority(new Date()),
  ) {
    assertSandboxGateway(gateway, {
      ...runtime.gateway,
      key: runtime.gatewayKey,
    });
  }

  /** Last awaited statement before entry/publication returns one coherent fresh
   * SQL snapshot. Locks already serialize owner, source, job and funding writes. */
  private async finalAuthority(
    tx: Tx,
    lease: SandboxLease,
    op: Row,
    completed = false,
  ) {
    await assertActivePlanInTx(tx, op.identity.plan, this.env);
    const [fresh] = await tx.execute<{
      content: string;
      now: Date;
      github_login: string | null;
      plan_identity: unknown;
      sources_digest: string;
      ordinary_infra_microdollars: string;
    }>(sql`
      SELECT r.content,clock_timestamp() AS now,u.github_login,p.plan_identity,p.sources_digest,p.ordinary_infra_microdollars
      FROM durable_job j JOIN "user" u ON u.id=j.user_id
      JOIN artifact a ON a.id=j.source_artifact_id AND a.user_id=j.user_id
      JOIN artifact_revision r ON r.artifact_id=a.id AND r.user_id=a.user_id AND r.version=j.source_version
      JOIN sandbox_operation o ON o.id=${op.id}
      JOIN sandbox_period p ON p.month=${op.identity.plan.month}
      WHERE j.id=${lease.id} AND j.user_id=${lease.ownerId} AND j.fence=${lease.fence}
      AND j.attempts=${lease.attempt} AND j.checkpoint=${completed ? 2 : 1}
      AND j.state=${completed ? "completed" : "running"}
      AND (${completed} OR j.lease_expires_at>clock_timestamp())
      AND j.started_at+${JOB_LIMITS.wallMs} * interval '1 millisecond'>clock_timestamp()
      AND j.approved_digest=j.checkpoint_digest AND j.checkpoint_digest=${op.identity.approval.checkpoint}
      AND j.approval_expires_at>clock_timestamp() AND o.deadline>clock_timestamp()
      AND j.source_artifact_id=${op.identity.source.artifactId} AND j.source_version=${op.identity.source.version}`);
    if (!fresh) fail("job_stale_lease");
    const now = new Date(fresh.now);
    const runtime = this.authority(now);
    const plan = resolvePlatformBudgetConfig(this.env(), now);
    if (
      !isInvitedLogin(
        fresh.github_login,
        parseInviteLogins(this.env().GITHUB_INVITE_LOGINS),
      )
    )
      fail("sandbox_invite_required", 403);
    const binding = this.bindingCore(
      {
        id: lease.id,
        source_artifact_id: op.identity.source.artifactId,
        source_version: op.identity.source.version,
      },
      fresh.content,
      runtime,
      plan,
      op.identity.approvalExpiresAt,
      sha256(
        canonicalJson({
          planIdentity: fresh.plan_identity,
          sourcesDigest: fresh.sources_digest,
          ordinaryInfraMicrodollars: Number(fresh.ordinary_infra_microdollars),
        }),
      ),
    );
    if (
      sha256(canonicalJson({ ...binding, approval: op.identity.approval })) !==
      op.binding_digest
    )
      fail("sandbox_binding_changed");
    return runtime;
  }

  /** Retained financial actor: the canonical numeric GitHub account identity under
   * a domain-separated secret. Account recreation and actor-key rotation never
   * reset limits; legacy financial actors are untouched. */
  private async actor(tx: Tx, userId: string, runtime: SandboxRuntime) {
    await tx.execute(sql`SELECT id FROM "user" WHERE id=${userId} FOR UPDATE`);
    const accounts = await tx.execute<{ account_id: string }>(
      sql`SELECT account_id FROM account WHERE user_id=${userId} AND provider_id='github' ORDER BY id LIMIT 2 FOR UPDATE`,
    );
    if (
      accounts.length !== 1 ||
      !/^[1-9][0-9]{0,19}$/.test(accounts[0].account_id)
    )
      fail("sandbox_principal_unavailable", 403);
    const accountId = accounts[0].account_id;
    const fingerprint = sha256(
      `galaxy-sandbox-counter-key-v1:${runtime.principalSecret}`,
    );
    const [registered] = await tx.execute<{ fingerprint: string }>(
      sql`SELECT fingerprint FROM sandbox_counter_key WHERE id='counter'`,
    );
    if (registered && registered.fingerprint !== fingerprint)
      fail("sandbox_actor_rotation_unknown", 503);
    await tx.execute(
      sql`INSERT INTO sandbox_counter_key(id,fingerprint) VALUES ('counter',${fingerprint}) ON CONFLICT DO NOTHING`,
    );
    const principal = createHmac("sha256", runtime.principalSecret)
      .update(
        canonicalJson({
          domain: "sandbox-financial-principal-v1",
          providerId: "github",
          accountId,
        }),
      )
      .digest("hex");
    const [prior] = await tx.execute<{
      actor_key: string;
      actor_version: string;
    }>(
      sql`SELECT actor_key,actor_version FROM sandbox_actor_principal WHERE principal_digest=${principal}`,
    );
    const version = prior?.actor_version ?? runtime.activeKeyVersion;
    const key = runtime.actorKeys[version];
    if (!key) fail("sandbox_actor_rotation_unknown", 503);
    const actorKey = createHmac("sha256", key)
      .update(`galaxy-sandbox-github-owner-v1:${accountId}`)
      .digest("hex");
    if (prior && prior.actor_key !== actorKey)
      fail("sandbox_actor_rotation_unknown", 503);
    await tx.execute(
      sql`INSERT INTO sandbox_actor_principal(principal_digest,actor_key,actor_version) VALUES (${principal},${actorKey},${version}) ON CONFLICT DO NOTHING`,
    );
    return { key: actorKey, version };
  }

  /** Derives the binding core from authoritative state only; any drift from the
   * approved checkpoint digest fails the run before any funding or creation. */
  private bindingCore(
    row: Pick<JobRow, "id" | "source_artifact_id" | "source_version">,
    content: string,
    runtime: SandboxRuntime,
    plan: ReturnType<typeof resolvePlatformBudgetConfig>,
    approvalExpiresAt: string,
    envelopeDigest: string,
  ): SandboxBindingCore {
    const gateway: SandboxGatewayIdentity = {
      protocol: "sandbox-gateway-v1",
      baseUrl: runtime.gateway.baseUrl,
      keyIdentity: runtime.gateway.keyIdentity,
    };
    const policy: SandboxPolicy = {
      imageDigest: this.env().SANDBOX_IMAGE_DIGEST?.trim() ?? "",
      interpreterDigest: this.env().SANDBOX_INTERPRETER_DIGEST?.trim() ?? "",
      interpreter: "python3",
      entryPath: "/app/main.py",
      vcpuMilli: 1000,
      memoryMiB: 512,
      diskMiB: 128,
      network: "denied",
      packageInstallation: "denied",
      commandMs: SANDBOX_LIMITS.commandMs,
      absoluteLifetimeMs: SANDBOX_LIMITS.absoluteLifetimeMs,
      logsBytes: SANDBOX_LIMITS.logsBytes,
      resultBytes: SANDBOX_LIMITS.wireResultBytes,
    };
    const binding: SandboxBindingCore = {
      actionRevision: SANDBOX_ACTION_REVISION,
      jobId: row.id,
      source: {
        artifactId: row.source_artifact_id,
        version: row.source_version,
        contentSha256: sha256(content),
      },
      language: "python",
      selectedInputDigests: [],
      policy,
      gateway,
      provider: {
        id: runtime.providerId,
        account: runtime.providerAccount,
        region: runtime.providerRegion,
      },
      feeDigest: sha256(canonicalJson(runtime.fee)),
      envelopeDigest,
      plan: {
        month: plan.plan.month,
        revision: plan.plan.revision,
        digest: plan.digest,
        capacityDigest: plan.capacityDigest,
      },
      approvalExpiresAt,
    };
    return binding;
  }

  private async envelopeDigest(tx: Tx, month: string) {
    const [period] = await tx.execute<{
      plan_identity: unknown;
      sources_digest: string;
      ordinary_infra_microdollars: string;
    }>(
      sql`SELECT plan_identity,sources_digest,ordinary_infra_microdollars FROM sandbox_period WHERE month=${month}`,
    );
    if (!period) fail("sandbox_period_unavailable", 503);
    return sha256(
      canonicalJson({
        planIdentity: period.plan_identity,
        sourcesDigest: period.sources_digest,
        ordinaryInfraMicrodollars: Number(period.ordinary_infra_microdollars),
      }),
    );
  }

  private requireBindingCoreChecks(binding: SandboxBindingCore) {
    if (
      !/^[a-f0-9]{64}$/.test(binding.policy.imageDigest) ||
      !/^[a-f0-9]{64}$/.test(binding.policy.interpreterDigest)
    )
      fail("sandbox_policy_unconfigured", 503);
    if (
      Buffer.byteLength(binding.gateway.baseUrl) > 512 ||
      !binding.gateway.baseUrl.startsWith("http")
    )
      fail("sandbox_gateway_unconfigured", 503);
  }

  async enqueue(ownerId: string, raw: unknown): Promise<SandboxJobView> {
    const parsed = sandboxRequestSchema.safeParse(raw);
    if (!parsed.success) fail("invalid_sandbox_request", 400);
    const input = parsed.data as SandboxRequest;
    this.authority(new Date());
    return this.transaction(async (tx) => {
      await this.lockAll(tx, ownerId);
      const [existing] = await tx.execute<JobRow>(
        sql`SELECT * FROM durable_job WHERE id=${input.id}`,
      );
      if (existing) {
        if (existing.user_id !== ownerId) fail("not_found", 404);
        if (
          existing.action_revision !== SANDBOX_ACTION_REVISION ||
          existing.source_artifact_id !== input.source.artifactId ||
          existing.source_version !== input.source.version
        )
          fail("sandbox_conflict");
        return jobView(existing);
      }
      const [ownedSource] = await tx.execute(
        sql`SELECT a.id FROM artifact a JOIN artifact_revision r ON r.artifact_id=a.id AND r.user_id=a.user_id
        WHERE a.id=${input.source.artifactId} AND a.user_id=${ownerId} AND r.version=${input.source.version}`,
      );
      if (!ownedSource) fail("not_found", 404);
      const [counts] = await tx.execute<{
        queued: number;
        owned: number;
        total: number;
      }>(sql`SELECT
        count(*) FILTER(WHERE user_id=${ownerId} AND state='queued')::integer AS queued,
        count(*) FILTER(WHERE user_id=${ownerId})::integer AS owned, count(*)::integer AS total FROM durable_job`);
      if (
        counts.queued >= SANDBOX_LIMITS.queuedPerOwner ||
        counts.owned >= JOB_LIMITS.recordsPerOwner ||
        counts.total >= JOB_LIMITS.recordsGlobal
      )
        fail("sandbox_limits");
      await this.invite(tx, ownerId);
      const [row] = await tx.execute<JobRow>(
        sql`INSERT INTO durable_job(id,user_id,source_artifact_id,source_version,action_revision,state)
        VALUES(${input.id},${ownerId},${input.source.artifactId},${input.source.version},${SANDBOX_ACTION_REVISION},'queued') RETURNING *`,
      );
      return jobView(row);
    });
  }

  async read(ownerId: string, id: string) {
    return this.transaction(async (tx) => {
      await this.lockAll(tx, ownerId);
      return jobView(await this.job(tx, ownerId, id));
    });
  }

  async list(ownerId: string) {
    return this.transaction(async (tx) => {
      await this.lockAll(tx, ownerId);
      return (
        await tx.execute<JobRow>(
          sql`SELECT * FROM durable_job WHERE user_id=${ownerId} AND action_revision=${SANDBOX_ACTION_REVISION} ORDER BY created_at DESC,id LIMIT ${JOB_LIMITS.recordsPerOwner}`,
        )
      ).map(jobView);
    });
  }

  /** Sanitized owner export: no provider handles, gateway identities or fee snapshots. */
  async exportOperations(ownerId: string) {
    return (
      await this.db
        .execute<Row>(
          sql`SELECT o.id,o.state,o.revision,o.reserved_microdollars,o.incurred_microdollars,o.created_at
        FROM sandbox_operation o JOIN sandbox_operation_owner m ON m.operation_id=o.id
        WHERE m.user_id=${ownerId} ORDER BY o.created_at,o.id LIMIT ${SANDBOX_LIMITS.operationsPerOwner}`,
        )
        .catch(() => {
          throw new AppError("sandbox_storage_unavailable", 503);
        })
    ).map(view);
  }

  private async job(tx: Tx, ownerId: string, id: string) {
    const [row] = await tx.execute<JobRow>(
      sql`SELECT * FROM durable_job WHERE id=${id} AND user_id=${ownerId} FOR UPDATE`,
    );
    if (!row) fail("not_found", 404);
    return row;
  }

  async approve(ownerId: string, raw: unknown) {
    const parsed = sandboxApprovalSchema.safeParse(raw);
    if (!parsed.success) fail("invalid_sandbox_approval", 400);
    const input = parsed.data;
    this.authority(new Date());
    return this.transaction(async (tx) => {
      await this.lockAll(tx, ownerId);
      const row = await this.job(tx, ownerId, input.id);
      if ((row.action_revision as string) !== SANDBOX_ACTION_REVISION)
        fail("sandbox_conflict");
      if (row.checkpoint_digest !== input.checkpoint)
        fail("sandbox_approval_changed");
      const [ownedSource] = await tx.execute(
        sql`SELECT a.id FROM artifact a JOIN artifact_revision r ON r.artifact_id=a.id AND r.user_id=a.user_id
        WHERE a.id=${row.source_artifact_id} AND a.user_id=${ownerId} AND r.version=${row.source_version}`,
      );
      if (!ownedSource) fail("not_found", 404);
      const [queued] = await tx.execute<{ count: number }>(
        sql`SELECT count(*)::integer AS count FROM durable_job WHERE user_id=${ownerId} AND state='queued'`,
      );
      if (queued.count >= SANDBOX_LIMITS.queuedPerOwner) fail("sandbox_limits");
      await this.invite(tx, ownerId);
      const [updated] = await tx.execute<JobRow>(
        sql`UPDATE durable_job SET state='queued',approved_digest=checkpoint_digest
        WHERE id=${row.id} AND state='awaiting_approval' AND checkpoint_digest=${input.checkpoint}
        AND action_revision=${SANDBOX_ACTION_REVISION}
        AND approval_expires_at>clock_timestamp() AND started_at+${JOB_LIMITS.wallMs} * interval '1 millisecond'>clock_timestamp() RETURNING *`,
      );
      if (!updated) fail("sandbox_approval_expired");
      await this.invite(tx, ownerId);
      this.authority(await this.clock(tx));
      return jobView(updated);
    });
  }

  /** Checkpoint 0: bind the exact owned revision and open the exact-action approval. */
  private async propose(lease: SandboxLease) {
    return this.transaction(async (tx) => {
      await this.lockAll(tx, lease.ownerId);
      const row = await jobInternals.fenced(tx, lease);
      if ((row.action_revision as string) !== SANDBOX_ACTION_REVISION)
        fail("sandbox_conflict");
      if (row.checkpoint !== 0) fail("job_stale_lease");
      const revision = await jobInternals.source(tx, row);
      if (!revision) {
        await jobInternals.terminalize(tx, row.id, "job_source_unavailable");
        return;
      }
      if (Buffer.byteLength(revision.content) > SANDBOX_LIMITS.inputBytes) {
        await jobInternals.terminalize(tx, row.id, "sandbox_input_oversized");
        return;
      }
      const now = await this.clock(tx);
      let runtime: SandboxRuntime;
      let plan: ReturnType<typeof resolvePlatformBudgetConfig>;
      try {
        runtime = this.authority(now);
        plan = resolvePlatformBudgetConfig(this.env(), now);
      } catch {
        // Configuration failure: zero creation calls, no consumed approval or reservation.
        await jobInternals.terminalize(tx, row.id, "sandbox_unconfigured");
        return;
      }
      const binding = this.bindingCore(
        row,
        revision.content,
        runtime,
        plan,
        new Date(now.getTime() + SANDBOX_LIMITS.approvalMs).toISOString(),
        await this.envelopeDigest(tx, plan.plan.month),
      );
      this.requireBindingCoreChecks(binding);
      const checkpointDigest = sha256(canonicalJson(binding));
      const proposal = `# Proposed sandbox run\n\nExact owned Python artifact revision, bound for isolated third-party execution. Nothing has executed.\n\nSource revision: ${row.source_version}\nContent SHA-256: ${binding.source.contentSha256}\nProvider: ${binding.provider.id}\nRegion: ${binding.provider.region}\nNetwork: denied; package installation: denied\nvCPU: 1000m; memory: 512 MiB; disk: 128 MiB; lifetime: 300s\n\nThis report is a proposal for owner review.\n`;
      await this.invite(tx, lease.ownerId);
      const [updated] = await tx.execute(
        sql`UPDATE durable_job SET state='awaiting_approval',checkpoint=1,
        checkpoint_digest=${checkpointDigest},proposal=${proposal},
        approval_expires_at=${binding.approvalExpiresAt},lease_expires_at=NULL
        WHERE id=${row.id} AND fence=${lease.fence} AND state='running'
        AND lease_expires_at>clock_timestamp() AND started_at+${JOB_LIMITS.wallMs} * interval '1 millisecond'>clock_timestamp() RETURNING id`,
      );
      if (!updated) fail("job_stale_lease");
      await tx.execute(
        sql`UPDATE durable_job_attempt SET state='checkpointed' WHERE job_id=${row.id} AND fence=${lease.fence}`,
      );
    });
  }

  /** Funding BEFORE entry: reserve, enter and persist the durable creation
   * tombstone in one transaction, all before any gateway create call. */
  private async reserveForExecution(lease: SandboxLease) {
    return this.transaction(async (tx) => {
      await this.lockAll(tx, lease.ownerId);
      const row = await jobInternals.fenced(tx, lease);
      if ((row.action_revision as string) !== SANDBOX_ACTION_REVISION)
        fail("sandbox_conflict");
      if (row.checkpoint !== 1 || !row.proposal)
        fail("sandbox_approval_required");
      if (!row.approved_digest || row.approved_digest !== row.checkpoint_digest)
        fail("sandbox_approval_required");
      const revision = await jobInternals.source(tx, row);
      if (!revision) {
        await jobInternals.terminalize(tx, row.id, "job_source_unavailable");
        return null;
      }
      const now = await this.clock(tx);
      let runtime: SandboxRuntime;
      let plan: ReturnType<typeof resolvePlatformBudgetConfig>;
      try {
        runtime = this.authority(now);
        plan = resolvePlatformBudgetConfig(this.env(), now);
      } catch {
        await jobInternals.terminalize(tx, row.id, "sandbox_unconfigured");
        return null;
      }
      // Fresh approval expiry against the authoritative clock.
      const validApproval = await tx.execute(
        sql`SELECT id FROM durable_job WHERE id=${row.id} AND approved_digest=checkpoint_digest
        AND approval_expires_at>clock_timestamp()
        AND started_at+${JOB_LIMITS.wallMs} * interval '1 millisecond'>clock_timestamp()`,
      );
      if (!validApproval.length) {
        await jobInternals.terminalize(tx, row.id, "sandbox_approval_expired");
        return null;
      }
      if (!row.approval_expires_at) {
        await jobInternals.terminalize(tx, row.id, "sandbox_approval_expired");
        return null;
      }
      const binding = this.bindingCore(
        row,
        revision.content,
        runtime,
        plan,
        new Date(row.approval_expires_at).toISOString(),
        await this.envelopeDigest(tx, plan.plan.month),
      );
      this.requireBindingCoreChecks(binding);
      const checkpointDigest = sha256(canonicalJson(binding));
      // Any drift from the approved binding denies before funding or creation.
      if (checkpointDigest !== row.checkpoint_digest) {
        await jobInternals.terminalize(tx, row.id, "sandbox_binding_changed");
        return null;
      }
      const full = sandboxBindingSchema.parse({
        ...binding,
        approval: { checkpoint: checkpointDigest },
      });
      const bindingDigest = sha256(canonicalJson(full));
      const [consumed] = await tx.execute<{ id: string }>(
        sql`SELECT id FROM sandbox_operation WHERE identity->'approval'->>'checkpoint'=${checkpointDigest} AND attempts=1 LIMIT 1`,
      );
      if (consumed) fail("sandbox_approval_consumed");
      const planRow = await assertActivePlanInTx(
        tx,
        binding.plan,
        this.env,
        now,
      );
      await assertSandboxEnvelopeInTx(
        tx,
        binding.plan.month,
        planRow,
        runtime.fee.upperBoundMicrodollars,
      );
      const actor = await this.actor(tx, lease.ownerId, runtime);
      const [counts] = await tx.execute<{
        owner: number;
        total: number;
        owner_records: number;
        total_records: number;
      }>(
        sql`SELECT
        count(*) FILTER(WHERE actor_key=${actor.key} AND state<>'released')::integer AS owner,
        count(*) FILTER(WHERE state<>'released')::integer AS total,
        count(*) FILTER(WHERE actor_key=${actor.key})::integer AS owner_records,
        count(*)::integer AS total_records
        FROM sandbox_operation`,
      );
      if (
        counts.owner >= runtime.fee.capacity.ownerActive ||
        counts.total >= runtime.fee.capacity.globalActive ||
        counts.owner_records >=
          Math.min(
            SANDBOX_LIMITS.operationsPerOwner,
            runtime.fee.capacity.ownerRecords,
          ) ||
        counts.total_records >=
          Math.min(
            SANDBOX_LIMITS.operationsGlobal,
            runtime.fee.capacity.globalRecords,
          )
      )
        fail("sandbox_capacity_exhausted", 429);
      const id = crypto.randomUUID();
      const [limits] = await tx.execute<{ deadline: Date }>(sql`SELECT least(
        lease_expires_at, started_at+${JOB_LIMITS.wallMs} * interval '1 millisecond',
        approval_expires_at, ${runtime.fee.expiresAt}::timestamptz,
        clock_timestamp()+${SANDBOX_LIMITS.commandMs} * interval '1 millisecond') AS deadline
        FROM durable_job WHERE id=${row.id}`);
      const deadline = new Date(limits.deadline);
      const [op] = await tx.execute<Row>(
        sql`INSERT INTO sandbox_operation(id,actor_key,actor_version,idempotency_key,binding_digest,identity,fee_snapshot,month,day,state,reserved_microdollars,deadline)
        VALUES(${id},${actor.key},${actor.version},${id},${bindingDigest},${JSON.stringify(full)}::jsonb,${JSON.stringify(runtime.fee)}::jsonb,${binding.plan.month},${now.toISOString().slice(0, 10)},'reserved',${runtime.fee.upperBoundMicrodollars},${deadline.toISOString()}) RETURNING *`,
      );
      await tx.execute(
        sql`INSERT INTO sandbox_operation_owner(operation_id,user_id,job_id,source_artifact_id,source_version)
        VALUES(${id},${lease.ownerId},${row.id},${row.source_artifact_id},${row.source_version})`,
      );
      await tx.execute(
        sql`INSERT INTO sandbox_operation_commitment(month,source_id,amount_microdollars)
        VALUES(${binding.plan.month},${id},${runtime.fee.upperBoundMicrodollars})`,
      );
      await audit(tx, op);
      // Final authoritative checks after all writes, before the durable entry.
      await assertActivePlanInTx(tx, binding.plan, this.env);
      const [entered] = await tx.execute<Row>(
        sql`UPDATE sandbox_operation SET state='entered',attempts=1,revision=revision+1,create_requested_at=clock_timestamp()
        WHERE id=${id} AND state='reserved' RETURNING *`,
      );
      if (!entered) fail("sandbox_conflict");
      await audit(tx, entered);
      await this.finalAuthority(tx, lease, entered);
      return {
        deadline: deadline.getTime(),
        operationId: id,
        binding: full,
        bindingDigest,
        runtime,
      };
    });
  }

  private async recordCreateOutcome(
    lease: SandboxLease,
    operationId: string,
    outcome: SandboxWireOutcome<{ handle: string }>,
  ) {
    return this.transaction(async (tx) => {
      await this.lockAll(tx, lease.ownerId);
      const row = await jobInternals.fenced(tx, lease);
      const op = await operation(tx, operationId);
      if (op.identity.jobId !== row.id) fail("sandbox_conflict");
      if (outcome.kind === "ok") {
        const digest = await evidence(tx, operationId, 0, {
          kind: "create_ok",
          handle: outcome.value.handle,
          bindingDigest: op.binding_digest,
        });
        const [updated] = await tx.execute<Row>(
          sql`UPDATE sandbox_operation SET provider_handle=${outcome.value.handle},revision=revision+1
          WHERE id=${operationId} AND state='entered' AND create_requested_at IS NOT NULL AND provider_handle IS NULL RETURNING *`,
        );
        if (!updated) fail("sandbox_conflict");
        return {
          kind: "created",
          handle: outcome.value.handle,
          digest,
        } as const;
      }
      const digest = await evidence(tx, operationId, 0, {
        kind: "create_ambiguous",
        reason:
          outcome.kind === "rejected"
            ? `http_${outcome.status}`
            : outcome.reason,
        bindingDigest: op.binding_digest,
      });
      // Ambiguous create: remote existence unknown. Full liability is retained
      // and all funded admissions stop until authentic settlement.
      const [updated] = await tx.execute<Row>(
        sql`UPDATE sandbox_operation SET state='held',revision=revision+1
        WHERE id=${operationId} AND state='entered' AND create_requested_at IS NOT NULL RETURNING *`,
      );
      if (!updated) fail("sandbox_conflict");
      await audit(tx, updated);
      await tx.execute(
        sql`UPDATE funding_control SET stopped=true WHERE id='platform'`,
      );
      await jobInternals.terminalize(tx, row.id, "sandbox_create_ambiguous");
      return { kind: "ambiguous", digest } as const;
    });
  }

  private async recordTerminalFailure(
    lease: SandboxLease,
    operationId: string,
    kind: string,
    _detail: Record<string, unknown>,
  ) {
    await this.retainUnknown(lease, operationId, kind);
  }

  /** Anonymous, retention-only operator recovery. No configuration, owner, invite,
   * current lease or attempt is required; this API can never create or forgive. */
  async retainUncertainOperation(
    operationId: string,
  ): Promise<SandboxOperationView> {
    return this.retainOperation(operationId, "operator_retention");
  }

  /** Status/terminate only, including lost handles. Configuration and ownership
   * are intentionally not prerequisites to keeping and cleaning a financial orphan. */
  async recoverOperation(
    operationId: string,
    gateway: SandboxGatewayClient,
  ): Promise<SandboxOperationView> {
    await this.retainUncertainOperation(operationId);
    let op = await this.transaction((tx) => operation(tx, operationId));
    if (op.attempts !== 1) return view(op);
    const identity = sandboxBindingSchema.safeParse(op.identity);
    if (!identity.success) fail("sandbox_binding_unavailable", 503);
    assertSandboxOperationGateway(gateway, identity.data.gateway);
    if (!op.provider_handle) {
      const outcome = await gateway.lookup(op.id, op.binding_digest);
      if (outcome.kind !== "ok" || !outcome.value.found) return view(op);
      const handle = outcome.value.handle;
      op = await this.transaction(async (tx) => {
        const fresh = await operation(tx, operationId);
        if (fresh.provider_handle) return fresh;
        await evidence(tx, operationId, 8, {
          kind: "orphan_handle",
          handle,
          bindingDigest: fresh.binding_digest,
        });
        const [updated] =
          await tx.execute<Row>(sql`UPDATE sandbox_operation SET provider_handle=${handle},revision=revision+1
          WHERE id=${operationId} AND state='held' AND provider_handle IS NULL RETURNING *`);
        if (!updated) fail("sandbox_conflict");
        await audit(tx, updated);
        return updated;
      });
    }
    if (op.provider_handle)
      await this.terminateHandle(gateway, op.provider_handle, op.id);
    return view(op);
  }

  private async retainUnknown(
    _lease: SandboxLease,
    operationId: string,
    reason: string,
  ) {
    return this.retainOperation(operationId, reason);
  }

  private async retainOperation(operationId: string, reason: string) {
    if (!z.uuid().safeParse(operationId).success)
      fail("invalid_sandbox_operation", 400);
    return this.transaction(async (tx) => {
      let op = await operation(tx, operationId);
      if (["entered", "completed_unreconciled"].includes(op.state)) {
        await evidence(tx, operationId, 6, { kind: "unresolved", reason });
        const [updated] = await tx.execute<Row>(sql`UPDATE sandbox_operation
          SET state='held',revision=revision+1 WHERE id=${operationId}
          AND state IN ('entered','completed_unreconciled') RETURNING *`);
        if (updated) {
          await audit(tx, updated);
          op = updated;
        }
      }
      if (op.attempts === 1)
        await tx.execute(
          sql`UPDATE funding_control SET stopped=true WHERE id='platform'`,
        );
      return view(op);
    });
  }

  /** Publication and completion share one transaction with the current owned
   * fence, approval and source identity; any loss rolls back all new rows. */
  private async publish(
    lease: SandboxLease,
    op: Row,
    result: { logs: string; result: string },
  ) {
    return this.transaction(async (tx) => {
      await this.lockAll(tx, lease.ownerId);
      const row = await jobInternals.fenced(tx, lease);
      await jobInternals.validLease(tx, lease);
      if ((row.action_revision as string) !== SANDBOX_ACTION_REVISION)
        fail("sandbox_conflict");
      if (
        !row.approved_digest ||
        row.approved_digest !== row.checkpoint_digest ||
        !row.approval_expires_at ||
        row.approval_expires_at <= (await this.clock(tx))
      )
        fail("sandbox_approval_required");
      const revision = await jobInternals.source(tx, row);
      if (!revision) fail("not_found", 404);
      const fresh = await operation(tx, op.id);
      if (fresh.state !== "entered" || !fresh.provider_handle)
        fail("sandbox_conflict");
      const resultDigest = sha256(canonicalJson({ result: result.result }));
      const logsDigest = sha256(canonicalJson({ logs: result.logs }));
      if (
        Buffer.byteLength(result.result) > SANDBOX_LIMITS.finalArtifactBytes ||
        Buffer.byteLength(result.logs) > SANDBOX_LIMITS.logsBytes
      )
        fail("sandbox_output_oversized");
      const fence = "`".repeat(
        Math.max(
          3,
          ...[...`${result.result}${result.logs}`.matchAll(/`+/g)].map(
            (m) => m[0].length + 1,
          ),
        ),
      );
      const report = `# Sandbox execution report\n\nBounded output of the approved sandbox run, treated as untrusted data. No code from it was interpreted.\n\nBinding digest: ${op.binding_digest}\nResult SHA-256: ${resultDigest}\nLogs SHA-256: ${logsDigest}\n\n## Result\n\n${fence}\n${result.result}\n${fence}\n\n## Logs\n\n${fence}\n${result.logs}\n${fence}\n`;
      if (Buffer.byteLength(report) > SANDBOX_LIMITS.finalArtifactBytes)
        fail("sandbox_output_oversized");
      await this.invite(tx, lease.ownerId);
      const messageId = crypto.randomUUID();
      await tx.insert(chatMessage).values({
        id: messageId,
        chatId: revision.chat_id,
        userId: lease.ownerId,
        role: "assistant",
        parts: [{ type: "text", text: report }],
        attachments: [],
      });
      const artifact = await mutateArtifactInTransaction(tx, lease.ownerId, {
        action: "create",
        chatId: revision.chat_id,
        messageId,
        kind: "markdown",
        title: "Sandbox execution report",
      });
      await evidence(tx, op.id, 1, {
        kind: "result",
        resultDigest,
        logsDigest,
      });
      const [updated] = await tx.execute(
        sql`UPDATE durable_job SET state='completed',checkpoint=2,result_artifact_id=${artifact.id},lease_expires_at=NULL
        WHERE id=${row.id} AND fence=${lease.fence} AND state='running'
        AND lease_expires_at>clock_timestamp() AND started_at+${JOB_LIMITS.wallMs} * interval '1 millisecond'>clock_timestamp()
        AND approved_digest=checkpoint_digest AND approval_expires_at>clock_timestamp() RETURNING id`,
      );
      if (!updated) fail("job_stale_lease");
      const [reconcilable] = await tx.execute<Row>(
        sql`UPDATE sandbox_operation SET state='completed_unreconciled',revision=revision+1
        WHERE id=${op.id} AND state='entered' RETURNING *`,
      );
      if (!reconcilable) fail("sandbox_conflict");
      await audit(tx, reconcilable);
      await tx.execute(
        sql`UPDATE durable_job_attempt SET state='checkpointed' WHERE job_id=${row.id} AND fence=${lease.fence}`,
      );
      await this.finalAuthority(tx, lease, fresh, true);
      return { artifactId: artifact.id, resultDigest, logsDigest };
    });
  }

  private async recordTermination(
    lease: SandboxLease | null,
    operationId: string,
    payload: Record<string, unknown>,
  ) {
    const run = async (tx: Tx) => {
      await evidence(tx, operationId, 7, payload);
    };
    if (!lease) {
      await this.db.transaction(run, { isolationLevel: "read committed" });
      return;
    }
    await this.transaction(async (tx) => {
      await this.lockAll(tx, lease.ownerId);
      await jobInternals.fenced(tx, lease);
      await run(tx);
    });
  }

  /** Best-effort terminate of the exact same operation's handle only. A terminate
   * response is never treated as remote stop or refund proof; liability stays
   * until an authentic receipt reconciles the operation. */
  private async terminateHandle(
    gateway: SandboxGatewayClient,
    handle: string,
    operationId: string,
  ) {
    try {
      const outcome = await gateway.terminate(handle);
      const payload = {
        kind: "terminate",
        handle,
        outcome:
          outcome.kind === "ok"
            ? { terminated: outcome.value.terminated }
            : outcome.kind === "rejected"
              ? { status: outcome.status }
              : { reason: outcome.reason },
      };
      await this.recordTermination(null, operationId, payload);
    } catch {
      // Termination evidence is best-effort; uncertainty is already durable.
    }
  }

  /** Checkpoint dispatcher for the durable jobs registry. The stopAfterCreate
   * option exists only so tests can park execution on an exact crash boundary;
   * recovery then continues from the durable journal without another create. */
  async dispatch(
    lease: SandboxLease,
    gateway: SandboxGatewayClient,
    options?: { stopAfterCreate?: boolean },
  ) {
    this.authority(new Date());
    const phase = await this.transaction(async (tx) => {
      await this.lockAll(tx, lease.ownerId);
      const row = await jobInternals.fenced(tx, lease);
      if ((row.action_revision as string) !== SANDBOX_ACTION_REVISION)
        fail("sandbox_conflict");
      return { checkpoint: row.checkpoint };
    });
    if (phase.checkpoint === 0) return this.propose(lease);
    return this.execute(lease, gateway, options);
  }

  /** Checkpoint 1: funded, fenced execution across explicit crash boundaries.
   * Every boundary leaves a durable journal state that recovery reconciles
   * without ever issuing another create call. */
  async execute(
    lease: SandboxLease,
    gateway: SandboxGatewayClient,
    options?: { stopAfterCreate?: boolean },
  ) {
    this.gatewayAuthority(gateway);
    this.authority(new Date());
    const existing = await this.transaction(async (tx) => {
      await this.lockAll(tx, lease.ownerId);
      const row = await jobInternals.fenced(tx, lease);
      return jobOperation(tx, row.id);
    });
    if (existing) {
      // Recovery: further attempts reconcile/status/terminate only the same
      // operation and never create again.
      return this.recover(lease, existing, gateway);
    }
    const reserved = await this.reserveForExecution(lease);
    if (!reserved) return;
    let observedHandle: string | null = null;
    try {
      this.gatewayAuthority(gateway, reserved.runtime);
      const outcome = await gateway.create(
        {
          protocol: "sandbox-gateway-v1",
          idempotencyKey: reserved.operationId,
          bindingDigest: reserved.bindingDigest,
          policy: reserved.binding.policy,
          input: {
            contentSha256: reserved.binding.source.contentSha256,
            selectedInputDigests: [],
          },
        },
        reserved.deadline,
      );
      if (outcome.kind === "ok") observedHandle = outcome.value.handle;
      const recorded = await this.recordCreateOutcome(
        lease,
        reserved.operationId,
        outcome,
      );
      if (recorded.kind !== "created") {
        await this.recoverOperation(reserved.operationId, gateway);
        return;
      }
      if (options?.stopAfterCreate) return;
      const op = await this.transaction(async (tx) =>
        operation(tx, reserved.operationId),
      );
      await this.pollAndPublish(lease, op, gateway);
    } catch (error) {
      await this.retainUnknown(
        lease,
        reserved.operationId,
        "post_entry_failure",
      );
      // A lost response has no handle; never invent or recreate one.
      const op = await this.transaction((tx) =>
        operation(tx, reserved.operationId),
      );
      const handle = op.provider_handle ?? observedHandle;
      if (handle) await this.terminateHandle(gateway, handle, op.id);
      throw error;
    }
  }

  /** Recovery after a crash, response loss or lease expiry. The durable creation
   * tombstone guarantees no second create: only status/terminate are ever issued. */
  private async recover(
    lease: SandboxLease,
    candidate: Row,
    gateway: SandboxGatewayClient,
  ) {
    this.gatewayAuthority(gateway);
    const op = await this.transaction(async (tx) => {
      await this.lockAll(tx, lease.ownerId);
      await jobInternals.fenced(tx, lease);
      const owned = await jobOperation(tx, lease.id);
      if (!owned || owned.id !== candidate.id) fail("sandbox_conflict");
      return owned;
    });
    if (
      ["held", "settled", "released", "completed_unreconciled"].includes(
        op.state,
      )
    ) {
      await this.transaction(async (tx) => {
        await this.lockAll(tx, lease.ownerId);
        await jobInternals.fenced(tx, lease);
        await jobInternals.terminalize(
          tx,
          lease.id,
          "sandbox_liability_retained",
        );
      });
      return;
    }
    if (op.state === "reserved") {
      // Entry never committed, so no create call was ever made.
      await this.transaction(async (tx) => {
        await this.lockAll(tx, lease.ownerId);
        await jobInternals.fenced(tx, lease);
        const [updated] = await tx.execute<Row>(
          sql`UPDATE sandbox_operation SET state='released',revision=revision+1 WHERE id=${op.id} AND state='reserved' AND attempts=0 RETURNING *`,
        );
        if (updated) await audit(tx, updated);
        await jobInternals.terminalize(
          tx,
          lease.id,
          "sandbox_operation_released",
        );
      });
      return;
    }
    if (!op.create_requested_at) {
      // Entered without a tombstone is unreachable through this store; retain
      // uncertainty rather than assume anything about the provider.
      await this.retainUnknown(lease, op.id, "entry_without_tombstone");
      return;
    }
    if (!op.provider_handle) {
      // Tombstone set, no handle: the create outcome is unknown.
      await this.recoverOperation(op.id, gateway);
      return;
    }
    try {
      await this.pollAndPublish(lease, op, gateway);
    } catch (error) {
      await this.retainUnknown(lease, op.id, "recovery_failure");
      if (op.provider_handle)
        await this.terminateHandle(gateway, op.provider_handle, op.id);
      throw error;
    }
  }

  /** Bounded status polling within the original lease; no timer renews any deadline. */
  private async pollAndPublish(
    lease: SandboxLease,
    op: Row,
    gateway: SandboxGatewayClient,
  ) {
    const handle = op.provider_handle;
    if (!handle) {
      await this.retainUnknown(lease, op.id, "create_outcome_unknown");
      return;
    }
    const commandDeadline = new Date(op.deadline).getTime();
    this.gatewayAuthority(gateway);
    let terminal: { logs: string; result: string } | null = null;
    while (Date.now() < commandDeadline) {
      const outcome = await gateway.status(handle, commandDeadline);
      if (outcome.kind === "ok") {
        if (outcome.value.handle !== handle) {
          await this.recordTerminalFailure(lease, op.id, "status_mismatch", {
            handle,
          });
          await this.terminateHandle(gateway, handle, op.id);
          return;
        }
        if (outcome.value.state === "completed") {
          terminal = { logs: outcome.value.logs, result: outcome.value.result };
          break;
        }
        if (
          outcome.value.state === "failed" ||
          outcome.value.state === "terminated"
        ) {
          await this.recordTerminalFailure(lease, op.id, "execution_failed", {
            state: outcome.value.state,
          });
          await this.terminateHandle(gateway, handle, op.id);
          return;
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!terminal) {
      // Deadline reached without terminal transport evidence: uncertainty is
      // retained without new admissions, config or owner attempts.
      await this.retainUnknown(lease, op.id, "status_deadline");
      await this.terminateHandle(gateway, handle, op.id);
      return;
    }
    await this.publish(lease, op, terminal);
    await this.terminateHandle(gateway, handle, op.id);
  }

  async status(ownerId: string, id: string): Promise<SandboxOperationView> {
    return this.transaction(async (tx) => {
      await this.lockAll(tx, ownerId);
      const [row] = await tx.execute<Row>(
        sql`SELECT o.* FROM sandbox_operation o JOIN sandbox_operation_owner m ON m.operation_id=o.id WHERE m.user_id=${ownerId} AND o.id=${id}`,
      );
      if (!row) fail("not_found", 404);
      return view(row);
    });
  }

  /** A reserved row with attempts=0 is durable proof this store never committed entry. */
  async cancelReserved(ownerId: string, id: string, expectedRevision: number) {
    return this.transaction(async (tx) => {
      await this.lockAll(tx, ownerId);
      const [row] = await tx.execute<Row>(
        sql`SELECT o.* FROM sandbox_operation o JOIN sandbox_operation_owner m ON m.operation_id=o.id WHERE m.user_id=${ownerId} AND o.id=${id}`,
      );
      if (!row) fail("not_found", 404);
      if (row.revision !== expectedRevision) fail("sandbox_conflict");
      if (row.state === "released") return view(row);
      if (row.state !== "reserved" || row.attempts !== 0)
        fail("sandbox_entry_not_disproved");
      const [updated] = await tx.execute<Row>(
        sql`UPDATE sandbox_operation SET state='released',revision=revision+1 WHERE id=${id} AND revision=${expectedRevision} AND attempts=0 RETURNING *`,
      );
      await audit(tx, updated);
      return view(updated);
    });
  }

  /** No authentic receipt issuer is implemented. Shape-valid JSON is not cost proof.
   * Preserve every hold until a separately reviewed authenticated authority exists. */
  async reconcile(
    _operationId: string,
    _bindingDigest: string,
    _receiptId: string,
    _expectedRevision: number,
  ): Promise<SandboxOperationView> {
    fail("sandbox_receipt_authority_unavailable", 503);
  }

  /** Operator-reviewed period bootstrap: freezes the plan identity, the durable
   * sources digest and the ordinary infrastructure commitment for the month. */
  async bootstrapPeriod(
    rawPlan: unknown,
    ordinaryInfraMicrodollars: number,
    rawSources?: unknown,
  ) {
    const now = new Date();
    this.authority(now);
    const parsed = z
      .object({
        month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
        revision: z.string().min(1).max(160),
        digest: z.string().regex(/^[a-f0-9]{64}$/),
        capacityDigest: z.string().regex(/^[a-f0-9]{64}$/),
      })
      .strict()
      .safeParse(rawPlan);
    if (
      !parsed.success ||
      !Number.isSafeInteger(ordinaryInfraMicrodollars) ||
      ordinaryInfraMicrodollars < 0 ||
      ordinaryInfraMicrodollars > 10_000_000
    )
      fail("invalid_sandbox_period", 400);
    const plan = parsed.data;
    return this.transaction(async (tx) => {
      // The bootstrap is the operator procedure that freezes the namespaced
      // carry, so it must be able to run while prior holds are uncovered.
      const sources = await this.durableSources(tx, plan.month);
      if (rawSources !== undefined) {
        const expected = z
          .array(
            z.object({
              sourceId: z.uuid(),
              amountMicrodollars: z.number().int().min(1),
            }),
          )
          .safeParse(rawSources);
        if (!expected.success) fail("invalid_sandbox_period", 400);
        const actual = sources.map((s) => ({
          sourceId: s.sourceId,
          amountMicrodollars: s.amountMicrodollars,
        }));
        if (canonicalJson(actual) !== canonicalJson(expected.data))
          fail("sandbox_period_sources_changed");
      }
      const [existing] = await tx.execute<{
        sources_digest: string;
        plan_identity: unknown;
        ordinary_infra_microdollars: string;
      }>(
        sql`SELECT sources_digest,plan_identity,ordinary_infra_microdollars FROM sandbox_period WHERE month=${plan.month}`,
      );
      if (existing) {
        if (
          existing.sources_digest !== sha256(canonicalJson(sources)) ||
          canonicalJson(existing.plan_identity) !== canonicalJson(plan) ||
          Number(existing.ordinary_infra_microdollars) !==
            ordinaryInfraMicrodollars
        )
          fail("sandbox_period_conflict");
        await assertActivePlanInTx(tx, plan, this.env);
        this.authority(await this.clock(tx));
        return;
      }
      if (
        ordinaryInfraMicrodollars +
          sources.reduce((sum, s) => sum + s.amountMicrodollars, 0) >
        (await tx
          .execute<{ k_infra: number }>(
            sql`SELECT k_infra::integer FROM platform_budget_plan WHERE month=${plan.month}`,
          )
          .then((rows) => rows[0]?.k_infra ?? 0))
      )
        fail("sandbox_envelope_exhausted", 429);
      await tx.execute(
        sql`INSERT INTO sandbox_period(month,plan_identity,sources_digest,ordinary_infra_microdollars)
        VALUES(${plan.month},${JSON.stringify(plan)}::jsonb,${sha256(canonicalJson(sources))},${ordinaryInfraMicrodollars})`,
      );
      for (const source of sources)
        await tx.execute(
          sql`INSERT INTO sandbox_operation_commitment(month,source_id,amount_microdollars)
          VALUES(${plan.month},${source.sourceId},${source.amountMicrodollars}) ON CONFLICT DO NOTHING`,
        );
      await assertActivePlanInTx(tx, plan, this.env);
      this.authority(await this.clock(tx));
    });
  }

  /** Durable prior holds: the exact sources any new month's carry must freeze. */
  async durableSources(tx: Tx, month: string) {
    const rows = await tx.execute<{ source_id: string; amount: string }>(sql`
      SELECT o.id AS source_id,greatest(
        CASE WHEN o.state='released' THEN 0 WHEN o.state='settled' THEN o.incurred_microdollars ELSE greatest(o.reserved_microdollars,o.incurred_microdollars) END,
        coalesce(c.amount,0))::text AS amount
      FROM sandbox_operation o LEFT JOIN (SELECT source_id,max(amount_microdollars) AS amount FROM sandbox_operation_commitment WHERE month<${month} GROUP BY source_id)c ON c.source_id=o.id
      WHERE o.month<${month} ORDER BY o.id`);
    return rows
      .map((row) => ({
        sourceId: row.source_id,
        amountMicrodollars: Number(row.amount),
      }))
      .filter((row) => row.amountMicrodollars > 0);
  }
}
