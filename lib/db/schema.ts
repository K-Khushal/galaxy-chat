import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

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

export const userSettings = pgTable("user_settings", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  aboutYou: text("about_you").notNull().default(""),
  responseInstructions: text("response_instructions").notNull().default(""),
});
