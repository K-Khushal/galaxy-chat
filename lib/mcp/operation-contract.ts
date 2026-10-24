import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import { AppError } from "@/lib/errors";
import { canonicalJson, deepFreeze } from "@/lib/funding/config";
import { MCP_PURPOSES } from "./contract";

export const digestSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const identifierSchema = z.string().regex(/^[a-zA-Z0-9:_-]{1,160}$/);
export const revisionIdentitySchema = z
  .object({
    id: identifierSchema,
    revision: identifierSchema,
    digest: digestSchema,
  })
  .strict();
export const planIdentitySchema = z
  .object({
    month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
    revision: identifierSchema,
    digest: digestSchema,
    capacityDigest: digestSchema,
  })
  .strict();
export const operationIntentSchema = z
  .object({
    id: z.uuid(),
    idempotencyKey: identifierSchema,
    connection: z.object({ id: z.uuid(), revision: z.uuid() }).strict(),
    profile: revisionIdentitySchema
      .extend({ purpose: z.enum(MCP_PURPOSES) })
      .strict(),
    catalog: revisionIdentitySchema,
    action: revisionIdentitySchema,
    approval: revisionIdentitySchema.nullable(),
    requestDigest: digestSchema,
    requestBytes: z.number().int().min(0).max(65_536),
    plan: planIdentitySchema,
    feeDigest: digestSchema,
    authority: revisionIdentitySchema,
    deadline: z.iso.datetime(),
    maxAttempts: z.literal(1),
  })
  .strict();
export type OperationIntent = z.infer<typeof operationIntentSchema>;
export type PlanIdentity = z.infer<typeof planIdentitySchema>;
export const receiptSchema = z
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
export type OperationReceipt = z.infer<typeof receiptSchema>;
export type VerifiedAuthority = Readonly<{
  kind: "verified";
  ownerId: string;
  intentDigest: string;
  feeDigest: string;
  authority: OperationIntent["authority"];
  catalog: OperationIntent["catalog"];
  action: OperationIntent["action"];
  approval: OperationIntent["approval"];
  expiresAt: string;
}>;
/** Required future ports. No caller-supplied implementation is accepted by the store. */
export interface OperationAuthorityPort {
  verify(
    ownerId: string,
    intent: OperationIntent,
  ): Promise<VerifiedAuthority | { kind: "unavailable" }>;
}
export interface OperationReceiptPort {
  verify(
    receiptId: string,
    operationId: string,
    bindingDigest: string,
  ): Promise<
    { kind: "verified"; receipt: OperationReceipt } | { kind: "unavailable" }
  >;
}
export const unavailableOperationAuthority: OperationAuthorityPort =
  Object.freeze({
    async verify(): Promise<{ kind: "unavailable" }> {
      return { kind: "unavailable" };
    },
  });
export const unavailableOperationReceipts: OperationReceiptPort = Object.freeze(
  {
    async verify(): Promise<{ kind: "unavailable" }> {
      return { kind: "unavailable" };
    },
  },
);
export function operationDigest(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}
export function parseOperationIntent(raw: unknown): Readonly<OperationIntent> {
  const result = operationIntentSchema.safeParse(raw);
  if (!result.success) throw new AppError("invalid_mcp_operation", 400);
  return deepFreeze(result.data);
}
export function parseOperationReceipt(
  raw: unknown,
): Readonly<OperationReceipt> {
  const result = receiptSchema.safeParse(raw);
  if (!result.success) throw new AppError("invalid_mcp_receipt", 400);
  return deepFreeze(result.data);
}
export type OperationView = Readonly<{
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
  attempts: number;
  createdAt: string;
}>;
