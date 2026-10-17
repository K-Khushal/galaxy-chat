import {
  boolean,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
// No user FK: pseudonymous financial holds must survive account deletion.
// The SQL migration adds checks, RLS/revocations and append-only audit triggers.
export const creditReservation = pgTable(
  "credit_reservation",
  {
    id: text("id").primaryKey(),
    actorKey: text("actor_key").notNull(),
    actorKind: text("actor_kind").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    requestDigest: text("request_digest").notNull(),
    day: text("day").notNull(),
    month: text("month").notNull(),
    reservedMicrodollars: integer("reserved_microdollars").notNull(),
    chargedMicrodollars: integer("charged_microdollars").notNull(),
    incurredMicrodollars: integer("incurred_microdollars").notNull().default(0),
    state: text("state").notNull(),
    priceSnapshot: jsonb("price_snapshot").notNull(),
    usage: jsonb("usage"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [unique().on(table.actorKey, table.idempotencyKey)],
);
export const creditLedger = pgTable("credit_ledger", {
  id: text("id").primaryKey(),
  reservationId: text("reservation_id")
    .notNull()
    .references(() => creditReservation.id),
  event: text("event").notNull(),
  microdollars: integer("microdollars").notNull(),
  evidence: jsonb("evidence").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
export const guestUsage = pgTable("guest_usage", {
  actorKey: text("actor_key").primaryKey(),
  reservationId: text("reservation_id")
    .notNull()
    .unique()
    .references(() => creditReservation.id),
  usedAt: timestamp("used_at", { withTimezone: true }).notNull().defaultNow(),
});
export const guestRate = pgTable(
  "guest_rate",
  {
    networkKey: text("network_key").notNull(),
    hour: text("hour").notNull(),
    attempts: integer("attempts").notNull(),
  },
  (table) => [primaryKey({ columns: [table.networkKey, table.hour] })],
);
export const fundingControl = pgTable("funding_control", {
  id: text("id").primaryKey(),
  stopped: boolean("stopped").notNull().default(false),
});
