import {
  bigint,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
// SQL migration 0022 owns composite/immutability guards; these exports support typed metadata tooling.
export const sandboxCounterKey = pgTable("sandbox_counter_key", {
  id: text("id").primaryKey(),
  fingerprint: text("fingerprint").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
export const sandboxActorPrincipal = pgTable("sandbox_actor_principal", {
  principalDigest: text("principal_digest").primaryKey(),
  actorKey: text("actor_key").notNull().unique(),
  actorVersion: text("actor_version").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
export const sandboxOperation = pgTable("sandbox_operation", {
  id: text("id").primaryKey(),
  actorKey: text("actor_key").notNull(),
  actorVersion: text("actor_version").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  bindingDigest: text("binding_digest").notNull(),
  identity: jsonb("identity").notNull(),
  feeSnapshot: jsonb("fee_snapshot").notNull(),
  month: text("month").notNull(),
  day: text("day").notNull(),
  state: text("state").notNull().default("reserved"),
  revision: integer("revision").notNull().default(1),
  reservedMicrodollars: bigint("reserved_microdollars", {
    mode: "number",
  }).notNull(),
  incurredMicrodollars: bigint("incurred_microdollars", {
    mode: "number",
  }).notNull(),
  attempts: integer("attempts").notNull().default(0),
  deadline: timestamp("deadline", { withTimezone: true }).notNull(),
  createRequestedAt: timestamp("create_requested_at", { withTimezone: true }),
  providerHandle: text("provider_handle"),
  receiptId: text("receipt_id").unique(),
  receipt: jsonb("receipt"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
export const sandboxOperationOwner = pgTable("sandbox_operation_owner", {
  operationId: text("operation_id").primaryKey(),
  userId: text("user_id").notNull(),
  jobId: text("job_id").notNull(),
  sourceArtifactId: text("source_artifact_id").notNull(),
  sourceVersion: integer("source_version").notNull(),
});
export const sandboxPeriod = pgTable("sandbox_period", {
  month: text("month").primaryKey(),
  planIdentity: jsonb("plan_identity").notNull(),
  sourcesDigest: text("sources_digest").notNull(),
  ordinaryInfraMicrodollars: bigint("ordinary_infra_microdollars", {
    mode: "number",
  }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
export const sandboxOperationCommitment = pgTable(
  "sandbox_operation_commitment",
  {
    month: text("month").notNull(),
    sourceId: text("source_id").notNull(),
    amountMicrodollars: bigint("amount_microdollars", {
      mode: "number",
    }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.month, table.sourceId] })],
);
export const sandboxOperationAudit = pgTable("sandbox_operation_audit", {
  id: text("id").primaryKey(),
  operationId: text("operation_id").notNull(),
  event: text("event").notNull(),
  revision: integer("revision").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
export const sandboxOperationEvidence = pgTable(
  "sandbox_operation_evidence",
  {
    operationId: text("operation_id").notNull(),
    ordinal: integer("ordinal").notNull(),
    digest: text("digest").notNull().unique(),
    evidence: jsonb("evidence").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.operationId, table.ordinal] })],
);
export const sandboxReceipt = pgTable("sandbox_receipt", {
  id: text("id").primaryKey(),
  operationId: text("operation_id").notNull(),
  receipt: jsonb("receipt").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
