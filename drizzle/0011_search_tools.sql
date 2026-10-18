CREATE TABLE search_credential (
 user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
 provider text NOT NULL CHECK(provider='tavily'), revision text NOT NULL,
 key_version text NOT NULL, nonce text NOT NULL, ciphertext text NOT NULL,
 masked_key text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(user_id,provider)
);
ALTER TABLE byok_operation DROP CONSTRAINT byok_operation_provider_check;
ALTER TABLE byok_operation ADD CONSTRAINT byok_operation_provider_check CHECK(provider IN ('openrouter','gateway','tavily'));
ALTER TABLE byok_operation DROP CONSTRAINT byok_operation_kind_check;
ALTER TABLE byok_operation ADD CONSTRAINT byok_operation_kind_check CHECK(kind IN ('chat','test','search'));
ALTER TABLE byok_operation
 ADD COLUMN price_revision text,
 ADD COLUMN reserved_microdollars integer,
 ADD COLUMN actual_microdollars integer,
 ADD COLUMN receipt_credits integer,
 ADD CONSTRAINT byok_search_costs CHECK(
   (kind<>'search' AND price_revision IS NULL AND reserved_microdollars IS NULL AND actual_microdollars IS NULL AND receipt_credits IS NULL)
   OR
   (kind='search' AND price_revision IS NOT NULL AND reserved_microdollars>0 AND (actual_microdollars IS NULL OR actual_microdollars BETWEEN 0 AND reserved_microdollars) AND (receipt_credits IS NULL OR receipt_credits=1))
 );
ALTER TABLE tool_call ADD COLUMN search_operation_id text REFERENCES byok_operation(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX tool_call_search_operation ON tool_call(search_operation_id) WHERE search_operation_id IS NOT NULL;
REVOKE ALL ON search_credential FROM PUBLIC;
ALTER TABLE search_credential ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE role_name text;
BEGIN
 FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
   EXECUTE format('REVOKE ALL ON TABLE public.search_credential FROM %I',role_name);
  END IF;
 END LOOP;
END $$;

