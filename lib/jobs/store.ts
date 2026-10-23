import "server-only";
import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { mutateArtifactInTransaction } from "@/lib/artifacts/service";
import { lockAttachments } from "@/lib/attachments/store";
import { isInvitedLogin, parseInviteLogins } from "@/lib/auth/env";
import { lockByokResources } from "@/lib/byok/store";
import type { Database, DatabaseTransaction } from "@/lib/db/client";
import { chatMessage } from "@/lib/db/schema";
import { AppError } from "@/lib/errors";
import {
  JOB_ACTION_REVISION,
  JOB_LIMITS,
  type JobLease,
  type JobState,
  type JobView,
  jobApproval,
  jobRequest,
} from "./contract";

type Row = {
  id: string;
  user_id: string;
  source_artifact_id: string;
  source_version: number;
  action_revision: typeof JOB_ACTION_REVISION;
  state: JobState;
  checkpoint: number;
  checkpoint_digest: string | null;
  proposal: string | null;
  approval_expires_at: Date | null;
  approved_digest: string | null;
  fence: number;
  attempts: number;
  result_artifact_id: string | null;
  error: string | null;
};
const view = (row: Row): JobView => ({
  id: row.id,
  state: row.state,
  source: { artifactId: row.source_artifact_id, version: row.source_version },
  checkpoint: row.checkpoint_digest,
  actionRevision: row.action_revision,
  proposal: row.proposal,
  approvalExpiresAt: row.approval_expires_at,
  resultArtifactId: row.result_artifact_id,
  attempts: row.attempts,
  error: row.error,
});
const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
function fail(id: string, status = 409): never {
  throw new AppError(id, status);
}

/** All operations share deletion's byok -> attachments -> owner lock order.
 * The jobs lock follows attachments and precedes owner rows. No remote work occurs.
 */
async function lock(
  tx: DatabaseTransaction,
  ownerId: string,
  invite = true,
  missingOkay = false,
) {
  await lockByokResources(tx);
  await lockAttachments(tx);
  await tx.execute(sql`SELECT pg_advisory_xact_lock(41021417)`);
  const [owner] = await tx.execute<{ github_login: string | null }>(
    sql`SELECT github_login FROM "user" WHERE id=${ownerId} FOR UPDATE`,
  );
  if (!owner) {
    if (missingOkay) return false;
    fail("not_found", 404);
  }
  if (
    invite &&
    !isInvitedLogin(
      owner.github_login,
      parseInviteLogins(process.env.GITHUB_INVITE_LOGINS),
    )
  )
    fail("invite_required", 403);
  return true;
}
async function currentInvite(tx: DatabaseTransaction, ownerId: string) {
  const [owner] = await tx.execute<{ github_login: string | null }>(
    sql`SELECT github_login FROM "user" WHERE id=${ownerId}`,
  );
  if (!owner) fail("not_found", 404);
  if (
    !isInvitedLogin(
      owner.github_login,
      parseInviteLogins(process.env.GITHUB_INVITE_LOGINS),
    )
  )
    fail("invite_required", 403);
}
async function source(tx: DatabaseTransaction, row: Row) {
  const [revision] = await tx.execute<{ content: string; chat_id: string }>(sql`
    SELECT r.content,a.chat_id FROM artifact_revision r JOIN artifact a ON a.id=r.artifact_id AND a.user_id=r.user_id
    JOIN chat c ON c.id=a.chat_id AND c.user_id=a.user_id
    WHERE a.id=${row.source_artifact_id} AND a.user_id=${row.user_id} AND r.version=${row.source_version} LIMIT 1`);
  return revision;
}
async function job(tx: DatabaseTransaction, ownerId: string, id: string) {
  const [row] = await tx.execute<Row>(
    sql`SELECT * FROM durable_job WHERE id=${id} AND user_id=${ownerId} FOR UPDATE`,
  );
  if (!row) fail("not_found", 404);
  return row;
}
async function fenced(tx: DatabaseTransaction, lease: JobLease) {
  const row = await job(tx, lease.ownerId, lease.id);
  if (
    row.state !== "running" ||
    row.fence !== lease.fence ||
    row.attempts !== lease.attempt ||
    row.checkpoint !== lease.checkpoint
  )
    fail("job_stale_lease");
  return row;
}
/** Last awaited SQL before returning/mutation is authoritative database wall time. */
async function validLease(tx: DatabaseTransaction, lease: JobLease) {
  const [row] =
    await tx.execute(sql`SELECT id FROM durable_job WHERE id=${lease.id} AND user_id=${lease.ownerId}
    AND state='running' AND fence=${lease.fence} AND attempts=${lease.attempt}
    AND lease_expires_at>clock_timestamp() AND started_at+${JOB_LIMITS.wallMs} * interval '1 millisecond'>clock_timestamp()`);
  if (!row) fail("job_stale_lease");
}

export class JobStore {
  constructor(private readonly db: Database) {}

  async enqueue(ownerId: string, raw: unknown): Promise<JobView> {
    const parsed = jobRequest.safeParse(raw);
    if (!parsed.success) fail("invalid_job", 400);
    const input = parsed.data;
    return this.db.transaction(async (tx) => {
      await lock(tx, ownerId);
      const [existing] = await tx.execute<Row>(
        sql`SELECT * FROM durable_job WHERE id=${input.id}`,
      );
      if (existing) {
        if (existing.user_id !== ownerId) fail("not_found", 404);
        if (
          existing.source_artifact_id !== input.source.artifactId ||
          existing.source_version !== input.source.version
        )
          fail("job_conflict");
        return view(existing);
      }
      const [ownedSource] =
        await tx.execute(sql`SELECT a.id FROM artifact a JOIN artifact_revision r ON r.artifact_id=a.id AND r.user_id=a.user_id
        WHERE a.id=${input.source.artifactId} AND a.user_id=${ownerId} AND r.version=${input.source.version}`);
      if (!ownedSource) fail("not_found", 404);
      const [counts] = await tx.execute<{
        queued: number;
        owned: number;
        total: number;
      }>(sql`SELECT
        count(*) FILTER(WHERE user_id=${ownerId} AND state='queued')::integer AS queued,
        count(*) FILTER(WHERE user_id=${ownerId})::integer AS owned, count(*)::integer AS total FROM durable_job`);
      if (
        counts.queued >= JOB_LIMITS.queuedPerOwner ||
        counts.owned >= JOB_LIMITS.recordsPerOwner ||
        counts.total >= JOB_LIMITS.recordsGlobal
      )
        fail("job_limits");
      await currentInvite(tx, ownerId);
      const [row] =
        await tx.execute<Row>(sql`INSERT INTO durable_job(id,user_id,source_artifact_id,source_version,state)
        VALUES(${input.id},${ownerId},${input.source.artifactId},${input.source.version},'queued') RETURNING *`);
      return view(row);
    });
  }

  async read(ownerId: string, id: string) {
    return this.db.transaction(async (tx) => {
      await lock(tx, ownerId);
      return view(await job(tx, ownerId, id));
    });
  }

  async list(ownerId: string) {
    return this.db.transaction(async (tx) => {
      await lock(tx, ownerId);
      return (
        await tx.execute<Row>(
          sql`SELECT * FROM durable_job WHERE user_id=${ownerId} ORDER BY created_at DESC,id LIMIT ${JOB_LIMITS.recordsPerOwner}`,
        )
      ).map(view);
    });
  }

  /** Internal account export: the caller already checks account access. Like
   * existing account exports this is owner-filtered data access, not admission
   * to execute work, and remains usable after invitation configuration changes.
   */
  async export(ownerId: string) {
    return (
      await this.db.execute<Row>(
        sql`SELECT * FROM durable_job WHERE user_id=${ownerId} ORDER BY created_at DESC,id LIMIT ${JOB_LIMITS.recordsPerOwner}`,
      )
    ).map(view);
  }

  /** A delivery contains only the job id. Poll queued and expired running ids from
   * durable storage after restarts; an HTTP handler must never run this method.
   */
  async claim(id: string): Promise<JobLease | null> {
    if (!jobRequest.shape.id.safeParse(id).success) fail("invalid_job", 400);
    return this.db.transaction(async (tx) => {
      // Read owner hint only. Recheck identity/existence under the common locks.
      const [hint] = await tx.execute<{ user_id: string }>(
        sql`SELECT user_id FROM durable_job WHERE id=${id}`,
      );
      if (!hint) return null;
      if (!(await lock(tx, hint.user_id, false, true))) return null;
      const row = await job(tx, hint.user_id, id);
      if (row.state === "awaiting_approval") {
        const [expiredApproval] =
          await tx.execute(sql`SELECT id FROM durable_job WHERE id=${id}
          AND (approval_expires_at<=clock_timestamp() OR started_at+${JOB_LIMITS.wallMs} * interval '1 millisecond'<=clock_timestamp())`);
        if (expiredApproval)
          await this.terminal(tx, row, "job_approval_expired");
        return null;
      }
      const [eligible] =
        await tx.execute(sql`SELECT id FROM durable_job WHERE id=${id}
        AND (state='queued' OR (state='running' AND lease_expires_at<=clock_timestamp()))`);
      if (!eligible) return null;
      const [owner] = await tx.execute<{ github_login: string | null }>(
        sql`SELECT github_login FROM "user" WHERE id=${row.user_id}`,
      );
      if (
        !isInvitedLogin(
          owner.github_login,
          parseInviteLogins(process.env.GITHUB_INVITE_LOGINS),
        )
      ) {
        await this.terminal(tx, row, "job_invite_required");
        return null;
      }
      const [expired] =
        await tx.execute(sql`SELECT id FROM durable_job WHERE id=${id} AND
        (attempts>=${JOB_LIMITS.attempts} OR started_at+${JOB_LIMITS.wallMs} * interval '1 millisecond'<=clock_timestamp())`);
      if (expired) {
        await this.terminal(tx, row, "job_limits");
        return null;
      }
      if (row.checkpoint === 1) {
        const [approved] = await tx.execute(
          sql`SELECT id FROM durable_job WHERE id=${id} AND approved_digest=checkpoint_digest AND approval_expires_at>clock_timestamp()`,
        );
        if (!approved) {
          await this.terminal(tx, row, "job_approval_expired");
          return null;
        }
      }
      const [counts] = await tx.execute<{
        owned: number;
        total: number;
      }>(sql`SELECT
        count(*) FILTER(WHERE user_id=${row.user_id})::integer AS owned, count(*)::integer AS total
        FROM durable_job WHERE id<>${id} AND state IN ('running','awaiting_approval')`);
      if (
        counts.owned >= JOB_LIMITS.activePerOwner ||
        counts.total >= JOB_LIMITS.activeGlobal
      )
        return null;
      await tx.execute(
        sql`UPDATE durable_job_attempt SET state='expired' WHERE job_id=${id} AND state='entered'`,
      );
      // Condition clocks in the write itself: no earlier snapshot authorizes work.
      const [claimed] =
        await tx.execute<Row>(sql`UPDATE durable_job SET state='running', fence=fence+1, attempts=attempts+1,
        started_at=coalesce(started_at,clock_timestamp()),lease_expires_at=clock_timestamp()+${JOB_LIMITS.leaseMs} * interval '1 millisecond'
        WHERE id=${id} AND attempts<${JOB_LIMITS.attempts}
        AND (started_at IS NULL OR started_at+${JOB_LIMITS.wallMs} * interval '1 millisecond'>clock_timestamp())
        AND (checkpoint=0 OR (approved_digest=checkpoint_digest AND approval_expires_at>clock_timestamp())) RETURNING *`);
      if (!claimed) return null;
      await tx.execute(
        sql`INSERT INTO durable_job_attempt(job_id,fence,checkpoint,state) VALUES(${id},${claimed.fence},${claimed.checkpoint},'entered')`,
      );
      const lease = {
        id,
        ownerId: claimed.user_id,
        fence: claimed.fence,
        attempt: claimed.attempts,
        checkpoint: claimed.checkpoint,
      };
      await currentInvite(tx, lease.ownerId);
      await validLease(tx, lease);
      return lease;
    });
  }

  private async terminal(tx: DatabaseTransaction, row: Row, error: string) {
    await tx.execute(
      sql`UPDATE durable_job SET state='failed',error=${error},lease_expires_at=NULL,fence=fence+1 WHERE id=${row.id}`,
    );
    await tx.execute(
      sql`UPDATE durable_job_attempt SET state='expired' WHERE job_id=${row.id} AND state='entered'`,
    );
  }

  async checkpoint(rawLease: JobLease) {
    const lease = { ...rawLease };
    return this.db.transaction(async (tx) => {
      await lock(tx, lease.ownerId);
      const row = await fenced(tx, lease);
      if (row.action_revision !== JOB_ACTION_REVISION)
        fail("job_approval_changed");
      const revision = await source(tx, row);
      if (!revision) {
        await this.terminal(tx, row, "job_source_unavailable");
        return;
      }
      if (row.checkpoint === 0) {
        // Data is measured, never executed or interpreted as instructions. No raw
        // source/title/provider credentials are copied into job state or logs.
        const proposal = `# Proposed local fixture report\n\nDeterministic local fixture; no LLM or external provider was used.\n\nSource revision: ${row.source_version}\nUTF-8 bytes: ${Buffer.byteLength(revision.content)}\nCharacters: ${Array.from(revision.content).length}\nSHA-256: ${digest(revision.content)}\n\nThis report is a proposal for owner review.\n`;
        const checkpointDigest = digest(
          JSON.stringify([
            JOB_ACTION_REVISION,
            row.id,
            row.source_artifact_id,
            row.source_version,
            proposal,
          ]),
        );
        await currentInvite(tx, lease.ownerId);
        const [updated] =
          await tx.execute(sql`UPDATE durable_job SET state='awaiting_approval',checkpoint=1,
          checkpoint_digest=${checkpointDigest},proposal=${proposal},approval_expires_at=clock_timestamp()+${JOB_LIMITS.approvalMs} * interval '1 millisecond',lease_expires_at=NULL
          WHERE id=${row.id} AND fence=${lease.fence} AND state='running'
          AND lease_expires_at>clock_timestamp() AND started_at+${JOB_LIMITS.wallMs} * interval '1 millisecond'>clock_timestamp() RETURNING id`);
        if (!updated) fail("job_stale_lease");
      } else {
        if (!row.proposal || row.approved_digest !== row.checkpoint_digest)
          fail("job_approval_required");
        const messageId = crypto.randomUUID();
        await tx.insert(chatMessage).values({
          id: messageId,
          chatId: revision.chat_id,
          userId: lease.ownerId,
          role: "assistant",
          parts: [{ type: "text", text: row.proposal }],
          attachments: [],
        });
        const result = await mutateArtifactInTransaction(tx, lease.ownerId, {
          action: "create",
          chatId: revision.chat_id,
          messageId,
          kind: "markdown",
          title: "Proposed local fixture report",
        });
        await currentInvite(tx, lease.ownerId);
        // The F11 result and completion share this transaction. Losing a fence,
        // cancellation, deletion, deadline or approval rolls back all new rows.
        const [updated] =
          await tx.execute(sql`UPDATE durable_job SET state='completed',checkpoint=2,result_artifact_id=${result.id},lease_expires_at=NULL
          WHERE id=${row.id} AND fence=${lease.fence} AND state='running'
          AND lease_expires_at>clock_timestamp() AND started_at+${JOB_LIMITS.wallMs} * interval '1 millisecond'>clock_timestamp()
          AND approved_digest=checkpoint_digest AND approval_expires_at>clock_timestamp() RETURNING id`);
        if (!updated) fail("job_stale_lease");
      }
      await tx.execute(
        sql`UPDATE durable_job_attempt SET state='checkpointed' WHERE job_id=${row.id} AND fence=${lease.fence}`,
      );
    });
  }

  async approve(ownerId: string, raw: unknown) {
    const parsed = jobApproval.safeParse(raw);
    if (!parsed.success) fail("invalid_job_approval", 400);
    const input = parsed.data;
    return this.db.transaction(async (tx) => {
      await lock(tx, ownerId);
      const row = await job(tx, ownerId, input.id);
      if (row.checkpoint_digest !== input.checkpoint)
        fail("job_approval_changed");
      if (!(await source(tx, row))) fail("not_found", 404);
      const [queued] = await tx.execute<{ count: number }>(
        sql`SELECT count(*)::integer AS count FROM durable_job WHERE user_id=${ownerId} AND state='queued'`,
      );
      if (queued.count >= JOB_LIMITS.queuedPerOwner) fail("job_limits");
      await currentInvite(tx, ownerId);
      const [updated] =
        await tx.execute<Row>(sql`UPDATE durable_job SET state='queued',approved_digest=checkpoint_digest
        WHERE id=${row.id} AND state='awaiting_approval' AND checkpoint_digest=${input.checkpoint} AND action_revision=${input.actionRevision}
        AND approval_expires_at>clock_timestamp() AND started_at+${JOB_LIMITS.wallMs} * interval '1 millisecond'>clock_timestamp() RETURNING *`);
      if (!updated) fail("job_approval_expired");
      return view(updated);
    });
  }

  async cancel(ownerId: string, id: string) {
    return this.db.transaction(async (tx) => {
      await lock(tx, ownerId, false);
      const row = await job(tx, ownerId, id);
      if (["completed", "failed", "cancelled"].includes(row.state))
        return view(row);
      const [updated] = await tx.execute<Row>(
        sql`UPDATE durable_job SET state='cancelled',fence=fence+1,lease_expires_at=NULL WHERE id=${id} RETURNING *`,
      );
      await tx.execute(
        sql`UPDATE durable_job_attempt SET state='cancelled' WHERE job_id=${id} AND state='entered'`,
      );
      return view(updated);
    });
  }

  async pendingDeliveryIds() {
    return (
      await this.db.execute<{ id: string }>(sql`SELECT id FROM durable_job
      WHERE state='queued' OR (state='running' AND lease_expires_at<=clock_timestamp())
      OR (state='awaiting_approval' AND (approval_expires_at<=clock_timestamp() OR started_at+${JOB_LIMITS.wallMs} * interval '1 millisecond'<=clock_timestamp())) ORDER BY created_at,id LIMIT 100`)
    ).map((row) => row.id);
  }
}
