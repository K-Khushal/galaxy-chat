import "server-only";
import { z } from "zod";
import { AppError } from "@/lib/errors";
import { canonicalJson, deepFreeze } from "@/lib/funding/config";
import {
  digestSchema,
  identifierSchema,
  operationDigest,
  planIdentitySchema,
} from "./operation-contract";
import { mcpText, parseMcpSchema } from "./schema-policy";

export const MCP_CATALOG_LIMITS = Object.freeze({
  tools: 10,
  ownerRevisions: 20,
  globalRevisions: 200,
  ownerProposals: 100,
  globalProposals: 1000,
});
export const callProfileSchema = z
  .object({
    id: identifierSchema,
    revision: identifierSchema,
    purpose: z.literal("mcp.call"),
    digest: digestSchema,
  })
  .strict();
export const catalogIdentitySchema = z
  .object({ id: z.uuid(), revision: identifierSchema, digest: digestSchema })
  .strict();
export const connectionIdentitySchema = z
  .object({ id: z.uuid(), revision: z.uuid() })
  .strict();
export const actionNameSchema = z
  .string()
  .regex(/^[a-zA-Z][a-zA-Z0-9_.-]{0,63}$/);
const actionSchema = z
  .object({
    name: actionNameSchema,
    description: z.string(),
    inputSchema: z.unknown(),
    outputSchema: z.unknown().optional(),
    annotations: z
      .object({
        readOnlyHint: z.boolean().optional(),
        destructiveHint: z.boolean().optional(),
        idempotentHint: z.boolean().optional(),
        openWorldHint: z.boolean().optional(),
      })
      .strict(),
  })
  .strict();
const catalogImportSchema = z
  .object({
    id: z.uuid(),
    revision: identifierSchema,
    expectedHeadRevision: z.uuid().nullable(),
    connection: connectionIdentitySchema,
    profile: callProfileSchema,
    tools: z.array(actionSchema).min(1).max(MCP_CATALOG_LIMITS.tools),
  })
  .strict();
export function parseCatalogImport(raw: unknown) {
  const result = catalogImportSchema.safeParse(raw);
  if (!result.success) throw new AppError("invalid_mcp_catalog", 400);
  const input = result.data;
  const tools = input.tools
    .map((tool) => ({
      name: tool.name,
      description: mcpText(tool.description, 1024),
      inputSchema: parseMcpSchema(tool.inputSchema),
      outputSchema:
        tool.outputSchema === undefined || tool.outputSchema === null
          ? null
          : parseMcpSchema(tool.outputSchema),
      annotations: tool.annotations,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  if (new Set(tools.map((tool) => tool.name)).size !== tools.length)
    throw new AppError("invalid_mcp_catalog", 400);
  const { expectedHeadRevision, ...definition } = { ...input, tools };
  if (Buffer.byteLength(canonicalJson(definition)) > 65536)
    throw new AppError("invalid_mcp_catalog", 400);
  return deepFreeze({
    definition,
    expectedHeadRevision,
    digest: operationDigest(definition),
  });
}
export type CatalogDefinition = ReturnType<
  typeof parseCatalogImport
>["definition"];
export const proposalRequestSchema = z
  .object({
    id: z.uuid(),
    catalog: catalogIdentitySchema,
    action: actionNameSchema,
    runId: z.uuid(),
    toolCallId: identifierSchema,
    requestDigest: digestSchema,
    arguments: z.unknown(),
    target: identifierSchema,
    feeDigest: digestSchema,
    plan: planIdentitySchema,
  })
  .strict();
export const mcpActionBindingSchema = z
  .object({
    proposal: z
      .object({ id: z.uuid(), revision: z.literal(1), digest: digestSchema })
      .strict(),
    connection: connectionIdentitySchema,
    profile: callProfileSchema,
    catalog: catalogIdentitySchema,
    action: z.object({ name: actionNameSchema, digest: digestSchema }).strict(),
    schemaDigest: digestSchema,
    outputSchemaDigest: digestSchema.nullable(),
    requestDigest: digestSchema,
    argumentsDigest: digestSchema,
    targetDigest: digestSchema,
    feeDigest: digestSchema,
    plan: planIdentitySchema,
  })
  .strict();
export type McpActionBinding = z.infer<typeof mcpActionBindingSchema>;
export const exactMcpToolBindingSchema = z
  .object({
    runId: z.uuid(),
    toolCallId: identifierSchema,
    tool: z.string().min(1).max(100),
    toolRevision: digestSchema,
    connectionRevision: z.uuid(),
    arguments: z.record(z.string(), z.unknown()),
    target: identifierSchema,
    costMicrodollars: z.number().int().min(0).max(10000000),
    mcp: mcpActionBindingSchema,
  })
  .strict();
export type ExactMcpToolBinding = z.infer<typeof exactMcpToolBindingSchema>;
export type CatalogMetadata = Readonly<{
  id: string;
  revision: string;
  state: string;
  headRevision: string;
  tools: number;
  createdAt: string;
}>;
