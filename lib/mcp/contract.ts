import "server-only";
import { AppError } from "@/lib/errors";

export const MCP_PURPOSES = [
  "mcp.initialize",
  "mcp.list",
  "mcp.call",
  "mcp.cancel",
  "oauth.resource",
  "oauth.discovery",
  "oauth.token",
  "oauth.refresh",
  "oauth.revoke",
] as const;

export type McpPurpose = (typeof MCP_PURPOSES)[number];

export const MCP_ALLOWED_RESPONSE_HEADERS = [
  "content-type",
  "mcp-session-id",
  "mcp-protocol-version",
] as const;

export type McpAllowedResponseHeader =
  (typeof MCP_ALLOWED_RESPONSE_HEADERS)[number];

export const MCP_CLIENT_LIMITS = {
  maxEnvelopeBytes: 96 * 1024,
  maxTransportResponseBytes: 96 * 1024,
  maxDecodedBodyBytes: 64 * 1024,
  maxRequestBytes: 65_536,
  maxTimeoutMs: 20_000,
  maxProfiles: 32,
} as const;

/**
 * Pre-entry error: rejected before any network dispatch was initiated.
 * Future funding ledgers must NOT place or retain holds for pre-entry failures.
 */
export class McpPreEntryError extends AppError {
  readonly isPreEntry = true;
  readonly isOutcomeUnknown = false;

  constructor(id: string, status = 400) {
    super(id, status);
    this.name = "McpPreEntryError";
  }
}

/**
 * Outcome unknown error: failed after request entry/dispatch was initiated.
 * The remote broker or upstream MCP host may have processed the request.
 * Future funding ledgers MUST retain holds until independent reconciliation.
 */
export class McpOutcomeUnknownError extends AppError {
  readonly isPreEntry = false;
  readonly isOutcomeUnknown = true;
  readonly causeError?: unknown;

  constructor(id: string, status = 502, cause?: unknown) {
    super(id, status);
    this.name = "McpOutcomeUnknownError";
    this.causeError = cause;
  }
}

/**
 * Terminal broker rejection: broker definitively responded with a 4xx scrubbed code
 * before upstream execution.
 */
export class McpTerminalError extends AppError {
  readonly isPreEntry = false;
  readonly isOutcomeUnknown = false;
  readonly brokerCode: string;

  constructor(id: string, status: number, brokerCode: string) {
    super(id, status);
    this.name = "McpTerminalError";
    this.brokerCode = brokerCode;
  }
}

export type McpCredentialEnvelope = Readonly<{
  connectionRevision: string;
  iv: string;
  ciphertext: string;
  tag: string;
}>;

export type McpEnvelope = Readonly<{
  version: 1;
  requestId: string;
  operationId: string;
  issuedAt: number;
  deadline: number;
  profileId: string;
  revision: string;
  purpose: McpPurpose;
  bodyHash: string;
  body: string;
  credential?: McpCredentialEnvelope;
}>;

export type McpClientRequest = Readonly<{
  operationId: string;
  profileId: string;
  revision: string;
  purpose: McpPurpose;
  body: Uint8Array;
  deadline: number;
  token?: string;
  connectionRevision?: string;
  signal?: AbortSignal;
}>;

export type McpEgressResult = Readonly<{
  status: number;
  body: Uint8Array;
  headers: Readonly<Record<string, string>>;
  destination: Readonly<{
    profileId: string;
    revision: string;
    purpose: string;
    address: string;
  }>;
}>;

export type McpMtlsFetcher = {
  fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
};

/** Canonical JSON stringification enforcing the exact wire property order of v1 envelopes. */
export function canonicalEnvelope(e: McpEnvelope): string {
  return JSON.stringify({
    version: e.version,
    requestId: e.requestId,
    operationId: e.operationId,
    issuedAt: e.issuedAt,
    deadline: e.deadline,
    profileId: e.profileId,
    revision: e.revision,
    purpose: e.purpose,
    bodyHash: e.bodyHash,
    body: e.body,
    ...(e.credential
      ? {
          credential: {
            connectionRevision: e.credential.connectionRevision,
            iv: e.credential.iv,
            ciphertext: e.credential.ciphertext,
            tag: e.credential.tag,
          },
        }
      : {}),
  });
}

export type McpRuntimeEnvelope = Omit<McpEnvelope, "version" | "credential"> & {
  version: 2;
  frameId: string;
  manifestDigest: string;
  profileDigest: string;
  keyVersion: string;
};
export function canonicalRuntimeEnvelope(e: McpRuntimeEnvelope) {
  return JSON.stringify({
    version: 2,
    requestId: e.requestId,
    operationId: e.operationId,
    issuedAt: e.issuedAt,
    deadline: e.deadline,
    profileId: e.profileId,
    revision: e.revision,
    purpose: e.purpose,
    bodyHash: e.bodyHash,
    body: e.body,
    frameId: e.frameId,
    manifestDigest: e.manifestDigest,
    profileDigest: e.profileDigest,
    keyVersion: e.keyVersion,
  });
}
