import {
  boolean,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

/**
 * Ownership is the Better Auth user id stored on each row.
 * Supabase Auth is not used, so policies must not call auth.uid().
 * The application connects with DATABASE_URL and filters every read
 * and write by the server session user id.
 */
export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  githubLogin: text("github_login"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const session = pgTable("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at").notNull(),
  token: text("token").notNull().unique(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
});

export const account = pgTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at"),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const chat = pgTable("chat", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  visibility: text("visibility").notNull().default("private"),
  lastContext: jsonb("last_context"),
  projectId: text("project_id").references(() => project.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

/**
 * Placeholder for later usage rows. It stores ownership only.
 * Credit amounts and BYOK material are not part of this table.
 */
export const usageRecord = pgTable("usage_record", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  chatId: text("chat_id").references(() => chat.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const chatMessage = pgTable("chat_message", {
  id: text("id").primaryKey(),
  chatId: text("chat_id")
    .notNull()
    .references(() => chat.id, { onDelete: "cascade" }),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  role: text("role").notNull(),
  parts: jsonb("parts").notNull(),
  attachments: jsonb("attachments").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const schemaMigrations = pgTable("schema_migrations", {
  version: text("version").primaryKey(),
  appliedAt: timestamp("applied_at").notNull().defaultNow(),
});

export const authSchema = { user, session, account, verification };
export const appSchema = { chat, chatMessage, usageRecord };

export * from "./credit-schema";

export const chatBranch = pgTable("chat_branch", {
  id: text("id").primaryKey(),
  chatId: text("chat_id")
    .notNull()
    .references(() => chat.id, { onDelete: "cascade" }),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  parentId: text("parent_id"),
  label: text("label").notNull(),
  messages: jsonb("messages").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export const chatRun = pgTable("chat_run", {
  id: text("id").primaryKey(),
  chatId: text("chat_id")
    .notNull()
    .references(() => chat.id, { onDelete: "cascade" }),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  branchId: text("branch_id")
    .notNull()
    .references(() => chatBranch.id, { onDelete: "cascade" }),
  digest: text("digest").notNull(),
  state: text("state").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

/** AEAD material is server-only; account exports select safe metadata explicitly. */
export const providerCredential = pgTable(
  "provider_credential",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    revision: text("revision").notNull(),
    keyVersion: text("key_version").notNull(),
    nonce: text("nonce").notNull(),
    ciphertext: text("ciphertext").notNull(),
    maskedKey: text("masked_key").notNull(),
    testState: text("test_state").notNull().default("untested"),
    testedAt: timestamp("tested_at"),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.provider] })],
);
export const searchCredential = pgTable(
  "search_credential",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    revision: text("revision").notNull(),
    keyVersion: text("key_version").notNull(),
    nonce: text("nonce").notNull(),
    ciphertext: text("ciphertext").notNull(),
    maskedKey: text("masked_key").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.provider] })],
);
export const byokOperation = pgTable("byok_operation", {
  resourceUnits: integer("resource_units").notNull().default(1),
  id: text("id").primaryKey(),
  actorKey: text("actor_key").notNull(),
  provider: text("provider").notNull(),
  credentialRevision: text("credential_revision").notNull(),
  kind: text("kind").notNull(),
  digest: text("digest").notNull(),
  state: text("state").notNull(),
  priceRevision: text("price_revision"),
  reservedMicrodollars: integer("reserved_microdollars"),
  actualMicrodollars: integer("actual_microdollars"),
  receiptCredits: integer("receipt_credits"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const artifact = pgTable("artifact", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  chatId: text("chat_id")
    .notNull()
    .references(() => chat.id, { onDelete: "cascade" }),
  messageId: text("message_id")
    .notNull()
    .references(() => chatMessage.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  head: integer("head").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export const artifactRevision = pgTable(
  "artifact_revision",
  {
    artifactId: text("artifact_id")
      .notNull()
      .references(() => artifact.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    version: integer("version").notNull(),
    title: text("title").notNull(),
    content: text("content").notNull(),
    restoredFrom: integer("restored_from"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.artifactId, table.version] })],
);

/** Explicit user-authored context only. No inference writes to these tables. */
export const project = pgTable("project", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  instructions: text("instructions").notNull(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export const memory = pgTable("memory", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  projectId: text("project_id").references(() => project.id, {
    onDelete: "cascade",
  }),
  content: text("content").notNull(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const mcpConnection = pgTable("mcp_connection", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  profileId: text("profile_id").notNull(),
  profileRevision: text("profile_revision").notNull(),
  purpose: text("purpose").notNull(),
  profileDigest: text("profile_digest").notNull(),
  label: text("label").notNull(),
  state: text("state").notNull().default("configured"),
  revision: text("revision").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export * from "./job-schema";
export * from "./mcp-catalog-schema";
export * from "./mcp-operation-schema";
export * from "./platform-budget-schema";
