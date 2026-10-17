-- Ownership indexes and constraints, version 0001.
-- Conversations stay private to the Better Auth user id. This is not a
-- credit ledger and it does not add attachment storage.
-- Row level security stays enabled with no policies. The server role in
-- DATABASE_URL bypasses it as table owner. anon and authenticated stay revoked.

CREATE TABLE IF NOT EXISTS public.usage_record (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES public."user" (id) ON DELETE CASCADE,
  chat_id text REFERENCES public.chat (id) ON DELETE CASCADE,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS chat_owner_timeline_idx
  ON public.chat (user_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS chat_message_timeline_idx
  ON public.chat_message (chat_id, user_id, created_at ASC, id ASC);

CREATE INDEX IF NOT EXISTS usage_record_owner_timeline_idx
  ON public.usage_record (user_id, created_at ASC, id ASC);

CREATE UNIQUE INDEX IF NOT EXISTS user_github_login_unique
  ON public."user" (lower(github_login))
  WHERE github_login IS NOT NULL AND length(btrim(github_login)) > 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chat_visibility_check'
  ) THEN
    ALTER TABLE public.chat
      ADD CONSTRAINT chat_visibility_check
      CHECK (visibility IN ('private', 'public'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chat_message_role_check'
  ) THEN
    ALTER TABLE public.chat_message
      ADD CONSTRAINT chat_message_role_check
      CHECK (role IN ('system', 'user', 'assistant'));
  END IF;
END $$;

DO $$
DECLARE
  table_name text;
  role_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['usage_record']
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
