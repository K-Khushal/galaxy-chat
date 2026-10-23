import {
  bigint,
  date,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { mcpConnection, user } from "./schema";
/** Anonymous financial operations and evidence have NO cascading owner/connection references. */
export const mcpOperation = pgTable("mcp_operation", {
  id: text("id").primaryKey(),
  actorKey: text("actor_key").notNull(),
  actorVersion: text("actor_version").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  bindingDigest: text("binding_digest").notNull(),
  identity: jsonb("identity").notNull(),
  feeSnapshot: jsonb("fee_snapshot").notNull(),
  month: text("month").notNull(),
  day: date("day").notNull(),
  state: text("state").notNull(),
  revision: integer("revision").notNull().default(1),
  reservedMicrodollars: bigint("reserved_microdollars", {
    mode: "number",
  }).notNull(),
  incurredMicrodollars: bigint("incurred_microdollars", { mode: "number" })
    .notNull()
    .default(0),
  attempts: integer("attempts").notNull().default(0),
  deadline: timestamp("deadline", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  receiptId: text("receipt_id"),
  receipt: jsonb("receipt"),
});
/** Only this separate owner access mapping cascades. It cannot delete financial operations. */
export const mcpOperationOwner = pgTable("mcp_operation_owner", {
  operationId: text("operation_id")
    .primaryKey()
    .references(() => mcpOperation.id),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  connectionId: text("connection_id")
    .notNull()
    .references(() => mcpConnection.id, { onDelete: "cascade" }),
});
export const mcpActorAlias = pgTable("mcp_actor_alias", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  actorKey: text("actor_key").notNull(),
  keyVersion: text("key_version").notNull(),
});
export const mcpActorKeyVersion = pgTable("mcp_actor_key_version", {
  version: text("version").primaryKey(),
  fingerprint: text("fingerprint").notNull(),
});
export const mcpOperationPeriod = pgTable("mcp_operation_period", {
  month: text("month").primaryKey(),
  planIdentity: jsonb("plan_identity").notNull(),
  sourcesDigest: text("sources_digest").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
export const mcpOperationCommitment = pgTable(
  "mcp_operation_commitment",
  {
    month: text("month")
      .notNull()
      .references(() => mcpOperationPeriod.month),
    sourceId: text("source_id")
      .notNull()
      .references(() => mcpOperation.id),
    amountMicrodollars: bigint("amount_microdollars", {
      mode: "number",
    }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.month, table.sourceId] })],
);
export const mcpOperationAudit = pgTable("mcp_operation_audit", {
  id: text("id").primaryKey(),
  operationId: text("operation_id")
    .notNull()
    .references(() => mcpOperation.id),
  event: text("event").notNull(),
  revision: integer("revision").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
/** Fixture owner/authority metadata may cascade; receipts below never do. */
export const mcpFixtureAuthority = pgTable("mcp_fixture_authority", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  connectionId: text("connection_id")
    .notNull()
    .references(() => mcpConnection.id, { onDelete: "cascade" }),
  intentDigest: text("intent_digest").notNull(),
  feeDigest: text("fee_digest").notNull(),
  approvalId: text("approval_id"),
  authority: jsonb("authority").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  consumedBy: text("consumed_by").references(() => mcpOperation.id),
});
export const mcpFixtureReceipt = pgTable("mcp_fixture_receipt", {
  id: text("id").primaryKey(),
  operationId: text("operation_id")
    .notNull()
    .references(() => mcpOperation.id),
  receipt: jsonb("receipt").notNull(),
});
