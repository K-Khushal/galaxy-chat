-- Server-only attachment metadata. Storage stays private; Better Auth owns rows.
CREATE TABLE attachment (
 id text PRIMARY KEY, user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
 chat_id text NOT NULL REFERENCES chat(id) ON DELETE CASCADE,
 object_key text NOT NULL UNIQUE, bucket text NOT NULL,
 name text NOT NULL, media_type text NOT NULL,
 kind text NOT NULL CHECK(kind IN ('text','markdown','pdf','image')),
 bytes integer NOT NULL CHECK(bytes BETWEEN 1 AND 2097152),
 state text NOT NULL CHECK(state IN ('processing','ready','deleting')),
 upload_state text NOT NULL DEFAULT 'reserved' CHECK(upload_state IN ('reserved','entered','terminal')),
 extracted_text text NOT NULL DEFAULT '' CHECK(length(extracted_text)<=24000),
 pages integer CHECK(pages BETWEEN 1 AND 12), sha256 text,
 lease_until timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX attachment_owner_chat ON attachment(user_id,chat_id,created_at);
-- No FK: cleanup must survive account/chat deletion and database cascades.
CREATE TABLE attachment_delete_queue (
 object_key text PRIMARY KEY, bucket text NOT NULL, bytes integer NOT NULL,
 upload_state text NOT NULL CHECK(upload_state IN ('reserved','entered','terminal')),
 not_before timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE attachment_reconciliation (
 object_key text PRIMARY KEY, evidence_sha256 text NOT NULL CHECK(evidence_sha256 ~ '^[a-f0-9]{64}$'),
 reconciled_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE attachment_transfer_budget (
 day date PRIMARY KEY, bytes bigint NOT NULL CHECK(bytes>=0)
);
CREATE FUNCTION queue_attachment_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO attachment_delete_queue(object_key,bucket,bytes,upload_state,not_before)
 VALUES(OLD.object_key,OLD.bucket,OLD.bytes,OLD.upload_state,CASE WHEN OLD.upload_state='entered' THEN GREATEST(now(),OLD.lease_until) ELSE now() END)
 ON CONFLICT(object_key) DO UPDATE SET not_before=GREATEST(attachment_delete_queue.not_before,EXCLUDED.not_before);
 RETURN OLD;
END $$;
CREATE TRIGGER attachment_delete_cleanup BEFORE DELETE ON attachment FOR EACH ROW EXECUTE FUNCTION queue_attachment_delete();
REVOKE ALL ON attachment,attachment_delete_queue,attachment_transfer_budget,attachment_reconciliation FROM PUBLIC;
DO $$
DECLARE table_name text; role_name text;
BEGIN
 FOREACH table_name IN ARRAY ARRAY['attachment','attachment_delete_queue','attachment_transfer_budget','attachment_reconciliation'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',table_name);
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
   IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM %I',table_name,role_name);
   END IF;
  END LOOP;
 END LOOP;
END $$;
