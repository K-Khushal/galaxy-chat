-- Chats, Messages and BYOK keys (issue #69, ADR 0003, ADR 0004).
-- No row here ever means "a Generation is running": that lives in Redis with
-- an expiry, so nothing in Postgres can block a Chat permanently.

CREATE TABLE "chat" (
  "id" text PRIMARY KEY,
  "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "title" text,
  "pinned" boolean NOT NULL DEFAULT false,
  "archived" boolean NOT NULL DEFAULT false,
  "model" text NOT NULL,
  -- The last Message of the Versions currently shown. Set after the message
  -- table exists (circular reference).
  "active_leaf_message_id" text,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX "chat_user_updated_idx" ON "chat" ("user_id", "updated_at" DESC);

-- Messages form a tree through parent_id. Versions are siblings under the
-- same parent; each Message is stored once.
CREATE TABLE "message" (
  "id" text PRIMARY KEY,
  "chat_id" text NOT NULL REFERENCES "chat"("id") ON DELETE CASCADE,
  "parent_id" text REFERENCES "message"("id") ON DELETE CASCADE,
  "role" text NOT NULL CHECK ("role" IN ('user', 'assistant')),
  -- AI SDK UIMessage parts.
  "parts" jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- A running Reply is stored as 'interrupted' with its last checkpoint: that
  -- is exactly what it becomes if its function dies before finishing.
  "status" text NOT NULL
    CHECK ("status" IN ('complete', 'stopped', 'interrupted', 'failed')),
  "model" text,
  "payment" text CHECK ("payment" IN ('credits', 'byok')),
  -- The Generation that owns this Reply, replaced by every start, regenerate
  -- or continue. Checkpoints and final saves only apply while it matches, so
  -- a producer that lost its lock can never overwrite a newer Generation.
  "generation_id" text,
  -- When the owning Generation produced its first token. A credit is only
  -- refunded while this is null (ADR 0003: refund before the first token).
  "first_token_at" timestamp,
  -- Set once, in the same transaction that gives the credit back.
  "credit_refunded" boolean NOT NULL DEFAULT false,
  -- { inputTokens, outputTokens, totalTokens, cost } where known.
  "usage" jsonb,
  "error" text,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CHECK ("role" = 'assistant' OR ("model" IS NULL AND "payment" IS NULL))
);

CREATE INDEX "message_chat_parent_idx"
  ON "message" ("chat_id", "parent_id", "created_at");

-- Replies paid with a credit that may still be owed back: recovery after a
-- crash before the first token scans only these.
CREATE INDEX "message_unsettled_credit_idx" ON "message" ("chat_id")
  WHERE "payment" = 'credits' AND "first_token_at" IS NULL
    AND NOT "credit_refunded" AND "status" = 'interrupted';

ALTER TABLE "chat"
  ADD CONSTRAINT "chat_active_leaf_message_fk"
  FOREIGN KEY ("active_leaf_message_id") REFERENCES "message"("id")
  ON DELETE SET NULL;

-- One encrypted OpenRouter BYOK key per User (lib/byok/crypto.ts). The
-- revision is bound into the ciphertext and changes on every save.
CREATE TABLE "byok_key" (
  "user_id" text PRIMARY KEY REFERENCES "user"("id") ON DELETE CASCADE,
  "provider" text NOT NULL CHECK ("provider" = 'openrouter'),
  "revision" text NOT NULL,
  "key_version" text NOT NULL,
  "nonce" text NOT NULL,
  "ciphertext" text NOT NULL,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);
