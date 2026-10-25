import {
  date,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { mcpConnection, user } from "./schema";
export const mcpOAuthBinding = pgTable("mcp_oauth_binding", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  connectionId: text("connection_id")
    .notNull()
    .references(() => mcpConnection.id, { onDelete: "cascade" }),
  connectionRevision: text("connection_revision").notNull(),
  connectionProfileDigest: text("connection_profile_digest").notNull(),
  purpose: text("purpose").notNull(),
  profileId: text("profile_id").notNull(),
  profileRevision: text("profile_revision").notNull(),
  profileDigest: text("profile_digest").notNull(),
  manifestDigest: text("manifest_digest").notNull(),
  manifest: jsonb("manifest").notNull(),
  revision: integer("revision").notNull().default(1),
  state: text("state").notNull().default("configured"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
export const mcpOAuthState = pgTable("mcp_oauth_state", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  bindingId: text("binding_id")
    .notNull()
    .references(() => mcpOAuthBinding.id, { onDelete: "cascade" }),
  connectionId: text("connection_id")
    .notNull()
    .references(() => mcpConnection.id, { onDelete: "cascade" }),
  stateHash: text("state_hash").notNull(),
  sessionHash: text("session_hash").notNull(),
  redirectUri: text("redirect_uri").notNull(),
  verifier: jsonb("verifier"),
  challenge: text("challenge").notNull(),
  state: text("state").notNull().default("pending"),
  revision: integer("revision").notNull().default(1),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
export const mcpOAuthGrant = pgTable("mcp_oauth_grant", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  connectionId: text("connection_id")
    .notNull()
    .references(() => mcpConnection.id, { onDelete: "cascade" }),
  bindingId: text("binding_id")
    .notNull()
    .references(() => mcpOAuthBinding.id, { onDelete: "cascade" }),
  stateId: text("state_id")
    .notNull()
    .references(() => mcpOAuthState.id, { onDelete: "cascade" }),
  revision: integer("revision").notNull().default(1),
  refreshFence: integer("refresh_fence").notNull().default(0),
  state: text("state").notNull().default("active"),
  accessSecret: jsonb("access_secret"),
  refreshSecret: jsonb("refresh_secret"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
export const mcpOAuthRefresh = pgTable("mcp_oauth_refresh", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  grantId: text("grant_id")
    .notNull()
    .references(() => mcpOAuthGrant.id, { onDelete: "cascade" }),
  bindingId: text("binding_id")
    .notNull()
    .references(() => mcpOAuthBinding.id, { onDelete: "cascade" }),
  credentialRevision: integer("credential_revision").notNull(),
  fence: integer("fence").notNull(),
  state: text("state").notNull().default("reserved"),
  revision: integer("revision").notNull().default(1),
  deadline: timestamp("deadline", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
/** Anonymous counters and unknown markers survive all owner/connection cascades. */
export const mcpOAuthRecord = pgTable("mcp_oauth_record", {
  id: text("id").primaryKey(),
  actorKey: text("actor_key").notNull(),
  kind: text("kind").notNull(),
  day: date("day").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
export const mcpOAuthCounterKey = pgTable("mcp_oauth_counter_key", {
  id: text("id").primaryKey(),
  fingerprint: text("fingerprint").notNull(),
});
