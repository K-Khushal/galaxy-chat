import "server-only";
import { createPublicKey } from "node:crypto";
import { z } from "zod";
import type { EnvSource } from "@/lib/auth/env";
import { AppError } from "@/lib/errors";
import { deepFreeze } from "@/lib/funding/config";
import { actionNameSchema } from "./catalog-contract";
import {
  parseProfileEntry,
  validateBrokerUrl,
  validateCanonicalUrl,
} from "./config";
import { parseMcpFeeSnapshot } from "./fee-config";
import { identifierSchema, operationDigest } from "./operation-contract";
import { mcpText, parseMcpSchema } from "./schema-policy";

export const RUNTIME_PROTOCOL = "2025-11-25" as const;
export const FRAME_KINDS = ["initialize", "initialized", "call"] as const;
export type FrameKind = (typeof FRAME_KINDS)[number];
const url = z
  .string()
  .max(2048)
  .refine((v) => {
    try {
      return validateCanonicalUrl(v, "runtime_endpoint") === v;
    } catch {
      return false;
    }
  });
export const runtimeProfileSchema = z
  .object({
    profileId: identifierSchema,
    revision: identifierSchema,
    purpose: z.enum(["mcp.initialize", "mcp.call"]),
    endpoint: url,
    contentType: z.literal("application/json"),
    responseTypes: z.tuple([z.literal("application/json")]),
    maxRequestBytes: z.number().int().min(1).max(65536),
    maxResponseBytes: z.number().int().min(1).max(4096),
    timeoutMs: z.number().int().min(1).max(20000),
    connectMs: z.number().int().min(1).max(20000),
    firstByteMs: z.number().int().min(1).max(20000),
    resource: url,
    issuer: url,
    credential: z.literal("none"),
    protocolVersion: z.literal(RUNTIME_PROTOCOL),
    toolName: actionNameSchema,
  })
  .strict();
const manifestSchema = z
  .object({
    id: identifierSchema,
    revision: identifierSchema,
    reviewedAt: z.iso.datetime(),
    expiresAt: z.iso.datetime(),
    proofReference: identifierSchema,
    proofDigest: z.string().regex(/^[a-f0-9]{64}$/),
    brokerEndpoint: z.string().max(2048),
    evidenceKeyVersion: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/),
    evidencePublicKey: z.string().max(512),
    synchronous: z.literal(true),
    stateless: z.literal(true),
    credentials: z.literal("none"),
    profiles: z
      .object({ initialize: runtimeProfileSchema, call: runtimeProfileSchema })
      .strict(),
    tool: z
      .object({
        name: actionNameSchema,
        description: z.string().max(1024),
        inputSchema: z.unknown(),
        outputSchema: z.unknown().nullable(),
        readOnly: z.literal(true),
      })
      .strict(),
    fees: z
      .object({
        initialize: z.unknown(),
        initialized: z.unknown(),
        call: z.unknown(),
      })
      .strict(),
  })
  .strict();
const configSchema = z
  .object({
    manifest: manifestSchema,
    activeActorKey: identifierSchema,
    actorKeys: z
      .record(identifierSchema, z.string().min(32).max(256))
      .refine((v) => Object.keys(v).length > 0 && Object.keys(v).length <= 8),
  })
  .strict();
/** Operator configuration is a server-only policy input, never a client-supplied authority. */
export function resolveRuntimeConfig(env: EnvSource, now: Date) {
  try {
    if (env.MCP_RUNTIME_ENABLED !== "1") throw new Error();
    const raw = env.MCP_RUNTIME_CONFIG_JSON ?? "";
    if (Buffer.byteLength(raw) > 65536) throw new Error();
    const c = configSchema.parse(JSON.parse(raw));
    const m = c.manifest;
    validateBrokerUrl(m.brokerEndpoint);
    if (
      !Object.hasOwn(c.actorKeys, c.activeActorKey) ||
      new Date(m.reviewedAt) > now ||
      new Date(m.expiresAt) <= now ||
      new Date(m.reviewedAt) >= new Date(m.expiresAt)
    )
      throw new Error();
    const publicKey = createPublicKey({
      key: Buffer.from(m.evidencePublicKey, "base64"),
      format: "der",
      type: "spki",
    });
    if (
      publicKey.asymmetricKeyType !== "ed25519" ||
      publicKey.export({ format: "der", type: "spki" }).toString("base64") !==
        m.evidencePublicKey
    )
      throw new Error();
    for (const [kind, p] of Object.entries(m.profiles)) {
      if (
        p.purpose !== (kind === "call" ? "mcp.call" : "mcp.initialize") ||
        p.toolName !== m.tool.name ||
        p.connectMs > p.timeoutMs ||
        p.firstByteMs > p.timeoutMs
      )
        throw new Error();
      parseProfileEntry({ ...appProfile(p, m.expiresAt) });
    }
    if (
      m.profiles.call.endpoint !== m.profiles.initialize.endpoint ||
      m.profiles.call.resource !== m.profiles.initialize.resource ||
      m.profiles.call.issuer !== m.profiles.initialize.issuer
    )
      throw new Error();
    const fees = {
      initialize: parseMcpFeeSnapshot(m.fees.initialize, now),
      initialized: parseMcpFeeSnapshot(m.fees.initialized, now),
      call: parseMcpFeeSnapshot(m.fees.call, now),
    };
    for (const kind of FRAME_KINDS) {
      const f = fees[kind],
        p = m.profiles[kind === "call" ? "call" : "initialize"];
      if (
        f.basis !== "reviewed" ||
        f.upperBoundMicrodollars < 1 ||
        f.capacity.requestBytes > p.maxRequestBytes ||
        f.capacity.responseBytes !== p.maxResponseBytes ||
        f.capacity.wallMs !== p.timeoutMs ||
        new Date(f.expiresAt) > new Date(m.expiresAt)
      )
        throw new Error();
    }
    const manifest = {
      ...m,
      tool: {
        ...m.tool,
        description: mcpText(m.tool.description, 1024),
        inputSchema: parseMcpSchema(m.tool.inputSchema),
        outputSchema:
          m.tool.outputSchema === null
            ? null
            : parseMcpSchema(m.tool.outputSchema),
      },
      fees,
    };
    return deepFreeze({ ...c, manifest, digest: operationDigest(manifest) });
  } catch {
    throw new AppError("mcp_runtime_unconfigured", 503);
  }
}
export function appProfile(
  p: z.infer<typeof runtimeProfileSchema>,
  expiresAt: string,
) {
  return {
    profileId: p.profileId,
    revision: p.revision,
    purpose: p.purpose,
    resource: p.resource,
    issuer: p.issuer,
    credential: p.credential,
    maxRequestBytes: p.maxRequestBytes,
    maxResponseBytes: p.maxResponseBytes,
    timeoutMs: p.timeoutMs,
    expiresAt,
  };
}
export type RuntimeConfig = ReturnType<typeof resolveRuntimeConfig>;

/** In-memory fingerprint only: no key material or fingerprint is exported in metadata. */
export function runtimeWireDigest() {
  return operationDigest({
    broker: process.env.MCP_CLIENT_BROKER_URL ?? "",
    hmac: process.env.MCP_CLIENT_HMAC_KEY ?? "",
    envelope: process.env.MCP_CLIENT_ENVELOPE_KEY ?? "",
  });
}
