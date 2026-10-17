-- Ciphertext is accessible only to the server role. No browser auth.uid() policy.
CREATE TABLE provider_credential (
 user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
 provider text NOT NULL CHECK (provider IN ('openrouter','gateway')),
 revision text NOT NULL, key_version text NOT NULL, nonce text NOT NULL, ciphertext text NOT NULL,
 masked_key text NOT NULL, test_state text NOT NULL DEFAULT 'untested' CHECK (test_state IN ('untested','valid','invalid','unavailable')),
 tested_at timestamp, updated_at timestamp NOT NULL DEFAULT now(),
 PRIMARY KEY(user_id,provider)
);
CREATE TABLE byok_operation (
 -- Anonymous leases survive account deletion while remote work may still run.
 id text PRIMARY KEY, actor_key text NOT NULL,
 provider text NOT NULL CHECK (provider IN ('openrouter','gateway')), credential_revision text NOT NULL,
 kind text NOT NULL CHECK(kind IN ('chat','test')),
 digest text NOT NULL, state text NOT NULL CHECK(state IN ('reserved','entered','held','complete','released')),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX byok_operation_actor ON byok_operation(actor_key,created_at);
CREATE INDEX byok_operation_state ON byok_operation(state);
REVOKE ALL ON provider_credential, byok_operation FROM PUBLIC;
DO $$
DECLARE table_name text; role_name text;
BEGIN
 FOREACH table_name IN ARRAY ARRAY['provider_credential','byok_operation'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',table_name);
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
   IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM %I',table_name,role_name);
   END IF;
  END LOOP;
 END LOOP;
END $$;
