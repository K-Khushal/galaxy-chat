-- Minimal MCP connection registry: strictly owned by verified users; cascades on account deletion.
-- No raw URLs, tokens, secrets, protocol payloads, or fee ledger columns.
CREATE TABLE mcp_connection (
  id text PRIMARY KEY CHECK(id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  profile_id text NOT NULL CHECK(profile_id ~ '^[a-zA-Z0-9_-]{1,80}$'),
  profile_revision text NOT NULL CHECK(profile_revision ~ '^[a-zA-Z0-9_-]{1,80}$'),
  purpose text NOT NULL CHECK(purpose IN ('mcp.initialize', 'mcp.list', 'mcp.call', 'mcp.cancel')),
  profile_digest text NOT NULL CHECK(profile_digest ~ '^[a-f0-9]{64}$'),
  label text NOT NULL CHECK(octet_length(label) BETWEEN 1 AND 64 AND label = btrim(label) AND label !~ '[\r\n\t]'),
  state text NOT NULL DEFAULT 'configured' CHECK(state IN ('configured', 'disabled', 'revoked')),
  revision text NOT NULL CHECK(revision ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX mcp_connection_owner ON mcp_connection(user_id, created_at, id);

REVOKE ALL ON mcp_connection FROM PUBLIC;
DO $$
DECLARE role_name text;
BEGIN
  ALTER TABLE public.mcp_connection ENABLE ROW LEVEL SECURITY;
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
      EXECUTE format('REVOKE ALL ON TABLE public.mcp_connection FROM %I', role_name);
    END IF;
  END LOOP;
END $$;
