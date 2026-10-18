ALTER TABLE byok_operation ADD COLUMN resource_units integer NOT NULL DEFAULT 1 CHECK(resource_units IN (1,3));
CREATE TABLE tool_run (
 id text PRIMARY KEY, user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
 request jsonb NOT NULL, state text NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','running','completed','denied','failed')), answer text NOT NULL DEFAULT '', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX tool_run_owner ON tool_run(user_id);
-- Anonymous counters intentionally survive account cascade; never store prompt, result, key, arguments or target here.
CREATE TABLE tool_step (
 operation_id text NOT NULL REFERENCES byok_operation(id), step integer NOT NULL CHECK(step BETWEEN 0 AND 2),
 input_bytes integer NOT NULL CHECK(input_bytes BETWEEN 0 AND 12000), output_tokens integer NOT NULL CHECK(output_tokens = CASE WHEN step=0 THEN 170 ELSE 171 END),
 state text NOT NULL DEFAULT 'entered' CHECK(state IN ('entered','complete')), PRIMARY KEY(operation_id,step)
);
CREATE TABLE tool_call (
 run_id text NOT NULL REFERENCES tool_run(id) ON DELETE CASCADE, id text NOT NULL, name text NOT NULL,
 state text NOT NULL CHECK(state IN ('queued','running','completed','denied','failed')), output text CHECK(output IS NULL OR octet_length(output)<=4096), PRIMARY KEY(run_id,id)
);
CREATE TABLE tool_approval (
 id text PRIMARY KEY, user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
 run_id text NOT NULL REFERENCES tool_run(id) ON DELETE CASCADE,
 binding jsonb NOT NULL, state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','approved','denied','revoked','consumed')), expires_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
-- The application server role is the only access path, as for the existing owned tables.
REVOKE ALL ON tool_run,tool_step,tool_call,tool_approval FROM PUBLIC;
DO $$
DECLARE table_name text; role_name text;
BEGIN
 FOREACH table_name IN ARRAY ARRAY['tool_run','tool_step','tool_call','tool_approval'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',table_name);
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
   IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM %I',table_name,role_name);
   END IF;
  END LOOP;
 END LOOP;
END $$;
