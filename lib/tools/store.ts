import "server-only";
import { sql } from "drizzle-orm";
import type { EnvSource } from "@/lib/auth/env";
import { resourceActor } from "@/lib/byok/config";
import { lockByokResources } from "@/lib/byok/store";
import { type DatabaseTransaction, requireDb } from "@/lib/db/client";
import { AppError } from "@/lib/errors";
import {
  type SearchRunState,
  searchEvidenceSchema,
} from "@/lib/search/contract";
import {
  type SelectedRevision,
  TOOL_LIMITS,
  type ToolEvent,
  type ToolRunRequest,
  type ToolRunView,
} from "./contract";

export async function validateRevisions(
  tx: DatabaseTransaction,
  userId: string,
  revisions: SelectedRevision[],
) {
  for (const revision of revisions) {
    const rows = await tx.execute(
      sql`SELECT r.version FROM artifact_revision r JOIN artifact a ON a.id=r.artifact_id WHERE a.user_id=${userId} AND r.user_id=${userId} AND r.artifact_id=${revision.artifactId} AND r.version=${revision.version}`,
    );
    if (!rows.length) throw new AppError("tool_revision_unavailable", 409);
  }
}
export type ActionBinding = {
  runId: string;
  toolCallId: string;
  tool: string;
  toolRevision: string;
  connectionRevision: string;
  arguments: Record<string, unknown>;
  target: string;
  costMicrodollars: number;
};
/** Canonical JSON is bounded and lossless; unknown/non-JSON values are rejected. */
export function canonical(value: unknown): string {
  const walk = (v: unknown): unknown => {
    if (v === null || typeof v === "string" || typeof v === "boolean") return v;
    if (typeof v === "number" && Number.isFinite(v))
      return Object.is(v, -0) ? 0 : v;
    if (Array.isArray(v)) return v.map(walk);
    if (
      v &&
      typeof v === "object" &&
      Object.getPrototypeOf(v) === Object.prototype
    )
      return Object.fromEntries(
        Object.entries(v)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([k, x]) => [k, walk(x)]),
      );
    throw new AppError("invalid_tool_action", 400);
  };
  const result = JSON.stringify(walk(value));
  if (Buffer.byteLength(result) > 8192)
    throw new AppError("invalid_tool_action", 400);
  return result;
}
export class ToolStore {
  constructor(private readonly db = requireDb()) {}
  async catalogRevisions(userId: string) {
    const rows = await this.db.execute<{
      artifactId: string;
      version: number;
      title: string;
    }>(
      sql`SELECT r.artifact_id AS "artifactId",r.version,r.title FROM artifact_revision r JOIN artifact a ON a.id=r.artifact_id AND a.user_id=r.user_id WHERE r.user_id=${userId} ORDER BY r.created_at DESC LIMIT 100`,
    );
    return [...rows];
  }
  async create(userId: string, request: ToolRunRequest) {
    await this.db.transaction(async (tx) => {
      await lockByokResources(tx);
      const [count] = await tx.execute<{ count: number; total: number }>(
        sql`SELECT count(*) FILTER(WHERE user_id=${userId})::integer AS count,count(*)::integer AS total FROM tool_run`,
      );
      if (
        count.count >= TOOL_LIMITS.records ||
        count.total >= TOOL_LIMITS.globalRecords
      )
        throw new AppError("tool_storage_limit", 429);
      await validateRevisions(tx, userId, request.revisions);
      const rows = await tx.execute(
        sql`INSERT INTO tool_run(id,user_id,request) VALUES(${request.id},${userId},${JSON.stringify(request)}::jsonb) ON CONFLICT DO NOTHING RETURNING id`,
      );
      if (!rows.length) throw new AppError("request_already_processed", 409);
    });
  }
  async step(options: {
    id: string;
    userId: string;
    env: EnvSource;
    step: number;
    inputBytes: number;
    outputTokens: number;
    revisions: SelectedRevision[];
  }) {
    await this.db.transaction(async (tx) => {
      await lockByokResources(tx);
      const actor = resourceActor(options.userId, options.env);
      // Revalidate the current credential and owned run inside the same claim transaction.
      const rows = await tx.execute(
        sql`SELECT o.id FROM byok_operation o JOIN provider_credential c ON c.user_id=${options.userId} AND c.provider=o.provider AND c.revision=o.credential_revision JOIN tool_run r ON r.id=o.id AND r.user_id=${options.userId} WHERE o.id=${options.id} AND o.actor_key=${actor} AND o.state='entered' AND c.test_state<>'invalid' AND r.state IN ('queued','running') AND r.created_at>now()-interval '20 seconds'`,
      );
      if (!rows.length) throw new AppError("tool_entry_denied", 409);
      await validateRevisions(tx, options.userId, options.revisions);
      const [prior] = await tx.execute<{ count: number }>(
        sql`SELECT count(*)::integer AS count FROM tool_step WHERE operation_id=${options.id}`,
      );
      if (prior.count !== options.step || options.step >= 3)
        throw new AppError("tool_step_limit", 409);
      await tx.execute(
        sql`INSERT INTO tool_step(operation_id,step,input_bytes,output_tokens) VALUES(${options.id},${options.step},${options.inputBytes},${options.outputTokens})`,
      );
      await tx.execute(
        sql`UPDATE tool_run SET state='running' WHERE id=${options.id} AND user_id=${options.userId}`,
      );
    });
  }
  async stepTerminal(id: string, step: number) {
    await this.db.execute(
      sql`UPDATE tool_step SET state='complete' WHERE operation_id=${id} AND step=${step}`,
    );
  }
  async event(userId: string, runId: string, event: ToolEvent) {
    if (
      event.output &&
      Buffer.byteLength(event.output) > TOOL_LIMITS.resultBytes
    )
      throw new AppError("tool_result_limit", 400);
    await this.db.transaction(async (tx) => {
      await lockByokResources(tx);
      const [run] = await tx.execute(
        sql`SELECT id FROM tool_run WHERE id=${runId} AND user_id=${userId} AND state='running'`,
      );
      if (!run) throw new AppError("tool_entry_denied", 409);
      const [prior] = await tx.execute(
        sql`SELECT id FROM tool_call WHERE run_id=${runId} AND id=${event.id}`,
      );
      if (event.state === "queued") {
        if (prior) throw new AppError("tool_replay_denied", 409);
        const [count] = await tx.execute<{ count: number }>(
          sql`SELECT count(*)::integer AS count FROM tool_call WHERE run_id=${runId}`,
        );
        if (count.count >= 4) throw new AppError("tool_call_limit", 409);
        await tx.execute(
          sql`INSERT INTO tool_call(run_id,id,name,state) VALUES(${runId},${event.id},${event.name},'queued')`,
        );
      } else {
        const rows = await tx.execute(
          sql`UPDATE tool_call SET state=${event.state},output=${event.output ?? null} WHERE run_id=${runId} AND id=${event.id} AND state IN ('queued','running') RETURNING id`,
        );
        if (!rows.length) throw new AppError("tool_replay_denied", 409);
      }
    });
  }
  async readRevision(
    userId: string,
    selected: SelectedRevision[],
    input: SelectedRevision & { offset: number; length: number },
  ) {
    if (
      !selected.some(
        (r) => r.artifactId === input.artifactId && r.version === input.version,
      )
    )
      throw new AppError("tool_revision_denied", 403);
    const [row] = await this.db.execute<{ title: string; content: string }>(
      sql`SELECT r.title,r.content FROM artifact_revision r JOIN artifact a ON a.id=r.artifact_id WHERE r.artifact_id=${input.artifactId} AND r.version=${input.version} AND r.user_id=${userId} AND a.user_id=${userId}`,
    );
    if (!row) throw new AppError("tool_revision_unavailable", 404);
    return {
      title: row.title,
      content: row.content.slice(input.offset, input.offset + input.length),
      offset: input.offset,
      untrusted: true,
    };
  }
  async finish(userId: string, id: string, state: string, answer = "") {
    await this.db.execute(
      sql`UPDATE tool_run SET state=${state},answer=${answer} WHERE id=${id} AND user_id=${userId}`,
    );
    await this.db.execute(
      sql`UPDATE tool_call SET state='failed' WHERE run_id=${id} AND state IN ('queued','running') AND EXISTS(SELECT 1 FROM tool_run r WHERE r.id=${id} AND r.user_id=${userId})`,
    );
  }
  async view(userId: string, id: string): Promise<ToolRunView> {
    const [run] = await this.db.execute<{
      id: string;
      state: string;
      answer: string;
      request: ToolRunRequest;
    }>(
      sql`SELECT id,state,answer,request FROM tool_run WHERE id=${id} AND user_id=${userId}`,
    );
    if (!run) throw new AppError("not_found", 404);
    const rows = await this.db.execute<
      ToolEvent & { search_operation_id?: string | null }
    >(
      sql`SELECT id,name,state,output,search_operation_id FROM tool_call WHERE run_id=${id}`,
    );
    const events: ToolEvent[] = rows.map(
      ({ search_operation_id: _op, ...event }) => event,
    );
    let search: SearchRunState | undefined;
    if (run.request.search) {
      const event =
        rows.find(
          (item) => item.name === "webSearch" && item.search_operation_id,
        ) ??
        rows.find(
          (item) => item.name === "webSearch" && item.state !== "denied",
        );
      if (!event) search = { status: "not_used", sources: [] };
      else if (event.state !== "completed" || !event.output)
        search = { status: "provider_error", sources: [] };
      else {
        try {
          const evidence = searchEvidenceSchema.parse(JSON.parse(event.output));
          search = {
            status: evidence.status,
            retrievedAt: evidence.retrievedAt,
            sources: evidence.sources,
          };
        } catch {
          search = { status: "provider_error", sources: [] };
        }
      }
    }
    const { request: _request, ...view } = run;
    return { ...view, events, ...(search ? { search } : {}) };
  }
  async remove(userId: string, id: string) {
    await this.db.transaction(async (tx) => {
      await lockByokResources(tx);
      const rows = await tx.execute(
        sql`DELETE FROM tool_run WHERE id=${id} AND user_id=${userId} RETURNING id`,
      );
      if (!rows.length) throw new AppError("tool_delete_denied", 409);
    });
  }
  /** Internal issuance only: no client endpoint can invent an action or turn a boolean into authority. */
  async issueApproval(userId: string, binding: ActionBinding, expiresAt: Date) {
    canonical(binding);
    if (
      !Number.isSafeInteger(binding.costMicrodollars) ||
      binding.costMicrodollars < 0 ||
      expiresAt.getTime() <= Date.now() ||
      expiresAt.getTime() > Date.now() + 300000
    )
      throw new AppError("invalid_tool_action", 400);
    const id = crypto.randomUUID();
    return this.db.transaction(async (tx) => {
      await lockByokResources(tx);
      const [count] = await tx.execute<{ count: number }>(
        sql`SELECT count(*)::integer AS count FROM tool_approval WHERE run_id=${binding.runId}`,
      );
      if (count.count >= TOOL_LIMITS.calls)
        throw new AppError("tool_approval_limit", 429);
      const rows = await tx.execute(
        sql`INSERT INTO tool_approval(id,user_id,run_id,binding,expires_at) SELECT ${id},${userId},id,${canonical(binding)}::jsonb,LEAST(${expiresAt.toISOString()}::timestamptz,created_at+interval '20 seconds') FROM tool_run WHERE id=${binding.runId} AND user_id=${userId} AND created_at>now()-interval '20 seconds' RETURNING id`,
      );
      if (!rows.length) throw new AppError("not_found", 404);
      return id;
    });
  }
  async decideApproval(
    userId: string,
    id: string,
    decision: "approve" | "deny" | "revoke",
  ) {
    const rows = await this.db.execute(
      sql`UPDATE tool_approval SET state=${decision === "approve" ? "approved" : decision === "deny" ? "denied" : "revoked"} WHERE id=${id} AND user_id=${userId} AND expires_at>now() AND (state='pending' OR (${decision}='revoke' AND state='approved')) RETURNING id`,
    );
    if (!rows.length) throw new AppError("tool_approval_denied", 409);
  }
  /** Consume before dispatch: a crash after this commit must never re-execute the action. */
  async consumeApproval(userId: string, id: string, binding: ActionBinding) {
    const rows = await this.db.execute(
      sql`UPDATE tool_approval SET state='consumed' WHERE id=${id} AND user_id=${userId} AND run_id=${binding.runId} AND binding=${canonical(binding)}::jsonb AND state='approved' AND expires_at>now() RETURNING id`,
    );
    if (!rows.length) throw new AppError("tool_approval_denied", 403);
  }
  async export(userId: string) {
    const runs = await this.db.execute(
      sql`SELECT * FROM tool_run WHERE user_id=${userId}`,
    );
    const calls = await this.db.execute(
      sql`SELECT c.* FROM tool_call c JOIN tool_run r ON r.id=c.run_id WHERE r.user_id=${userId}`,
    );
    const approvals = await this.db.execute(
      sql`SELECT * FROM tool_approval WHERE user_id=${userId}`,
    );
    return { runs: [...runs], calls: [...calls], approvals: [...approvals] };
  }
}
