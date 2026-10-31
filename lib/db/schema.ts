import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import type { AttachmentKind } from "@/lib/attachments/rules";

/** Better Auth tables. Mirrors drizzle/0000_auth.sql. */
export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
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

export const authSchema = { user, session, account, verification };

/** Credits (ADR 0003). Mirrors drizzle/0001_credits.sql. */
export const creditBalance = pgTable("credit_balance", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  remaining: integer("remaining").notNull(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

/** Survives account deletion; see drizzle/0001_credits.sql. */
export const creditGrantIdentity = pgTable("credit_grant_identity", {
  identityHash: text("identity_hash").primaryKey(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type MessageStatus = "complete" | "stopped" | "interrupted" | "failed";
export type MessageRole = "user" | "assistant";
export type PaymentSource = "credits" | "byok";
export type MessageUsage = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  /** USD, as reported by OpenRouter. */
  cost?: number;
};

/** Chats. Mirrors drizzle/0002_chat.sql. */
export const chat = pgTable(
  "chat",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    title: text("title"),
    pinned: boolean("pinned").notNull().default(false),
    archived: boolean("archived").notNull().default(false),
    model: text("model").notNull(),
    activeLeafMessageId: text("active_leaf_message_id"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [index("chat_user_updated_idx").on(table.userId, table.updatedAt)],
);

/** Messages: a tree through parentId. Mirrors drizzle/0002_chat.sql. */
export const message = pgTable(
  "message",
  {
    id: text("id").primaryKey(),
    chatId: text("chat_id")
      .notNull()
      .references(() => chat.id, { onDelete: "cascade" }),
    parentId: text("parent_id"),
    role: text("role").$type<MessageRole>().notNull(),
    parts: jsonb("parts").$type<unknown[]>().notNull().default([]),
    status: text("status").$type<MessageStatus>().notNull(),
    model: text("model"),
    payment: text("payment").$type<PaymentSource>(),
    generationId: text("generation_id"),
    firstTokenAt: timestamp("first_token_at"),
    creditRefunded: boolean("credit_refunded").notNull().default(false),
    usage: jsonb("usage").$type<MessageUsage>(),
    error: text("error"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    index("message_chat_parent_idx").on(
      table.chatId,
      table.parentId,
      table.createdAt,
    ),
  ],
);

/** Encrypted BYOK keys. Mirrors drizzle/0002_chat.sql. */
export const byokKey = pgTable("byok_key", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  provider: text("provider").$type<"openrouter">().notNull(),
  revision: text("revision").notNull(),
  keyVersion: text("key_version").notNull(),
  nonce: text("nonce").notNull(),
  ciphertext: text("ciphertext").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const userSettings = pgTable(
  "user_settings",
  {
    userId: text("user_id")
      .primaryKey()
      .references(() => user.id, { onDelete: "cascade" }),
    aboutYou: text("about_you").notNull().default(""),
    responseInstructions: text("response_instructions").notNull().default(""),
  },
  (table) => [
    check(
      "user_settings_about_you_check",
      sql`length(${table.aboutYou}) <= 2000`,
    ),
    check(
      "user_settings_response_instructions_check",
      sql`length(${table.responseInstructions}) <= 2000`,
    ),
  ],
);

/** Attachments on R2. Mirrors drizzle/0005_attachments.sql. */
export const attachment = pgTable(
  "attachment",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    chatId: text("chat_id").references(() => chat.id, { onDelete: "cascade" }),
    filename: text("filename").notNull(),
    kind: text("kind").$type<AttachmentKind>().notNull(),
    contentType: text("content_type").notNull(),
    size: integer("size").notNull(),
    status: text("status")
      .$type<"pending" | "ready" | "deleted">()
      .notNull()
      .default("pending"),
    presignExpiresAt: timestamp("presign_expires_at", {
      withTimezone: true,
    }).notNull(),
    extractedText: text("extracted_text"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("attachment_chat_idx").on(table.chatId),
    index("attachment_unattached_idx")
      .on(table.userId, table.createdAt)
      .where(sql`${table.chatId} IS NULL`),
    check(
      "attachment_filename_check",
      sql`char_length(${table.filename}) BETWEEN 1 AND 255`,
    ),
    check(
      "attachment_kind_check",
      sql`${table.kind} IN ('image', 'pdf', 'text')`,
    ),
    check(
      "attachment_size_check",
      sql`${table.size} > 0 AND ${table.size} <= 10485760`,
    ),
    check(
      "attachment_status_check",
      sql`${table.status} IN ('pending', 'ready', 'deleted')`,
    ),
  ],
);

// Minimal storage cleanup records deliberately outlive User and Chat cascades.
// Kept for repeated sweeps because expiry does not settle accepted PUTs.
export const attachmentTombstone = pgTable(
  "attachment_tombstone",
  {
    id: text("id").primaryKey(),
    key: text("key").notNull(),
    attempts: integer("attempts").notNull().default(0),
    purgeAfter: timestamp("purge_after", { withTimezone: true }).notNull(),
    nextPurgeAt: timestamp("next_purge_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("attachment_tombstone_purge_idx").on(table.nextPurgeAt)],
);
