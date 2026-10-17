-- Branch snapshots preserve original messages and their exact chronological order.
CREATE TABLE chat_branch (
 id text PRIMARY KEY, chat_id text NOT NULL REFERENCES chat(id) ON DELETE CASCADE,
 user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
 parent_id text, label text NOT NULL, messages jsonb NOT NULL DEFAULT '[]',
 created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX chat_branch_owner ON chat_branch(user_id, chat_id);
CREATE TABLE chat_run (
 id text PRIMARY KEY, chat_id text NOT NULL REFERENCES chat(id) ON DELETE CASCADE,
 user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
 branch_id text NOT NULL REFERENCES chat_branch(id) ON DELETE CASCADE,
 digest text NOT NULL, state text NOT NULL CHECK (state IN ('pending','complete','error','stopped')),
 created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX chat_run_owner ON chat_run(user_id, chat_id);
INSERT INTO chat_branch(id, chat_id, user_id, label, messages)
 SELECT c.id, c.id, c.user_id, 'Original', COALESCE(
 (SELECT jsonb_agg(jsonb_build_object('id',m.id,'role',m.role,'parts',m.parts) ORDER BY m.created_at,m.id)
 FROM chat_message m WHERE m.chat_id=c.id AND m.user_id=c.user_id), '[]'::jsonb) FROM chat c;
REVOKE ALL ON chat_branch, chat_run FROM PUBLIC;

DO $$
DECLARE table_name text; role_name text;
BEGIN
 FOREACH table_name IN ARRAY ARRAY['chat_branch','chat_run'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',table_name);
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
   IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM %I',table_name,role_name);
   END IF;
  END LOOP;
 END LOOP;
END $$;
