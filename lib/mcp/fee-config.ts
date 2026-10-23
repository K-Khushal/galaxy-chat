import "server-only";
import { z } from "zod";
import { AppError } from "@/lib/errors";
import {
  deepFreeze,
  PLATFORM_CEILING_MICRODOLLARS,
} from "@/lib/funding/config";
import { TOOL_LIMITS } from "@/lib/tools/contract";
import { MCP_CLIENT_LIMITS } from "./contract";
import {
  digestSchema,
  identifierSchema,
  operationDigest,
} from "./operation-contract";

export const operationCapacitySchema = z
  .object({
    ownerActive: z.number().int().min(1).max(1),
    globalActive: z.number().int().min(1).max(2),
    ownerDailyRequests: z.number().int().min(1).max(10),
    globalDailyRequests: z.number().int().min(1).max(50),
    ownerRecords: z.number().int().min(1).max(100),
    globalRecords: z.number().int().min(1).max(1000),
    requestBytes: z
      .number()
      .int()
      .min(1)
      .max(MCP_CLIENT_LIMITS.maxRequestBytes),
    responseBytes: z.number().int().min(1).max(TOOL_LIMITS.resultBytes),
    cpuMs: z.number().int().min(1).max(TOOL_LIMITS.timeoutMs),
    wallMs: z
      .number()
      .int()
      .min(100)
      .max(Math.min(TOOL_LIMITS.timeoutMs, MCP_CLIENT_LIMITS.maxTimeoutMs)),
    attempts: z.literal(1),
    sharedCapacityDigest: digestSchema,
  })
  .strict();
export const feeSnapshotSchema = z
  .object({
    id: identifierSchema,
    revision: identifierSchema,
    basis: z.enum(["synthetic-offline", "reviewed"]),
    reviewedAt: z.iso.datetime(),
    expiresAt: z.iso.datetime(),
    proofReference: identifierSchema,
    proofDigest: digestSchema,
    upperBoundMicrodollars: z
      .number()
      .int()
      .min(0)
      .max(PLATFORM_CEILING_MICRODOLLARS),
    allInPlatformCost: z.literal(true),
    coverage: z
      .object({
        broker: z.literal(true),
        transport: z.literal(true),
        cpu: z.literal(true),
        database: z.literal(true),
        storage: z.literal(true),
        queues: z.literal(true),
        upstream: z.literal(true),
        accountCharges: z.literal(true),
      })
      .strict(),
    capacity: operationCapacitySchema,
    capacityDigest: digestSchema,
  })
  .strict();
export type McpFeeSnapshot = z.infer<typeof feeSnapshotSchema>;
export type McpOperationCapacity = z.infer<typeof operationCapacitySchema>;
export function parseMcpFeeSnapshot(
  raw: unknown,
  now: Date,
): Readonly<McpFeeSnapshot> {
  const result = feeSnapshotSchema.safeParse(raw);
  if (!result.success) throw new AppError("mcp_fee_unavailable", 503);
  const fee = result.data;
  if (
    new Date(fee.reviewedAt) > now ||
    new Date(fee.expiresAt) <= now ||
    new Date(fee.reviewedAt) >= new Date(fee.expiresAt) ||
    operationDigest(fee.capacity) !== fee.capacityDigest
  )
    throw new AppError("mcp_fee_unavailable", 503);
  return deepFreeze(fee);
}
