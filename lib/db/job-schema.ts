import {
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { user } from "./schema";

export const durableJob = pgTable("durable_job", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  sourceArtifactId: text("source_artifact_id").notNull(),
  sourceVersion: integer("source_version").notNull(),
  actionRevision: text("action_revision")
    .notNull()
    .default("publish-fixture-report-v1"),
  state: text("state").notNull(),
  checkpoint: integer("checkpoint").notNull().default(0),
  checkpointDigest: text("checkpoint_digest"),
  proposal: text("proposal"),
  approvalExpiresAt: timestamp("approval_expires_at", { withTimezone: true }),
  approvedDigest: text("approved_digest"),
  fence: integer("fence").notNull().default(0),
  attempts: integer("attempts").notNull().default(0),
  leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
  startedAt: timestamp("started_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  resultArtifactId: text("result_artifact_id"),
  error: text("error"),
});
export const durableJobAttempt = pgTable(
  "durable_job_attempt",
  {
    jobId: text("job_id")
      .notNull()
      .references(() => durableJob.id, { onDelete: "cascade" }),
    fence: integer("fence").notNull(),
    checkpoint: integer("checkpoint").notNull(),
    state: text("state").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.jobId, table.fence] })],
);
