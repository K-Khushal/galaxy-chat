import { integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
// SQL migration owns composite/immutability guards; these exports support typed metadata tooling.
export const mcpRuntimeManifest = pgTable("mcp_runtime_manifest", {
  digest: text("digest").primaryKey(),
  definition: jsonb("definition").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
export const mcpRuntimeAdoption = pgTable("mcp_runtime_adoption", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  manifestDigest: text("manifest_digest").notNull(),
  initializeConnection: text("initialize_connection").notNull(),
  callConnection: text("call_connection").notNull(),
  catalogId: text("catalog_id").notNull(),
  binding: jsonb("binding").notNull(),
  state: text("state").notNull(),
  revision: integer("revision").notNull(),
});
export const mcpRuntimeExecution = pgTable("mcp_runtime_execution", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  runId: text("run_id").notNull(),
  adoptionId: text("adoption_id").notNull(),
  definition: jsonb("definition").notNull(),
});
export const mcpRuntimeFrame = pgTable("mcp_runtime_frame", {
  id: text("id").primaryKey(),
  executionId: text("execution_id").notNull(),
  userId: text("user_id").notNull(),
  ordinal: integer("ordinal").notNull(),
  kind: text("kind").notNull(),
  operationId: text("operation_id").notNull(),
  approvalId: text("approval_id").notNull(),
  toolCallId: text("tool_call_id").notNull(),
  body: jsonb("body").notNull(),
  binding: jsonb("binding").notNull(),
  intent: jsonb("intent").notNull(),
  digest: text("digest").notNull(),
  state: text("state").notNull(),
  revision: integer("revision").notNull(),
});
export const mcpRuntimeEvidence = pgTable("mcp_runtime_evidence", {
  operationId: text("operation_id").primaryKey(),
  digest: text("digest").notNull(),
  evidence: jsonb("evidence").notNull(),
});
