import {
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { mcpConnection, user } from "./schema";

// Owned metadata only. These cascades never reach anonymous financial state.
export const mcpCatalogRevision = pgTable("mcp_catalog_revision", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  connectionId: text("connection_id")
    .notNull()
    .references(() => mcpConnection.id, { onDelete: "cascade" }),
  revision: text("revision").notNull(),
  connectionRevision: text("connection_revision").notNull(),
  profile: jsonb("profile").notNull(),
  digest: text("digest").notNull(),
  definition: jsonb("definition").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
export const mcpCatalogAction = pgTable(
  "mcp_catalog_action",
  {
    catalogId: text("catalog_id")
      .notNull()
      .references(() => mcpCatalogRevision.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    digest: text("digest").notNull(),
    schemaDigest: text("schema_digest").notNull(),
    outputSchemaDigest: text("output_schema_digest"),
    definition: jsonb("definition").notNull(),
  },
  (table) => [primaryKey({ columns: [table.catalogId, table.name] })],
);
export const mcpCatalogHead = pgTable("mcp_catalog_head", {
  connectionId: text("connection_id")
    .primaryKey()
    .references(() => mcpConnection.id, { onDelete: "cascade" }),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  catalogId: text("catalog_id")
    .notNull()
    .references(() => mcpCatalogRevision.id, { onDelete: "cascade" }),
  revision: text("revision").notNull(),
  state: text("state").notNull(),
});
export const mcpCatalogAdmission = pgTable("mcp_catalog_admission", {
  id: text("id").primaryKey(),
  actorKey: text("actor_key").notNull(),
  kind: text("kind").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
export const mcpActionProposal = pgTable("mcp_action_proposal", {
  id: text("id").primaryKey(),
  revision: integer("revision").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  catalogId: text("catalog_id")
    .notNull()
    .references(() => mcpCatalogRevision.id, { onDelete: "cascade" }),
  actionName: text("action_name").notNull(),
  runId: text("run_id").notNull(),
  toolCallId: text("tool_call_id").notNull(),
  binding: jsonb("binding").notNull(),
  digest: text("digest").notNull(),
  approvalId: text("approval_id").notNull(),
  approvalDigest: text("approval_digest").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
