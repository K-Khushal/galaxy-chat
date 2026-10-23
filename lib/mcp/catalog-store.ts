import "server-only";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { isInvitedLogin, parseInviteLogins } from "@/lib/auth/env";
import { resourceActor } from "@/lib/byok/config";
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
  consumeToolApprovalInTx,
  decideToolApprovalInTx,
  issueToolApprovalInTx,
} from "@/lib/tools/store";
import {
  type CatalogDefinition,
  type CatalogMetadata,
  exactMcpToolBindingSchema,
  MCP_CATALOG_LIMITS,
  parseCatalogImport,
  proposalRequestSchema,
} from "./catalog-contract";
import { parseProfilesJson, profileKey } from "./config";
import { parseMcpFeeSnapshot } from "./fee-config";
import { operationDigest } from "./operation-contract";
import { computeProfileDigest } from "./registry-contract";
import { ownMcpArguments, parseMcpArguments } from "./schema-policy";

type Tx = DatabaseTransaction;
type RuntimeProvider = () => unknown;
// A fixture transaction has a configuration source, never a boolean verification hook.
// Production has no issuer/configuration registration path and cannot verify proposals.
const fixtureContexts = new WeakMap<Tx, RuntimeProvider>();
function unavailable(): never {
  throw new AppError("mcp_catalog_authority_unavailable", 503);
}
function fixtureGate() {
  if (process.env.NODE_ENV !== "test") unavailable();
}
function equal(a: unknown, b: unknown) {
  if (canonicalJson(a) !== canonicalJson(b))
    throw new AppError("mcp_action_changed", 409);
}
function runtimeFee(tx: Tx, now: Date) {
  fixtureGate();
  const provider = fixtureContexts.get(tx);
  if (!provider) unavailable();
  const parsed = z.object({ fee: z.unknown() }).strict().safeParse(provider());
  if (!parsed.success) unavailable();
  const fee = parseMcpFeeSnapshot(parsed.data.fee, now);
  if (fee.basis !== "synthetic-offline") unavailable();
  return fee;
}
function liveProfile(
  row: {
    github_login: string | null;
    state: string;
    revision: string;
    profile_id: string;
    profile_revision: string;
    purpose: string;
    profile_digest: string;
  },
  connection: CatalogDefinition["connection"],
  profile: CatalogDefinition["profile"],
  now: Date,
) {
  const env = process.env;
  if (
    !isInvitedLogin(
      row.github_login,
      parseInviteLogins(env.GITHUB_INVITE_LOGINS),
    )
  )
    throw new AppError("mcp_invite_required", 403);
  if (
    row.state !== "configured" ||
    row.revision !== connection.revision ||
    row.profile_id !== profile.id ||
    row.profile_revision !== profile.revision ||
    row.purpose !== "mcp.call" ||
    row.profile_digest !== profile.digest
  )
    throw new AppError("mcp_connection_changed", 409);
  const configured = parseProfilesJson(env.MCP_CLIENT_PROFILES_JSON).get(
    profileKey(profile.id, profile.revision, "mcp.call"),
  );
  if (
    env.MCP_CLIENT_ENABLED !== "1" ||
    !configured ||
    computeProfileDigest(configured) !== profile.digest ||
    new Date(configured.expiresAt) <= now
  )
    throw new AppError("mcp_profile_changed", 409);
}
export function mcpToolRunRequestDigest(raw: unknown): string {
  return toolRunIdentity(raw, new Date());
}
function toolRunIdentity(raw: unknown, now: Date): string {
  const result = toolRunRequest.safeParse(raw);
  if (!result.success) throw new AppError("mcp_tool_run_unavailable", 409);
  const request = result.data;
  const model = resolveToolModel(process.env, request.model, request.funding);
  if (new Date(model.expiresAt) <= now)
    throw new AppError("mcp_tool_run_unavailable", 409);
  return operationDigest({ request, model });
}
type VerificationPhase =
  | "pending"
  | "decision"
  | "approved"
  | "consumed"
  | "terminal-decision";
/** Caller holds BYOK and, if needed, funding first. Reads persisted exact authority in this TX.
 * Production verification remains unavailable until real run/fee/catalog issuance exists. */
export async function verifyMcpActionInTx(
  tx: Tx,
  userId: string,
  approvalId: string,
  raw: ActionBinding,
  phase: VerificationPhase = "approved",
) {
  fixtureGate();
  if (!fixtureContexts.has(tx)) unavailable();
  const parsed = exactMcpToolBindingSchema.safeParse(raw);
  if (!parsed.success) throw new AppError("invalid_mcp_action", 400);
  const binding = deepFreeze({
      ...parsed.data,
      arguments: ownMcpArguments(parsed.data.arguments),
    }),
    mcp = binding.mcp;
  const [row] = await tx.execute<{
    now: Date;
    github_login: string | null;
    state: string;
    revision: string;
    profile_id: string;
    profile_revision: string;
    purpose: string;
    profile_digest: string;
    head_state: string;
    head_catalog: string;
    catalog_digest: string;
    catalog_definition: CatalogDefinition;
    action_digest: string;
    schema_digest: string;
    output_schema_digest: string | null;
    action_definition: CatalogDefinition["tools"][number];
    proposal_digest: string;
    proposal_binding: unknown;
    approval_digest: string;
    approval_binding: unknown;
    approval_state: string;
    expires_at: Date;
    run_state: string;
    run_created_at: Date;
    run_request: unknown;
    call_state: string;
    call_name: string;
    actor_key: string;
    plan_revision: string;
    plan_digest: string;
    capacity_digest: string;
    stopped: boolean;
  }>(sql`SELECT clock_timestamp() AS now,u.github_login,c.state,c.revision,c.profile_id,c.profile_revision,c.purpose,c.profile_digest,
     h.state AS head_state,h.catalog_id AS head_catalog,v.digest AS catalog_digest,v.definition AS catalog_definition,
     a.digest AS action_digest,a.schema_digest,a.output_schema_digest,a.definition AS action_definition,
     p.digest AS proposal_digest,p.binding AS proposal_binding,p.approval_digest,t.binding AS approval_binding,t.state AS approval_state,t.expires_at,
     r.state AS run_state,r.created_at AS run_created_at,r.request AS run_request,k.state AS call_state,k.name AS call_name,o.actor_key,
     b.revision AS plan_revision,b.digest AS plan_digest,b.capacity_digest,f.stopped
   FROM mcp_action_proposal p JOIN "user" u ON u.id=p.user_id
   JOIN mcp_catalog_revision v ON v.id=p.catalog_id AND v.user_id=u.id
   JOIN mcp_catalog_head h ON h.connection_id=v.connection_id AND h.user_id=u.id
   JOIN mcp_connection c ON c.id=v.connection_id AND c.user_id=u.id
   JOIN mcp_catalog_action a ON a.catalog_id=v.id AND a.name=p.action_name
   JOIN tool_approval t ON t.id=p.approval_id AND t.user_id=u.id AND t.run_id=p.run_id
   JOIN tool_run r ON r.id=p.run_id AND r.user_id=u.id
   JOIN tool_call k ON k.run_id=r.id AND k.id=p.tool_call_id
   JOIN byok_operation o ON o.id=r.id AND o.state='entered' AND o.kind='chat' AND o.resource_units=3 AND o.provider=r.request->>'funding'
   JOIN provider_credential q ON q.user_id=u.id AND q.provider=o.provider AND q.revision=o.credential_revision AND q.test_state<>'invalid'
   JOIN platform_budget_plan b ON b.month=${mcp.plan.month}
   JOIN funding_control f ON f.id='platform'
   WHERE p.id=${mcp.proposal.id} AND p.user_id=${userId} AND p.approval_id=${approvalId}`);
  if (!row) throw new AppError("not_found", 404);
  const now = new Date(row.now),
    fee = runtimeFee(tx, now);
  liveProfile(row, mcp.connection, mcp.profile, now);
  const config = resolvePlatformBudgetConfig(process.env, now);
  if (!config || row.stopped || process.env.FUNDED_KILL_SWITCH !== "0")
    throw new AppError("mcp_action_unavailable", 503);
  equal(mcp.plan, {
    month: config.plan.month,
    revision: row.plan_revision,
    digest: row.plan_digest,
    capacityDigest: row.capacity_digest,
  });
  if (
    config.digest !== row.plan_digest ||
    config.capacityDigest !== row.capacity_digest ||
    fee.capacity.sharedCapacityDigest !== row.capacity_digest ||
    operationDigest(fee) !== mcp.feeDigest ||
    binding.costMicrodollars !== fee.upperBoundMicrodollars
  )
    throw new AppError("mcp_price_changed", 409);
  if (
    row.head_state !== "active" ||
    row.head_catalog !== mcp.catalog.id ||
    row.catalog_digest !== mcp.catalog.digest ||
    row.catalog_definition.revision !== mcp.catalog.revision
  )
    throw new AppError("mcp_catalog_changed", 409);
  equal(row.catalog_definition.connection, mcp.connection);
  equal(row.catalog_definition.profile, mcp.profile);
  if (
    operationDigest(row.catalog_definition) !== mcp.catalog.digest ||
    row.action_digest !== mcp.action.digest ||
    row.action_definition.name !== mcp.action.name ||
    operationDigest(row.action_definition) !== mcp.action.digest ||
    row.schema_digest !== mcp.schemaDigest ||
    row.output_schema_digest !== mcp.outputSchemaDigest
  )
    throw new AppError("mcp_action_changed", 409);
  equal(
    parseMcpArguments(row.action_definition.inputSchema, binding.arguments),
    binding.arguments,
  );
  if (
    operationDigest(binding.arguments) !== mcp.argumentsDigest ||
    operationDigest(binding.target) !== mcp.targetDigest ||
    binding.tool !== `mcp:${mcp.action.name}` ||
    binding.toolRevision !== mcp.action.digest ||
    binding.connectionRevision !== mcp.connection.revision ||
    row.proposal_digest !== mcp.proposal.digest
  )
    throw new AppError("mcp_action_changed", 409);
  equal(row.proposal_binding, binding);
  equal(row.approval_binding, binding);
  equal(
    row.approval_digest,
    operationDigest({
      id: approvalId,
      binding,
      expiresAt: new Date(row.expires_at).toISOString(),
    }),
  );
  if (
    row.run_state !== "running" ||
    !["queued", "running"].includes(row.call_state) ||
    row.call_name !== binding.tool ||
    row.actor_key !== resourceActor(userId, process.env) ||
    new Date(row.run_created_at).getTime() + TOOL_LIMITS.timeoutMs <=
      now.getTime() ||
    new Date(row.expires_at) <= now ||
    new Date(row.expires_at).getTime() >
      new Date(row.run_created_at).getTime() + TOOL_LIMITS.timeoutMs ||
    toolRunIdentity(row.run_request, now) !== mcp.requestDigest
  )
    throw new AppError("mcp_tool_run_unavailable", 409);
  const states =
    phase === "decision"
      ? ["pending", "approved"]
      : phase === "terminal-decision"
        ? ["denied", "revoked"]
        : [phase];
  if (!states.includes(row.approval_state))
    throw new AppError("tool_approval_denied", 403);
  fixtureGate();
  return deepFreeze({
    kind: "persisted-mcp-action" as const,
    ownerId: userId,
    proposalId: mcp.proposal.id,
    approvalId,
    approvalDigest: row.approval_digest,
    bindingDigest: operationDigest(binding),
  });
}

type HeadRow = {
  id: string;
  revision: string;
  digest: string;
  definition: CatalogDefinition;
  created_at: Date;
  head_revision: string;
  head_state: string;
  catalog_id: string;
};
class McpCatalogStore {
  constructor(
    private readonly db: Database,
    private readonly runtime?: RuntimeProvider,
  ) {}
  private authority() {
    fixtureGate();
    if (!this.runtime) unavailable();
  }
  private transaction<T>(run: (tx: Tx) => Promise<T>) {
    return this.db.transaction(
      async (tx) => {
        await lockByokResources(tx);
        if (this.runtime) fixtureContexts.set(tx, this.runtime);
        try {
          return await run(tx);
        } finally {
          fixtureContexts.delete(tx);
        }
      },
      { isolationLevel: "read committed" },
    );
  }
  private async connection(
    tx: Tx,
    userId: string,
    definition: CatalogDefinition,
    head?: { id: string; revision: string },
  ) {
    const [row] = await tx.execute<{
      now: Date;
      github_login: string | null;
      state: string;
      revision: string;
      profile_id: string;
      profile_revision: string;
      purpose: string;
      profile_digest: string;
      catalog_id: string | null;
      head_state: string | null;
      head_revision: string | null;
    }>(
      sql`SELECT clock_timestamp() AS now,u.github_login,c.state,c.revision,c.profile_id,c.profile_revision,c.purpose,c.profile_digest,h.catalog_id,h.state AS head_state,h.revision AS head_revision FROM "user" u JOIN mcp_connection c ON c.user_id=u.id LEFT JOIN mcp_catalog_head h ON h.connection_id=c.id WHERE u.id=${userId} AND c.id=${definition.connection.id}`,
    );
    if (!row) throw new AppError("not_found", 404);
    this.authority();
    liveProfile(
      row,
      definition.connection,
      definition.profile,
      new Date(row.now),
    );
    if (
      head &&
      (row.head_state !== "active" ||
        row.catalog_id !== head.id ||
        row.head_revision !== head.revision)
    )
      throw new AppError("mcp_catalog_changed", 409);
    return new Date(row.now);
  }
  private async count(tx: Tx, userId: string, kind: "revision" | "proposal") {
    const actor = resourceActor(userId, process.env);
    const [row] = await tx.execute<{ owner: number; total: number }>(
      sql`SELECT count(*) FILTER(WHERE actor_key=${actor})::integer AS owner,count(*)::integer AS total FROM mcp_catalog_admission WHERE kind=${kind}`,
    );
    const ownerMax =
        kind === "revision"
          ? MCP_CATALOG_LIMITS.ownerRevisions
          : MCP_CATALOG_LIMITS.ownerProposals,
      globalMax =
        kind === "revision"
          ? MCP_CATALOG_LIMITS.globalRevisions
          : MCP_CATALOG_LIMITS.globalProposals;
    if (row.owner >= ownerMax || row.total >= globalMax)
      throw new AppError("mcp_catalog_limit", 429);
    await tx.execute(
      sql`INSERT INTO mcp_catalog_admission(id,actor_key,kind) VALUES (${randomUUID()},${actor},${kind})`,
    );
  }
  async importUntrusted(
    userId: string,
    raw: unknown,
  ): Promise<CatalogMetadata> {
    this.authority();
    const input = parseCatalogImport(raw),
      definition = input.definition;
    return this.transaction(async (tx) => {
      await this.connection(tx, userId, definition);
      const [existing] = await tx.execute<HeadRow & { user_id: string }>(
        sql`SELECT v.*,h.catalog_id,h.revision AS head_revision,h.state AS head_state FROM mcp_catalog_revision v LEFT JOIN mcp_catalog_head h ON h.connection_id=v.connection_id WHERE v.id=${definition.id} OR (v.connection_id=${definition.connection.id} AND v.revision=${definition.revision})`,
      );
      if (existing) {
        if (existing.user_id !== userId) throw new AppError("not_found", 404);
        if (
          existing.id !== definition.id ||
          existing.digest !== input.digest ||
          existing.catalog_id !== existing.id ||
          existing.head_state !== "active"
        )
          throw new AppError("mcp_catalog_conflict", 409);
        await this.connection(tx, userId, definition, {
          id: existing.id,
          revision: existing.head_revision,
        });
        return {
          id: existing.id,
          revision: existing.revision,
          state: existing.head_state,
          headRevision: existing.head_revision,
          tools: existing.definition.tools.length,
          createdAt: new Date(existing.created_at).toISOString(),
        };
      }
      const [head] = await tx.execute<{ revision: string; state: string }>(
        sql`SELECT revision,state FROM mcp_catalog_head WHERE connection_id=${definition.connection.id} AND user_id=${userId}`,
      );
      if (
        (head?.revision ?? null) !== input.expectedHeadRevision ||
        (head && head.state !== "active")
      )
        throw new AppError("mcp_catalog_conflict", 409);
      await this.count(tx, userId, "revision");
      const [created] = await tx.execute<{ created_at: Date }>(
        sql`INSERT INTO mcp_catalog_revision(id,user_id,connection_id,revision,connection_revision,profile,digest,definition) VALUES (${definition.id},${userId},${definition.connection.id},${definition.revision},${definition.connection.revision},${JSON.stringify(definition.profile)}::jsonb,${input.digest},${JSON.stringify(definition)}::jsonb) RETURNING created_at`,
      );
      for (const action of definition.tools)
        await tx.execute(
          sql`INSERT INTO mcp_catalog_action(catalog_id,name,digest,schema_digest,output_schema_digest,definition) VALUES (${definition.id},${action.name},${operationDigest(action)},${operationDigest(action.inputSchema)},${action.outputSchema ? operationDigest(action.outputSchema) : null},${JSON.stringify(action)}::jsonb)`,
        );
      const revision = randomUUID();
      await tx.execute(
        sql`INSERT INTO mcp_catalog_head(connection_id,user_id,catalog_id,revision,state) VALUES (${definition.connection.id},${userId},${definition.id},${revision},'active') ON CONFLICT(connection_id) DO UPDATE SET catalog_id=excluded.catalog_id,revision=excluded.revision`,
      );
      await tx.execute(
        sql`UPDATE tool_approval SET state='revoked' WHERE state IN ('pending','approved') AND id IN (SELECT p.approval_id FROM mcp_action_proposal p JOIN mcp_catalog_revision v ON v.id=p.catalog_id WHERE v.connection_id=${definition.connection.id})`,
      );
      await this.connection(tx, userId, definition, {
        id: definition.id,
        revision,
      });
      return {
        id: definition.id,
        revision: definition.revision,
        state: "active",
        headRevision: revision,
        tools: definition.tools.length,
        createdAt: new Date(created.created_at).toISOString(),
      };
    });
  }
  async propose(userId: string, raw: unknown) {
    this.authority();
    const parsed = proposalRequestSchema.safeParse(raw);
    if (!parsed.success) throw new AppError("invalid_mcp_proposal", 400);
    const input = deepFreeze({
      ...parsed.data,
      arguments: ownMcpArguments(parsed.data.arguments),
    });
    return this.transaction(async (tx) => {
      const [prior] = await tx.execute<{
        user_id: string;
        binding: ActionBinding;
        approval_id: string;
        approval_digest: string;
      }>(
        sql`SELECT user_id,binding,approval_id,approval_digest FROM mcp_action_proposal WHERE id=${input.id}`,
      );
      if (prior) {
        if (prior.user_id !== userId) throw new AppError("not_found", 404);
        const persisted = exactMcpToolBindingSchema.safeParse(prior.binding);
        if (!persisted.success) throw new AppError("mcp_action_changed", 409);
        const binding = deepFreeze({
          ...persisted.data,
          arguments: ownMcpArguments(persisted.data.arguments),
        });
        equal(input, {
          id: binding.mcp.proposal.id,
          catalog: binding.mcp.catalog,
          action: binding.mcp.action.name,
          runId: binding.runId,
          toolCallId: binding.toolCallId,
          requestDigest: binding.mcp.requestDigest,
          arguments: binding.arguments,
          target: binding.target,
          feeDigest: binding.mcp.feeDigest,
          plan: binding.mcp.plan,
        });
        await verifyMcpActionInTx(
          tx,
          userId,
          prior.approval_id,
          binding,
          "decision",
        );
        return {
          id: input.id,
          revision: 1,
          approvalId: prior.approval_id,
          approvalDigest: prior.approval_digest,
          binding,
        };
      }
      const [row] = await tx.execute<{
        now: Date;
        definition: CatalogDefinition;
        action: CatalogDefinition["tools"][number];
        digest: string;
        schema_digest: string;
        output_schema_digest: string | null;
      }>(
        sql`SELECT clock_timestamp() AS now,v.definition,a.definition AS action,a.digest,a.schema_digest,a.output_schema_digest FROM mcp_catalog_revision v JOIN mcp_catalog_action a ON a.catalog_id=v.id WHERE v.id=${input.catalog.id} AND v.user_id=${userId} AND a.name=${input.action}`,
      );
      if (!row) throw new AppError("not_found", 404);
      equal(input.catalog, {
        id: row.definition.id,
        revision: row.definition.revision,
        digest: operationDigest(row.definition),
      });
      const args = parseMcpArguments(row.action.inputSchema, input.arguments),
        fee = runtimeFee(tx, new Date(row.now));
      if (operationDigest(fee) !== input.feeDigest)
        throw new AppError("mcp_price_changed", 409);
      const proposalDigest = operationDigest({
        ...input,
        arguments: args,
        connection: row.definition.connection,
        profile: row.definition.profile,
        actionDigest: row.digest,
        schemaDigest: row.schema_digest,
        outputSchemaDigest: row.output_schema_digest,
      });
      const binding = deepFreeze({
        runId: input.runId,
        toolCallId: input.toolCallId,
        tool: `mcp:${input.action}`,
        toolRevision: row.digest,
        connectionRevision: row.definition.connection.revision,
        arguments: args,
        target: input.target,
        costMicrodollars: fee.upperBoundMicrodollars,
        mcp: {
          proposal: {
            id: input.id,
            revision: 1 as const,
            digest: proposalDigest,
          },
          connection: row.definition.connection,
          profile: row.definition.profile,
          catalog: input.catalog,
          action: { name: input.action, digest: row.digest },
          schemaDigest: row.schema_digest,
          outputSchemaDigest: row.output_schema_digest,
          requestDigest: input.requestDigest,
          argumentsDigest: operationDigest(args),
          targetDigest: operationDigest(input.target),
          feeDigest: input.feeDigest,
          plan: input.plan,
        },
      });
      canonical(binding);
      await this.count(tx, userId, "proposal");
      const approvalId = await issueToolApprovalInTx(
        tx,
        userId,
        binding,
        new Date(new Date(row.now).getTime() + TOOL_LIMITS.timeoutMs),
      );
      const [approval] = await tx.execute<{ expires_at: Date }>(
        sql`SELECT expires_at FROM tool_approval WHERE id=${approvalId} AND user_id=${userId}`,
      );
      const approvalDigest = operationDigest({
        id: approvalId,
        binding,
        expiresAt: new Date(approval.expires_at).toISOString(),
      });
      await tx.execute(
        sql`INSERT INTO mcp_action_proposal(id,revision,user_id,catalog_id,action_name,run_id,tool_call_id,binding,digest,approval_id,approval_digest) VALUES (${input.id},1,${userId},${input.catalog.id},${input.action},${input.runId},${input.toolCallId},${canonical(binding)}::jsonb,${proposalDigest},${approvalId},${approvalDigest})`,
      );
      await verifyMcpActionInTx(tx, userId, approvalId, binding, "pending");
      return { id: input.id, revision: 1, approvalId, approvalDigest, binding };
    });
  }
  private async proposal(tx: Tx, userId: string, id: string) {
    const [row] = await tx.execute<{
      binding: ActionBinding;
      approval_id: string;
    }>(
      sql`SELECT binding,approval_id FROM mcp_action_proposal WHERE id=${id} AND user_id=${userId}`,
    );
    if (!row) throw new AppError("not_found", 404);
    return row;
  }
  async decide(
    userId: string,
    id: string,
    decision: "approve" | "deny" | "revoke",
  ) {
    this.authority();
    if (!["approve", "deny", "revoke"].includes(decision))
      throw new AppError("invalid_mcp_decision", 400);
    return this.transaction(async (tx) => {
      const row = await this.proposal(tx, userId, id);
      await decideToolApprovalInTx(tx, userId, row.approval_id, decision);
    });
  }
  async consume(userId: string, id: string, input: ActionBinding) {
    this.authority();
    const parsed = exactMcpToolBindingSchema.safeParse(input);
    if (!parsed.success) throw new AppError("invalid_mcp_action", 400);
    const binding = deepFreeze({
      ...parsed.data,
      arguments: ownMcpArguments(parsed.data.arguments),
    });
    return this.transaction(async (tx) => {
      const row = await this.proposal(tx, userId, id);
      equal(row.binding, binding);
      await consumeToolApprovalInTx(tx, userId, row.approval_id, binding);
    });
  }
  async revoke(
    userId: string,
    connectionId: string,
    expectedHeadRevision: string,
  ) {
    if (
      !z.uuid().safeParse(connectionId).success ||
      !z.uuid().safeParse(expectedHeadRevision).success
    )
      throw new AppError("invalid_mcp_catalog", 400);
    return this.transaction(async (tx) => {
      const [head] = await tx.execute<{ revision: string; state: string }>(
        sql`SELECT revision,state FROM mcp_catalog_head WHERE connection_id=${connectionId} AND user_id=${userId}`,
      );
      if (!head) throw new AppError("not_found", 404);
      if (head.revision !== expectedHeadRevision)
        throw new AppError("mcp_catalog_conflict", 409);
      if (head.state === "revoked") return head.revision;
      const revision = randomUUID();
      await tx.execute(
        sql`UPDATE mcp_catalog_head SET state='revoked',revision=${revision} WHERE connection_id=${connectionId} AND user_id=${userId} AND revision=${expectedHeadRevision}`,
      );
      await tx.execute(
        sql`UPDATE tool_approval SET state='revoked' WHERE state IN ('pending','approved') AND id IN (SELECT p.approval_id FROM mcp_action_proposal p JOIN mcp_catalog_revision v ON v.id=p.catalog_id WHERE v.connection_id=${connectionId} AND p.user_id=${userId})`,
      );
      return revision;
    });
  }
  async export(userId: string) {
    const catalogs = await this.db.execute<{
      id: string;
      revision: string;
      state: string;
      createdAt: Date;
    }>(
      sql`SELECT v.id,v.revision,CASE WHEN h.catalog_id=v.id THEN h.state ELSE 'superseded' END AS state,v.created_at AS "createdAt" FROM mcp_catalog_revision v LEFT JOIN mcp_catalog_head h ON h.connection_id=v.connection_id WHERE v.user_id=${userId} ORDER BY v.created_at LIMIT 20`,
    );
    const proposals = await this.db.execute<{
      id: string;
      revision: number;
      state: string;
      createdAt: Date;
    }>(
      sql`SELECT p.id,p.revision,a.state,p.created_at AS "createdAt" FROM mcp_action_proposal p JOIN tool_approval a ON a.id=p.approval_id WHERE p.user_id=${userId} ORDER BY p.created_at LIMIT 100`,
    );
    return { catalogs: [...catalogs], proposals: [...proposals] };
  }
}
export function createMcpCatalogStore(options: { db?: Database } = {}) {
  const store = new McpCatalogStore(options.db ?? requireDb());
  return {
    importUntrusted: store.importUntrusted.bind(store),
    propose: store.propose.bind(store),
    decide: store.decide.bind(store),
    consume: store.consume.bind(store),
    revoke: store.revoke.bind(store),
    export: store.export.bind(store),
  };
}
export function createFixtureMcpCatalogStore(options: {
  db: Database;
  runtime: RuntimeProvider;
}) {
  fixtureGate();
  return new McpCatalogStore(options.db, options.runtime);
}
