import { z } from "zod";
import { planIdentitySchema } from "@/lib/mcp/operation-contract";

/**
 * Durable sandbox foundation contract. This slice binds an exact owned artifact
 * revision (treated as Python source) to an approval, a separately funded durable
 * execution journal and a bounded Markdown publication. Nothing here executes
 * submitted code: production denies every privileged call and only the private
 * test-only offline-scripted adapter exercises the real coordinator/client.
 */
export const SANDBOX_ACTION_REVISION = "sandbox-python-run-v1" as const;

export const SANDBOX_LIMITS = {
  activePerOwner: 1,
  activeGlobal: 2,
  queuedPerOwner: 10,
  attempts: 5,
  wallMs: 10 * 60_000,
  leaseMs: 20_000,
  commandMs: 15_000,
  absoluteLifetimeMs: 5 * 60_000,
  approvalMs: 5 * 60_000,
  logsBytes: 4 * 1024,
  wireResultBytes: 4 * 1024,
  finalArtifactBytes: 128 * 1024,
  inputBytes: 128 * 1024,
  operationsPerOwner: 100,
  operationsGlobal: 1000,
  evidencePerOperation: 16,
} as const;

export const digestSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const identifierSchema = z.string().regex(/^[a-zA-Z0-9:_-]{1,160}$/);
export const handleSchema = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);

/** Exact owned Python-artifact binding. No attachments, packages, secrets or mounts. */
export const sandboxSourceSchema = z
  .object({
    artifactId: z.uuid(),
    version: z.number().int().min(1).max(40),
    contentSha256: digestSchema,
  })
  .strict();
export type SandboxSource = z.infer<typeof sandboxSourceSchema>;

/** This slice transfers no selected inputs: the digest list is provably empty. */
export const selectedInputDigestsSchema = z.array(digestSchema).max(0);

export const sandboxPolicySchema = z
  .object({
    imageDigest: digestSchema,
    interpreterDigest: digestSchema,
    interpreter: z.literal("python3"),
    entryPath: z.literal("/app/main.py"),
    vcpuMilli: z.literal(1000),
    memoryMiB: z.literal(512),
    diskMiB: z.literal(128),
    network: z.literal("denied"),
    packageInstallation: z.literal("denied"),
    commandMs: z.literal(SANDBOX_LIMITS.commandMs),
    absoluteLifetimeMs: z.literal(SANDBOX_LIMITS.absoluteLifetimeMs),
    logsBytes: z.literal(SANDBOX_LIMITS.logsBytes),
    resultBytes: z.literal(SANDBOX_LIMITS.wireResultBytes),
  })
  .strict();
export type SandboxPolicy = z.infer<typeof sandboxPolicySchema>;

export const sandboxGatewayIdentitySchema = z
  .object({
    protocol: z.literal("sandbox-gateway-v1"),
    baseUrl: z.string().url(),
    keyIdentity: digestSchema,
  })
  .strict();
export type SandboxGatewayIdentity = z.infer<
  typeof sandboxGatewayIdentitySchema
>;

export const sandboxProviderSchema = z
  .object({
    id: z.string().min(1).max(64),
    account: identifierSchema,
    region: identifierSchema,
  })
  .strict();

/**
 * Pre-approval binding core. The checkpoint digest is computed over exactly this
 * value; the durable operation binds the same core plus the consumed approval.
 */
export const sandboxBindingCoreSchema = z
  .object({
    actionRevision: z.literal(SANDBOX_ACTION_REVISION),
    jobId: z.uuid(),
    source: sandboxSourceSchema,
    language: z.literal("python"),
    selectedInputDigests: selectedInputDigestsSchema,
    policy: sandboxPolicySchema,
    gateway: sandboxGatewayIdentitySchema,
    provider: sandboxProviderSchema,
    feeDigest: digestSchema,
    envelopeDigest: digestSchema,
    plan: planIdentitySchema,
    approvalExpiresAt: z.iso.datetime(),
  })
  .strict();
export type SandboxBindingCore = z.infer<typeof sandboxBindingCoreSchema>;

/** Full durable operation identity: binding core plus the exact consumed approval. */
export const sandboxBindingSchema = sandboxBindingCoreSchema
  .extend({
    approval: z.object({ checkpoint: digestSchema }).strict(),
  })
  .strict();
export type SandboxBinding = z.infer<typeof sandboxBindingSchema>;

export const sandboxRequestSchema = z
  .object({
    id: z.uuid(),
    source: z
      .object({
        artifactId: z.uuid(),
        version: z.number().int().min(1).max(40),
      })
      .strict(),
  })
  .strict();
export type SandboxRequest = z.infer<typeof sandboxRequestSchema>;

export const sandboxApprovalSchema = z
  .object({
    id: z.uuid(),
    checkpoint: digestSchema,
    actionRevision: z.literal(SANDBOX_ACTION_REVISION),
  })
  .strict();

/** Wire create request: digests and policy only — never source content or inputs. */
export const sandboxWireCreateRequestSchema = z
  .object({
    protocol: z.literal("sandbox-gateway-v1"),
    idempotencyKey: z
      .string()
      .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/),
    bindingDigest: digestSchema,
    policy: sandboxPolicySchema,
    input: z
      .object({
        contentSha256: digestSchema,
        selectedInputDigests: selectedInputDigestsSchema,
      })
      .strict(),
  })
  .strict();
export type SandboxWireCreateRequest = z.infer<
  typeof sandboxWireCreateRequestSchema
>;

export const sandboxWireCreateResponseSchema = z
  .object({
    protocol: z.literal("sandbox-gateway-v1"),
    idempotencyKey: z
      .string()
      .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/),
    handle: handleSchema,
    created: z.literal(true),
  })
  .strict();
export type SandboxWireCreateResponse = z.infer<
  typeof sandboxWireCreateResponseSchema
>;

export const sandboxWireStatusResponseSchema = z
  .object({
    protocol: z.literal("sandbox-gateway-v1"),
    handle: handleSchema,
    state: z.enum(["running", "completed", "failed", "terminated"]),
    logs: z
      .string()
      .max(SANDBOX_LIMITS.logsBytes)
      .refine((value) => !value.includes("\0")),
    result: z
      .string()
      .max(SANDBOX_LIMITS.wireResultBytes)
      .refine((value) => !value.includes("\0")),
  })
  .strict();
export type SandboxWireStatusResponse = z.infer<
  typeof sandboxWireStatusResponseSchema
>;

export const sandboxWireTerminateResponseSchema = z
  .object({
    protocol: z.literal("sandbox-gateway-v1"),
    handle: handleSchema,
    terminated: z.boolean(),
  })
  .strict();
export type SandboxWireTerminateResponse = z.infer<
  typeof sandboxWireTerminateResponseSchema
>;

export type SandboxState =
  | "queued"
  | "running"
  | "awaiting_approval"
  | "completed"
  | "cancelled"
  | "failed";

export type SandboxLease = {
  id: string;
  ownerId: string;
  fence: number;
  attempt: number;
  checkpoint: number;
};

/** Sanitized owner view: no provider handles, gateway identities or fee snapshots. */
export type SandboxJobView = {
  id: string;
  state: SandboxState;
  source: { artifactId: string; version: number };
  checkpoint: string | null;
  actionRevision: typeof SANDBOX_ACTION_REVISION;
  proposal: string | null;
  approvalExpiresAt: Date | null;
  resultArtifactId: string | null;
  attempts: number;
  error: string | null;
};

export type SandboxOperationView = {
  id: string;
  state:
    | "reserved"
    | "entered"
    | "held"
    | "completed_unreconciled"
    | "settled"
    | "released";
  revision: number;
  reservedMicrodollars: number;
  incurredMicrodollars: number;
  createdAt: string;
};

/** Authentic settlement receipt. Terminal transport evidence never substitutes for it. */
export const sandboxReceiptSchema = z
  .object({
    id: z.uuid(),
    operationId: z.uuid(),
    bindingDigest: digestSchema,
    evidenceDigest: digestSchema,
    incurredMicrodollars: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    terminal: z.literal(true),
    revision: identifierSchema,
  })
  .strict();
export type SandboxReceipt = z.infer<typeof sandboxReceiptSchema>;
