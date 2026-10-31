-- Attachments (issue #72). The file itself lives in R2 under
-- u/<user_id>/<id>; this row is the source of truth for what exists, who owns
-- it and whether it has been verified. A row is created before its upload URL
-- is handed out, so every object in the bucket has a row (or a cleanup path).
-- Browser PUTs conditionally to the final key; confirm only validates.

CREATE TABLE "attachment" (
  "id" text PRIMARY KEY,
  "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  -- Set when a Message of this Chat first uses the file; null until then.
  -- Deleting the Chat deletes the row (its object is deleted by the app first).
  "chat_id" text REFERENCES "chat"("id") ON DELETE CASCADE,
  "filename" text NOT NULL CHECK (char_length("filename") BETWEEN 1 AND 255),
  "kind" text NOT NULL CHECK ("kind" IN ('image', 'pdf', 'text')),
  -- Canonical type signed into the upload; verified against the object.
  "content_type" text NOT NULL,
  -- Declared at presign, replaced by the object's real size on confirm.
  "size" integer NOT NULL CHECK ("size" > 0 AND "size" <= 10485760),
  "status" text NOT NULL DEFAULT 'pending' CHECK ("status" IN ('pending', 'ready', 'deleted')),
  "presign_expires_at" timestamptz NOT NULL,
  -- Text taken from a PDF for models that cannot read PDFs; filled on first use.
  "extracted_text" text,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX "attachment_chat_idx" ON "attachment" ("chat_id");

-- Lazy cleanup and the per-User cap scan only files no Message uses yet.
CREATE INDEX "attachment_unattached_idx" ON "attachment" ("user_id", "created_at")
  WHERE "chat_id" IS NULL;


-- No foreign keys: cleanup must survive account and Chat deletion.
-- Keep keys for repeated sweeps of writes accepted before URL expiry.
CREATE TABLE "attachment_tombstone" (
  "id" text PRIMARY KEY,
  "key" text NOT NULL,
  "attempts" integer NOT NULL DEFAULT 0,
  "purge_after" timestamptz NOT NULL,
  "next_purge_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX "attachment_tombstone_purge_idx" ON "attachment_tombstone" ("next_purge_at");
