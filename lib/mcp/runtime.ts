import "server-only";
import { sql } from "drizzle-orm";
import { lockByokResources } from "@/lib/byok/store";
import {
  type Database,
  type DatabaseTransaction,
  requireDb,
} from "@/lib/db/client";
import { AppError } from "@/lib/errors";
import { canonicalJson } from "@/lib/funding/config";
import { assertActivePlanInTx, lockFunding } from "@/lib/funding/store";
import { dispatchRuntimeFrame } from "./broker-client";
import { runtimeBodyHash, verifyBrokerEvidence } from "./broker-evidence";
import { resolveMcpClientConfig } from "./config";
import type { McpMtlsFetcher } from "./contract";
import {
  createMcpExecutionStore,
  executionStorageError,
  runtimeFrameInTx,
  verifyRuntimeActionInTx,
} from "./execution-store";
import { operationDigest } from "./operation-contract";
import { createProductionMcpOperationStore } from "./operation-store";
import { FRAME_KINDS, runtimeWireDigest } from "./runtime-config";
import { parseRuntimeResult } from "./runtime-protocol";
/** Internal authenticated server service. No route, automatic discovery, SDK client, OAuth or retries. */
export function createMcpRuntime(
  options: { db?: Database; binding?: McpMtlsFetcher } = {},
) {
  const db = options.db ?? requireDb(),
    executions = createMcpExecutionStore({ db });
  const transaction = <T>(run: (tx: DatabaseTransaction) => Promise<T>) =>
    db
      .transaction(
        async (tx) => {
          await lockFunding(tx);
          await lockByokResources(tx);
          return run(tx);
        },
        { isolationLevel: "read committed" },
      )
      .catch(executionStorageError);
  return {
    ...executions,
    bootstrapMcpPeriod: (plan: unknown) =>
      createProductionMcpOperationStore(db, "initialize")
        .bootstrapMcpPeriod(plan)
        .catch(executionStorageError),
    async cancelReserved(
      userId: string,
      operationId: string,
      revision: number,
    ) {
      return createProductionMcpOperationStore(db, "initialize")
        .cancelReserved(userId, operationId, revision)
        .catch(executionStorageError);
    },
    async retainUnknown(
      userId: string,
      frameId: string,
      expectedRevision: number,
    ) {
      return transaction(async (tx) => {
        const frame = await runtimeFrameInTx(tx, userId, frameId);
        if (frame.state !== "entered" || frame.revision !== expectedRevision)
          throw new AppError("mcp_execution_changed", 409);
        const changed = await tx.execute(
          sql`UPDATE mcp_operation SET state='held',revision=revision+1 WHERE id=${frame.operation_id} AND state='entered' RETURNING id`,
        );
        if (!changed.length) throw new AppError("mcp_execution_changed", 409);
        await tx.execute(
          sql`UPDATE funding_control SET stopped=true WHERE id='platform'`,
        );
        await tx.execute(
          sql`INSERT INTO mcp_operation_audit(id,operation_id,event,revision) SELECT ${crypto.randomUUID()},id,'held',revision FROM mcp_operation WHERE id=${frame.operation_id}`,
        );
        await tx.execute(
          sql`UPDATE mcp_runtime_frame SET state='held',revision=revision+1 WHERE id=${frame.id} AND state='entered'`,
        );
        return { frameId, state: "held" as const };
      });
    },
    async executeRuntime(
      userId: string,
      executionId: string,
      signal?: AbortSignal,
    ) {
      let result: unknown = null;
      for (const kind of FRAME_KINDS) {
        const entered = await transaction(async (tx) => {
          const [current] = await tx.execute<{ id: string; state: string }>(
            sql`SELECT id,state FROM mcp_runtime_frame WHERE execution_id=${executionId} AND user_id=${userId} AND kind=${kind}`,
          );
          if (!current) throw new AppError("not_found", 404);
          if (current.state === "completed") return null;
          if (current.state !== "prepared")
            throw new AppError("mcp_execution_already_entered", 409);
          if (signal?.aborted) throw new AppError("mcp_cancelled", 499);
          const frame = await runtimeFrameInTx(tx, userId, current.id);
          const [prior] = await tx.execute(
            sql`SELECT id FROM mcp_runtime_frame WHERE execution_id=${executionId} AND ordinal<${frame.ordinal} AND state<>'completed'`,
          );
          if (prior) throw new AppError("mcp_execution_sequence", 409);
          const verified = await verifyRuntimeActionInTx(
            tx,
            userId,
            frame.approval_id,
            frame.binding,
          );
          const client = resolveMcpClientConfig({ binding: options.binding });
          if (
            !client ||
            client.endpoint !== verified.context.config.manifest.brokerEndpoint
          )
            throw new AppError("mcp_runtime_unconfigured", 503);
          const wireDigest = runtimeWireDigest();
          const store = createProductionMcpOperationStore(db, kind);
          const reservation = await store.reserveMcpOperationInTx(
            tx,
            userId,
            frame.intent,
          );
          await store.enterMcpExecutionInTx(
            tx,
            userId,
            reservation.id,
            reservation.revision,
          );
          const final = await verifyRuntimeActionInTx(
            tx,
            userId,
            frame.approval_id,
            frame.binding,
            "consumed",
          );
          if (runtimeWireDigest() !== wireDigest)
            throw new AppError("mcp_runtime_unconfigured", 503);
          return { frame, config: final.context.config, client, wireDigest };
        });
        if (!entered) continue;
        try {
          const wire = await dispatchRuntimeFrame(
            entered.client,
            entered.frame,
            entered.config,
            signal,
            entered.wireDigest,
          );
          result = parseRuntimeResult(
            kind,
            wire.body,
            wire.status,
            entered.frame.body,
            entered.config.manifest.tool.outputSchema,
          );
          await transaction(async (tx) => {
            const frame = await runtimeFrameInTx(tx, userId, entered.frame.id);
            if (frame.state !== "entered")
              throw new AppError("mcp_execution_changed", 409);
            const verified = await verifyRuntimeActionInTx(
              tx,
              userId,
              frame.approval_id,
              frame.binding,
              "consumed",
            );
            const e = wire.signed.evidence;
            const signed = verifyBrokerEvidence(
              wire.signed,
              {
                operationId: frame.operation_id,
                frameId: frame.id,
                requestId: wire.requestId,
                manifestDigest: verified.context.config.digest,
                profileDigest: operationDigest(
                  verified.context.config.manifest.profiles[
                    kind === "call" ? "call" : "initialize"
                  ],
                ),
                bodyHash: runtimeBodyHash(
                  Buffer.from(canonicalJson(frame.body)),
                ),
                purpose: frame.intent.profile.purpose,
                status: wire.status,
                responseHash: runtimeBodyHash(wire.body),
                keyVersion: verified.context.config.manifest.evidenceKeyVersion,
              },
              verified.context.config.manifest.evidencePublicKey,
              verified.context.now.getTime(),
            );
            const digest = operationDigest(signed);
            await tx.execute(
              sql`INSERT INTO mcp_runtime_evidence(operation_id,digest,evidence) VALUES(${frame.operation_id},${digest},${canonicalJson(signed)}::jsonb)`,
            );
            const changed = await tx.execute(
              sql`UPDATE mcp_operation SET state='completed_unreconciled',revision=revision+1 WHERE id=${frame.operation_id} AND state='entered' AND binding_digest=${operationDigest(frame.intent)} RETURNING id`,
            );
            if (!changed.length)
              throw new AppError("mcp_execution_changed", 409);
            await tx.execute(
              sql`INSERT INTO mcp_operation_audit(id,operation_id,event,revision) SELECT ${crypto.randomUUID()},id,'completed_unreconciled',revision FROM mcp_operation WHERE id=${frame.operation_id}`,
            );
            await tx.execute(
              sql`UPDATE tool_call SET state='completed' WHERE run_id=${frame.binding.runId} AND id=${frame.tool_call_id}`,
            );
            await tx.execute(
              sql`UPDATE mcp_runtime_frame SET state='completed',revision=revision+1 WHERE id=${frame.id} AND state='entered'`,
            );
            await assertActivePlanInTx(
              tx,
              frame.intent.plan,
              () => process.env,
            );
            // Terminal completion may occur after the frame deadline; late completion is conservatively held.
            await verifyRuntimeActionInTx(
              tx,
              userId,
              frame.approval_id,
              frame.binding,
              "consumed",
            );
            if (new Date(e.expiresAt).getTime() <= Date.now())
              throw new AppError("mcp_broker_evidence_rejected", 502);
          });
        } catch {
          // Cleanup never depends on new admissions, current configuration, credentials or invitation.
          await transaction(async (tx) => {
            const changed = await tx.execute(
              sql`UPDATE mcp_operation SET state='held',revision=revision+1 WHERE id=${entered.frame.operation_id} AND state='entered' RETURNING id`,
            );
            if (changed.length) {
              await tx.execute(
                sql`UPDATE funding_control SET stopped=true WHERE id='platform'`,
              );
              await tx.execute(
                sql`INSERT INTO mcp_operation_audit(id,operation_id,event,revision) SELECT ${crypto.randomUUID()},id,'held',revision FROM mcp_operation WHERE id=${entered.frame.operation_id}`,
              );
            }
            await tx.execute(
              sql`UPDATE mcp_runtime_frame SET state='held',revision=revision+1 WHERE id=${entered.frame.id} AND state='entered'`,
            );
          });
          throw new AppError("mcp_runtime_outcome_unknown", 502);
        }
      }
      return { executionId, state: "completed_unreconciled" as const, result };
    },
  };
}
