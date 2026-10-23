-- Generation is default off. No live provider/model/price snapshot is seeded.
ALTER TABLE artifact DROP CONSTRAINT artifact_kind_check;
ALTER TABLE artifact ADD CONSTRAINT artifact_kind_check CHECK(kind IN ('markdown','html','chart','table','image'));
ALTER TABLE byok_operation DROP CONSTRAINT byok_operation_kind_check;
ALTER TABLE byok_operation ADD CONSTRAINT byok_operation_kind_check CHECK(kind IN ('chat','test','search','image'));
CREATE TABLE image_generation (
 id text PRIMARY KEY, user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
 chat_id text NOT NULL, message_id text NOT NULL,
 artifact_id text NOT NULL, expected_head integer NOT NULL CHECK(expected_head BETWEEN 0 AND 39),
 request jsonb NOT NULL CHECK(octet_length(request::text)<=16384),
 model_snapshot jsonb NOT NULL CHECK(octet_length(model_snapshot::text)<=8192),
 state text NOT NULL CHECK(state IN ('reserved','entered','held','complete','failed','cancelled')),
 cancelled boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(chat_id,user_id) REFERENCES chat(id,user_id) ON DELETE CASCADE,
 FOREIGN KEY(message_id,chat_id,user_id) REFERENCES chat_message(id,chat_id,user_id) ON DELETE CASCADE
);
CREATE INDEX image_generation_owner ON image_generation(user_id,created_at);
CREATE UNIQUE INDEX image_generation_active_slot ON image_generation(artifact_id) WHERE state IN ('reserved','entered','held') AND NOT cancelled;
CREATE TABLE image_object (
 id text PRIMARY KEY,user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
 generation_id text NOT NULL UNIQUE REFERENCES image_generation(id) ON DELETE CASCADE,
 chat_id text NOT NULL, artifact_id text, version integer,
 bucket text NOT NULL,object_key text NOT NULL UNIQUE CHECK(object_key ~ '^[a-f0-9]{64}/[a-f0-9-]{36}$'),
 bytes integer NOT NULL CHECK(bytes BETWEEN 1 AND 4194304),
 state text NOT NULL CHECK(state IN ('processing','ready')),
 upload_state text NOT NULL DEFAULT 'reserved' CHECK(upload_state IN ('reserved','entered','terminal')),
 lease_until timestamptz NOT NULL,sha256 text CHECK(sha256 ~ '^[a-f0-9]{64}$'),
 width integer NOT NULL DEFAULT 1024 CHECK(width=1024),height integer NOT NULL DEFAULT 1024 CHECK(height=1024),
 media_type text NOT NULL DEFAULT 'image/png' CHECK(media_type='image/png'),created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(chat_id,user_id) REFERENCES chat(id,user_id) ON DELETE CASCADE,
 FOREIGN KEY(artifact_id,user_id) REFERENCES artifact(id,user_id) ON DELETE CASCADE,
 FOREIGN KEY(artifact_id,version) REFERENCES artifact_revision(artifact_id,version) DEFERRABLE INITIALLY DEFERRED,
 CHECK((state='processing' AND artifact_id IS NULL AND version IS NULL) OR (state='ready' AND artifact_id IS NOT NULL AND version IS NOT NULL AND sha256 IS NOT NULL AND upload_state='terminal'))
);
CREATE TRIGGER image_delete_cleanup BEFORE DELETE ON image_object FOR EACH ROW EXECUTE FUNCTION queue_attachment_delete();
CREATE FUNCTION guard_ready_image() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.state='ready' AND NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'ready images are immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER image_ready_immutable BEFORE UPDATE ON image_object FOR EACH ROW EXECUTE FUNCTION guard_ready_image();
REVOKE ALL ON image_generation,image_object FROM PUBLIC;
DO $$
DECLARE table_name text; role_name text;
BEGIN
 FOREACH table_name IN ARRAY ARRAY['image_generation','image_object'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',table_name);
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
   IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN EXECUTE format('REVOKE ALL ON TABLE public.%I FROM %I',table_name,role_name); END IF;
  END LOOP;
 END LOOP;
END $$;

CREATE FUNCTION delete_artifact_generations() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 DELETE FROM image_generation WHERE artifact_id=OLD.id;
 RETURN OLD;
END $$;
CREATE TRIGGER artifact_images_cleanup BEFORE DELETE ON artifact FOR EACH ROW EXECUTE FUNCTION delete_artifact_generations();

CREATE FUNCTION hold_deleted_image_generation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 UPDATE byok_operation SET state=CASE WHEN state='reserved' THEN 'released' ELSE 'held' END,updated_at=now() WHERE id=OLD.id AND state IN ('reserved','entered','held');
 RETURN OLD;
END $$;
CREATE TRIGGER image_generation_delete_hold BEFORE DELETE ON image_generation FOR EACH ROW EXECUTE FUNCTION hold_deleted_image_generation();
