-- Independent of F09/F10. Browser roles have no table access.
CREATE UNIQUE INDEX chat_id_owner_unique ON chat(id,user_id);
CREATE UNIQUE INDEX chat_message_id_chat_owner_unique ON chat_message(id,chat_id,user_id);
CREATE TABLE artifact (
 id text PRIMARY KEY,
 user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
 chat_id text NOT NULL,
 message_id text NOT NULL,
 kind text NOT NULL CHECK(kind IN ('markdown','html')),
 head integer NOT NULL CHECK(head BETWEEN 1 AND 40),
 created_at timestamp NOT NULL DEFAULT now(), updated_at timestamp NOT NULL DEFAULT now(),
 UNIQUE(id,user_id),
 FOREIGN KEY(chat_id,user_id) REFERENCES chat(id,user_id) ON DELETE CASCADE,
 FOREIGN KEY(message_id,chat_id,user_id) REFERENCES chat_message(id,chat_id,user_id) ON DELETE CASCADE
);
CREATE TABLE artifact_revision (
 artifact_id text NOT NULL,
 user_id text NOT NULL,
 version integer NOT NULL CHECK(version BETWEEN 1 AND 40),
 title text NOT NULL CHECK(char_length(title) BETWEEN 1 AND 120),
 content text NOT NULL CHECK(octet_length(content)<=131072),
 restored_from integer,
 created_at timestamp NOT NULL DEFAULT now(),
 PRIMARY KEY(artifact_id,version),
 FOREIGN KEY(artifact_id,user_id) REFERENCES artifact(id,user_id) ON DELETE CASCADE,
 FOREIGN KEY(artifact_id,restored_from) REFERENCES artifact_revision(artifact_id,version) DEFERRABLE INITIALLY DEFERRED
);
ALTER TABLE artifact ADD CONSTRAINT artifact_head_revision FOREIGN KEY(id,head)
 REFERENCES artifact_revision(artifact_id,version) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX artifact_owner_chat ON artifact(user_id,chat_id,updated_at);
CREATE INDEX artifact_revision_owner ON artifact_revision(user_id);
CREATE FUNCTION guard_artifact_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' THEN RAISE EXCEPTION 'artifact revisions are immutable'; END IF;
 IF TG_OP='DELETE' THEN
  IF EXISTS(SELECT 1 FROM artifact WHERE id=OLD.artifact_id) THEN RAISE EXCEPTION 'delete the artifact instead'; END IF;
  RETURN OLD;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER artifact_revision_immutable BEFORE UPDATE OR DELETE ON artifact_revision
 FOR EACH ROW EXECUTE FUNCTION guard_artifact_revision();
CREATE FUNCTION guard_artifact_origin() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF ROW(NEW.id,NEW.user_id,NEW.chat_id,NEW.message_id,NEW.kind,NEW.created_at)
 IS DISTINCT FROM ROW(OLD.id,OLD.user_id,OLD.chat_id,OLD.message_id,OLD.kind,OLD.created_at)
 THEN RAISE EXCEPTION 'artifact origin is immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER artifact_origin_immutable BEFORE UPDATE ON artifact
 FOR EACH ROW EXECUTE FUNCTION guard_artifact_origin();
REVOKE ALL ON artifact, artifact_revision FROM PUBLIC;
DO $$
DECLARE table_name text; role_name text;
BEGIN
 FOREACH table_name IN ARRAY ARRAY['artifact','artifact_revision'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',table_name);
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
   IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM %I',table_name,role_name);
   END IF;
  END LOOP;
 END LOOP;
END $$;
