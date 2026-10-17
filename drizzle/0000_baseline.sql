-- Galaxy Chat baseline schema, version 0000.
-- Apply with `bun run db:migrate`.
--
-- DATABASE_URL must be the server Postgres role from the Supabase connection
-- string (direct or pooler). It must not be the anon key, the authenticated
-- key, or a browser-exposed value.
-- These tables are owned by that server role. Supabase Auth is not used, and
-- these policies do not depend on a Supabase Auth session.
-- anon and authenticated receive no grants. Row level security is enabled and
-- no policies are created, so PostgREST cannot read or write these tables.
-- OAuth tokens, session tokens, and verification values stay in the server
-- tables below.
--
-- Private storage is separate from this SQL. Create a private bucket whose
-- name matches SUPABASE_STORAGE_BUCKET. Do not add a public read policy. Keep
-- SUPABASE_SECRET_KEY on the server only.

CREATE TABLE IF NOT EXISTS public.schema_migrations (
  version text PRIMARY KEY,
  applied_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public."user" (
  id text PRIMARY KEY,
  name text NOT NULL,
  email text NOT NULL UNIQUE,
  email_verified boolean NOT NULL DEFAULT false,
  image text,
  github_login text,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.session (
  id text PRIMARY KEY,
  expires_at timestamp NOT NULL,
  token text NOT NULL UNIQUE,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  ip_address text,
  user_agent text,
  user_id text NOT NULL REFERENCES public."user" (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS public.account (
  id text PRIMARY KEY,
  account_id text NOT NULL,
  provider_id text NOT NULL,
  user_id text NOT NULL REFERENCES public."user" (id) ON DELETE CASCADE,
  access_token text,
  refresh_token text,
  id_token text,
  access_token_expires_at timestamp,
  refresh_token_expires_at timestamp,
  scope text,
  password text,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.verification (
  id text PRIMARY KEY,
  identifier text NOT NULL,
  value text NOT NULL,
  expires_at timestamp NOT NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.chat (
  id text PRIMARY KEY,
  title text NOT NULL,
  user_id text NOT NULL REFERENCES public."user" (id) ON DELETE CASCADE,
  visibility text NOT NULL DEFAULT 'private',
  last_context jsonb,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.chat_message (
  id text PRIMARY KEY,
  chat_id text NOT NULL REFERENCES public.chat (id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES public."user" (id) ON DELETE CASCADE,
  role text NOT NULL,
  parts jsonb NOT NULL,
  attachments jsonb NOT NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

DO $$
DECLARE
  table_name text;
  role_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'schema_migrations',
    'user',
    'session',
    'account',
    'verification',
    'chat',
    'chat_message'
  ]
  LOOP
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC', table_name);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
    FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated']
    LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
        EXECUTE format(
          'REVOKE ALL ON TABLE public.%I FROM %I',
          table_name,
          role_name
        );
      END IF;
    END LOOP;
  END LOOP;
END $$;
