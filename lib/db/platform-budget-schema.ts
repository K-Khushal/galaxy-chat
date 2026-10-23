import { integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const platformBudgetPlan = pgTable("platform_budget_plan", {
  month: text("month").primaryKey(),
  revision: text("revision").notNull(),
  digest: text("digest").notNull(),
  bSelected: integer("b_selected").notNull(),
  aCredit: integer("a_credit").notNull(),
  aMcp: integer("a_mcp").notNull(),
  kInfra: integer("k_infra").notNull(),
  kProviderFees: integer("k_provider_fees").notNull(),
  kSafety: integer("k_safety").notNull(),
  lCarried: integer("l_carried").notNull(),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  coverageProofReference: text("coverage_proof_reference").notNull(),
  coverageProofDigest: text("coverage_proof_digest").notNull(),
  coverageAssertions: jsonb("coverage_assertions").notNull(),
  capacitySnapshot: jsonb("capacity_snapshot").notNull(),
  capacityDigest: text("capacity_digest").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const platformBudgetCarry = pgTable("platform_budget_carry", {
  id: text("id").primaryKey(),
  month: text("month")
    .notNull()
    .references(() => platformBudgetPlan.month),
  sourceReservationId: text("source_reservation_id").notNull(),
  actorKey: text("actor_key").notNull(),
  amountMicrodollars: integer("amount_microdollars").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
