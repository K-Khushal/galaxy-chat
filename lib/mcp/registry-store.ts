import "server-only";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { lockByokResources } from "@/lib/byok/store";
import { requireDb } from "@/lib/db/client";
import { AppError } from "@/lib/errors";
import { type McpClientConfig, resolveMcpClientConfig } from "./config";
import {
  type CreateConnectionInput,
  computeProfileDigest,
  MCP_REGISTRY_LIMITS,
  type McpConnectionExportView,
  type McpConnectionRow,
  type McpConnectionView,
  mcpConnectionExportView,
  mcpConnectionView,
  validateLabel,
  validateRegistryPurpose,
} from "./registry-contract";

type Db = ReturnType<typeof requireDb>;
export type McpConfigProvider = () => McpClientConfig | undefined;

export class McpRegistryStore {
  constructor(
    private readonly db: Db = requireDb(),
    private readonly configProvider: McpConfigProvider = resolveMcpClientConfig,
  ) {}

  async list(userId: string): Promise<McpConnectionView[]> {
    const rows = await this.db.execute<McpConnectionRow>(
      sql`SELECT * FROM mcp_connection WHERE user_id = ${userId} ORDER BY created_at ASC, id ASC LIMIT ${MCP_REGISTRY_LIMITS.maxConnectionsPerOwner}`,
    );
    return rows.map(mcpConnectionView);
  }

  async get(userId: string, connectionId: string): Promise<McpConnectionView> {
    const rows = await this.db.execute<McpConnectionRow>(
      sql`SELECT * FROM mcp_connection WHERE id = ${connectionId} AND user_id = ${userId} LIMIT 1`,
    );
    if (!rows[0]) {
      throw new AppError("not_found", 404);
    }
    return mcpConnectionView(rows[0]);
  }

  async create(
    userId: string,
    input: CreateConnectionInput,
  ): Promise<McpConnectionView> {
    const label = validateLabel(input.label);
    const purpose = validateRegistryPurpose(input.purpose);
    if (typeof input.profileId !== "string" || !input.profileId) {
      throw new AppError("invalid_profile_id", 400);
    }
    if (typeof input.profileRevision !== "string" || !input.profileRevision) {
      throw new AppError("invalid_profile_revision", 400);
    }

    return this.db.transaction(
      async (tx) => {
        await lockByokResources(tx);

        const [userRow] = await tx.execute<{ id: string }>(
          sql`SELECT id FROM "user" WHERE id = ${userId} LIMIT 1`,
        );
        if (!userRow) {
          throw new AppError("not_found", 404);
        }

        const [countRow] = await tx.execute<{ count: number }>(
          sql`SELECT count(*)::integer AS count FROM mcp_connection WHERE user_id = ${userId}`,
        );
        if (
          (countRow?.count ?? 0) >= MCP_REGISTRY_LIMITS.maxConnectionsPerOwner
        ) {
          throw new AppError("mcp_connection_limit_exceeded", 400);
        }

        const config = this.configProvider();
        if (!config) {
          throw new AppError("mcp_client_disabled", 503);
        }

        const profile = config.getProfile(
          input.profileId,
          input.profileRevision,
          purpose,
        );

        const profileDigest = computeProfileDigest(profile);
        const id = randomUUID();
        const revision = randomUUID();

        const [created] = await tx.execute<McpConnectionRow>(
          sql`INSERT INTO mcp_connection (
            id, user_id, profile_id, profile_revision, purpose, profile_digest, label, state, revision, created_at, updated_at
          ) VALUES (
            ${id}, ${userId}, ${profile.profileId}, ${profile.revision}, ${purpose}, ${profileDigest}, ${label}, 'configured', ${revision}, now(), now()
          ) RETURNING *`,
        );
        return mcpConnectionView(created);
      },
      { isolationLevel: "read committed" },
    );
  }

  async disable(
    userId: string,
    connectionId: string,
    expectedRevision: string,
  ): Promise<McpConnectionView> {
    if (typeof expectedRevision !== "string" || !expectedRevision) {
      throw new AppError("mcp_connection_cas_conflict", 409);
    }
    return this.db.transaction(
      async (tx) => {
        await lockByokResources(tx);

        const [row] = await tx.execute<McpConnectionRow>(
          sql`SELECT * FROM mcp_connection WHERE id = ${connectionId} AND user_id = ${userId} LIMIT 1`,
        );
        if (!row) {
          throw new AppError("not_found", 404);
        }
        if (row.revision !== expectedRevision) {
          throw new AppError("mcp_connection_cas_conflict", 409);
        }
        if (row.state === "revoked") {
          throw new AppError("mcp_connection_revoked_terminal", 400);
        }
        if (row.state === "disabled") {
          return mcpConnectionView(row);
        }

        const nextRevision = randomUUID();
        const [updated] = await tx.execute<McpConnectionRow>(
          sql`UPDATE mcp_connection SET state = 'disabled', revision = ${nextRevision}, updated_at = now() WHERE id = ${connectionId} AND user_id = ${userId} AND revision = ${expectedRevision} RETURNING *`,
        );
        if (!updated) {
          throw new AppError("mcp_connection_cas_conflict", 409);
        }
        return mcpConnectionView(updated);
      },
      { isolationLevel: "read committed" },
    );
  }

  async enable(
    userId: string,
    connectionId: string,
    expectedRevision: string,
  ): Promise<McpConnectionView> {
    if (typeof expectedRevision !== "string" || !expectedRevision) {
      throw new AppError("mcp_connection_cas_conflict", 409);
    }
    return this.db.transaction(
      async (tx) => {
        await lockByokResources(tx);

        const [row] = await tx.execute<McpConnectionRow>(
          sql`SELECT * FROM mcp_connection WHERE id = ${connectionId} AND user_id = ${userId} LIMIT 1`,
        );
        if (!row) {
          throw new AppError("not_found", 404);
        }
        if (row.revision !== expectedRevision) {
          throw new AppError("mcp_connection_cas_conflict", 409);
        }
        if (row.state === "revoked") {
          throw new AppError("mcp_connection_revoked_terminal", 400);
        }
        if (row.state === "configured") {
          return mcpConnectionView(row);
        }

        const config = this.configProvider();
        if (!config) {
          throw new AppError("mcp_client_disabled", 503);
        }

        const profile = config.getProfile(
          row.profile_id,
          row.profile_revision,
          row.purpose,
        );

        const currentDigest = computeProfileDigest(profile);
        if (currentDigest !== row.profile_digest) {
          throw new AppError("mcp_profile_digest_mismatch", 409);
        }

        const nextRevision = randomUUID();
        const [updated] = await tx.execute<McpConnectionRow>(
          sql`UPDATE mcp_connection SET state = 'configured', revision = ${nextRevision}, updated_at = now() WHERE id = ${connectionId} AND user_id = ${userId} AND revision = ${expectedRevision} RETURNING *`,
        );
        if (!updated) {
          throw new AppError("mcp_connection_cas_conflict", 409);
        }
        return mcpConnectionView(updated);
      },
      { isolationLevel: "read committed" },
    );
  }

  async revoke(
    userId: string,
    connectionId: string,
    expectedRevision: string,
  ): Promise<McpConnectionView> {
    if (typeof expectedRevision !== "string" || !expectedRevision) {
      throw new AppError("mcp_connection_cas_conflict", 409);
    }
    return this.db.transaction(
      async (tx) => {
        await lockByokResources(tx);

        const [row] = await tx.execute<McpConnectionRow>(
          sql`SELECT * FROM mcp_connection WHERE id = ${connectionId} AND user_id = ${userId} LIMIT 1`,
        );
        if (!row) {
          throw new AppError("not_found", 404);
        }
        if (row.revision !== expectedRevision) {
          throw new AppError("mcp_connection_cas_conflict", 409);
        }
        if (row.state === "revoked") {
          return mcpConnectionView(row);
        }

        const nextRevision = randomUUID();
        const [updated] = await tx.execute<McpConnectionRow>(
          sql`UPDATE mcp_connection SET state = 'revoked', revision = ${nextRevision}, updated_at = now() WHERE id = ${connectionId} AND user_id = ${userId} AND revision = ${expectedRevision} RETURNING *`,
        );
        if (!updated) {
          throw new AppError("mcp_connection_cas_conflict", 409);
        }
        return mcpConnectionView(updated);
      },
      { isolationLevel: "read committed" },
    );
  }

  async delete(
    userId: string,
    connectionId: string,
    expectedRevision: string,
  ): Promise<void> {
    if (typeof expectedRevision !== "string" || !expectedRevision) {
      throw new AppError("mcp_connection_cas_conflict", 409);
    }
    return this.db.transaction(
      async (tx) => {
        await lockByokResources(tx);

        const [row] = await tx.execute<McpConnectionRow>(
          sql`SELECT * FROM mcp_connection WHERE id = ${connectionId} AND user_id = ${userId} LIMIT 1`,
        );
        if (!row) {
          throw new AppError("not_found", 404);
        }
        if (row.revision !== expectedRevision) {
          throw new AppError("mcp_connection_cas_conflict", 409);
        }

        const result = await tx.execute(
          sql`DELETE FROM mcp_connection WHERE id = ${connectionId} AND user_id = ${userId} AND revision = ${expectedRevision}`,
        );
        if (!result) {
          throw new AppError("mcp_connection_cas_conflict", 409);
        }
      },
      { isolationLevel: "read committed" },
    );
  }

  async updateLabel(
    userId: string,
    connectionId: string,
    expectedRevision: string,
    newLabel: string,
  ): Promise<McpConnectionView> {
    if (typeof expectedRevision !== "string" || !expectedRevision) {
      throw new AppError("mcp_connection_cas_conflict", 409);
    }
    const label = validateLabel(newLabel);
    return this.db.transaction(
      async (tx) => {
        await lockByokResources(tx);

        const [row] = await tx.execute<McpConnectionRow>(
          sql`SELECT * FROM mcp_connection WHERE id = ${connectionId} AND user_id = ${userId} LIMIT 1`,
        );
        if (!row) {
          throw new AppError("not_found", 404);
        }
        if (row.revision !== expectedRevision) {
          throw new AppError("mcp_connection_cas_conflict", 409);
        }
        if (row.state === "revoked") {
          throw new AppError("mcp_connection_revoked_terminal", 400);
        }
        if (row.label === label) {
          return mcpConnectionView(row);
        }

        const nextRevision = randomUUID();
        const [updated] = await tx.execute<McpConnectionRow>(
          sql`UPDATE mcp_connection SET label = ${label}, revision = ${nextRevision}, updated_at = now() WHERE id = ${connectionId} AND user_id = ${userId} AND revision = ${expectedRevision} RETURNING *`,
        );
        if (!updated) {
          throw new AppError("mcp_connection_cas_conflict", 409);
        }
        return mcpConnectionView(updated);
      },
      { isolationLevel: "read committed" },
    );
  }

  async export(userId: string): Promise<McpConnectionExportView[]> {
    const rows = await this.db.execute<McpConnectionRow>(
      sql`SELECT * FROM mcp_connection WHERE user_id = ${userId} ORDER BY created_at ASC, id ASC LIMIT ${MCP_REGISTRY_LIMITS.maxConnectionsPerOwner}`,
    );
    return rows.map(mcpConnectionExportView);
  }
}
