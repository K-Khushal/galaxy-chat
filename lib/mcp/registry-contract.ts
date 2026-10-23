import "server-only";
import { createHash } from "node:crypto";
import { AppError } from "@/lib/errors";
import type { McpReviewedProfile } from "./config";

export const MCP_REGISTRY_PURPOSES = [
  "mcp.initialize",
  "mcp.list",
  "mcp.call",
  "mcp.cancel",
] as const;

export type McpRegistryPurpose = (typeof MCP_REGISTRY_PURPOSES)[number];

export const MCP_CONNECTION_STATES = [
  "configured",
  "disabled",
  "revoked",
] as const;

export type McpConnectionState = (typeof MCP_CONNECTION_STATES)[number];

export const MCP_REGISTRY_LIMITS = {
  maxConnectionsPerOwner: 5,
  maxLabelBytes: 64,
} as const;

export type McpConnectionRow = {
  id: string;
  user_id: string;
  profile_id: string;
  profile_revision: string;
  purpose: McpRegistryPurpose;
  profile_digest: string;
  label: string;
  state: McpConnectionState;
  revision: string;
  created_at: Date;
  updated_at: Date;
};

export type McpConnectionView = Readonly<{
  id: string;
  profileId: string;
  profileRevision: string;
  purpose: McpRegistryPurpose;
  profileDigest: string;
  label: string;
  state: McpConnectionState;
  revision: string;
  createdAt: string;
  updatedAt: string;
}>;

export type McpConnectionExportView = Readonly<{
  id: string;
  profileId: string;
  profileRevision: string;
  purpose: McpRegistryPurpose;
  label: string;
  state: McpConnectionState;
  createdAt: Date;
  updatedAt: Date;
}>;

export type CreateConnectionInput = Readonly<{
  profileId: string;
  profileRevision: string;
  purpose: McpRegistryPurpose;
  label: string;
}>;

export function computeProfileDigest(profile: McpReviewedProfile): string {
  const canonical = JSON.stringify([
    profile.profileId,
    profile.revision,
    profile.purpose,
    profile.resource,
    profile.issuer,
    profile.credential,
    profile.maxRequestBytes,
    profile.maxResponseBytes,
    profile.timeoutMs,
    profile.expiresAt,
  ]);
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

export function validateLabel(raw: unknown): string {
  if (typeof raw !== "string") {
    throw new AppError("invalid_label", 400);
  }
  const trimmed = raw.trim();
  const bytes = Buffer.byteLength(trimmed, "utf8");
  if (
    bytes === 0 ||
    bytes > MCP_REGISTRY_LIMITS.maxLabelBytes ||
    /[\r\n\t]/.test(raw)
  ) {
    throw new AppError("invalid_label", 400);
  }
  return trimmed;
}

export function validateRegistryPurpose(raw: unknown): McpRegistryPurpose {
  if (
    typeof raw !== "string" ||
    !MCP_REGISTRY_PURPOSES.includes(raw as McpRegistryPurpose)
  ) {
    throw new AppError("invalid_purpose", 400);
  }
  return raw as McpRegistryPurpose;
}

export function mcpConnectionView(row: McpConnectionRow): McpConnectionView {
  return Object.freeze({
    id: row.id,
    profileId: row.profile_id,
    profileRevision: row.profile_revision,
    purpose: row.purpose,
    profileDigest: row.profile_digest,
    label: row.label,
    state: row.state,
    revision: row.revision,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  });
}

export function mcpConnectionExportView(
  row: McpConnectionRow,
): McpConnectionExportView {
  return Object.freeze({
    id: row.id,
    profileId: row.profile_id,
    profileRevision: row.profile_revision,
    purpose: row.purpose,
    label: row.label,
    state: row.state,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  });
}
