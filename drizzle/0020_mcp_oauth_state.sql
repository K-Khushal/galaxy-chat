-- Local synthetic OAuth lifecycle only. 0019 is reserved on the separate catalog branch.
CREATE FUNCTION mcp_oauth_sealed_valid(v jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
 SELECT (CASE WHEN jsonb_typeof(v)='object' THEN
 v ?& ARRAY['keyVersion','nonce','ciphertext'] AND v-ARRAY['keyVersion','nonce','ciphertext']='{}'::jsonb
 AND jsonb_typeof(v->'keyVersion')='string' AND v->>'keyVersion' ~ '^[a-zA-Z0-9:_-]{1,160}$'
 AND jsonb_typeof(v->'nonce')='string' AND v->>'nonce' ~ '^[A-Za-z0-9+/]{16}$'
 AND jsonb_typeof(v->'ciphertext')='string' AND length(v->>'ciphertext') BETWEEN 24 AND 11000 AND v->>'ciphertext' ~ '^[A-Za-z0-9+/]+={0,2}$'
 ELSE false END) IS TRUE
$$;
CREATE TABLE mcp_oauth_binding (
 id text PRIMARY KEY, user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
 connection_id text NOT NULL REFERENCES mcp_connection(id) ON DELETE CASCADE,
 connection_revision text NOT NULL, connection_profile_digest text NOT NULL CHECK(connection_profile_digest ~ '^[a-f0-9]{64}$'),
 purpose text NOT NULL CHECK(purpose IN ('oauth.resource','oauth.discovery','oauth.token','oauth.refresh','oauth.revoke')),
 profile_id text NOT NULL, profile_revision text NOT NULL, profile_digest text NOT NULL CHECK(profile_digest ~ '^[a-f0-9]{64}$'),
 manifest_digest text NOT NULL CHECK(manifest_digest ~ '^[a-f0-9]{64}$'), manifest jsonb NOT NULL CHECK(jsonb_typeof(manifest)='object' AND octet_length(manifest::text)<=16384),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0), state text NOT NULL DEFAULT 'configured' CHECK(state IN ('configured','revoked')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE UNIQUE INDEX mcp_oauth_binding_current ON mcp_oauth_binding(connection_id,purpose) WHERE state='configured';
CREATE TABLE mcp_oauth_state (
 id text PRIMARY KEY, user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
 binding_id text NOT NULL REFERENCES mcp_oauth_binding(id) ON DELETE CASCADE,
 connection_id text NOT NULL REFERENCES mcp_connection(id) ON DELETE CASCADE,
 state_hash text NOT NULL UNIQUE CHECK(state_hash ~ '^[a-f0-9]{64}$'), session_hash text NOT NULL CHECK(session_hash ~ '^[a-f0-9]{64}$'),
 redirect_uri text NOT NULL, verifier jsonb, challenge text NOT NULL CHECK(challenge ~ '^[A-Za-z0-9_-]{43}$'),
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','consumed','issued','revoked')),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0), expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CONSTRAINT mcp_oauth_state_secret CHECK((state='pending' AND verifier IS NOT NULL AND mcp_oauth_sealed_valid(verifier)) OR (state<>'pending' AND verifier IS NULL)),
 CHECK(expires_at>created_at AND expires_at<=created_at+interval '10 minutes')
);
CREATE UNIQUE INDEX mcp_oauth_state_current ON mcp_oauth_state(connection_id) WHERE state='pending';
CREATE TABLE mcp_oauth_grant (
 id text PRIMARY KEY, user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
 connection_id text NOT NULL REFERENCES mcp_connection(id) ON DELETE CASCADE,
 binding_id text NOT NULL REFERENCES mcp_oauth_binding(id) ON DELETE CASCADE,
 state_id text NOT NULL UNIQUE REFERENCES mcp_oauth_state(id) ON DELETE CASCADE,
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0), refresh_fence integer NOT NULL DEFAULT 0 CHECK(refresh_fence>=0),
 state text NOT NULL DEFAULT 'active' CHECK(state IN ('active','uncertain','revoked')),
 access_secret jsonb, refresh_secret jsonb, expires_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK(isfinite(expires_at) AND expires_at>created_at),
 CONSTRAINT mcp_oauth_grant_secrets CHECK((CASE WHEN state='revoked' THEN access_secret IS NULL AND refresh_secret IS NULL ELSE access_secret IS NOT NULL AND mcp_oauth_sealed_valid(access_secret) AND (refresh_secret IS NULL OR mcp_oauth_sealed_valid(refresh_secret)) END) IS TRUE)
);
CREATE UNIQUE INDEX mcp_oauth_grant_current ON mcp_oauth_grant(connection_id) WHERE state IN ('active','uncertain');
CREATE TABLE mcp_oauth_refresh (
 id text PRIMARY KEY, user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
 grant_id text NOT NULL REFERENCES mcp_oauth_grant(id) ON DELETE CASCADE,
 binding_id text NOT NULL REFERENCES mcp_oauth_binding(id) ON DELETE CASCADE,
 credential_revision integer NOT NULL CHECK(credential_revision>0), fence integer NOT NULL CHECK(fence>0),
 state text NOT NULL DEFAULT 'reserved' CHECK(state IN ('reserved','entered','replaced','unknown','cancelled')),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0), deadline timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(grant_id,fence), CHECK(deadline>created_at AND deadline<=created_at+interval '20 seconds')
);
CREATE UNIQUE INDEX mcp_oauth_refresh_current ON mcp_oauth_refresh(grant_id) WHERE state IN ('reserved','entered','unknown');
-- Anonymous abuse counters survive owner/connection deletion; never contain secrets or URLs.
CREATE TABLE mcp_oauth_record (
 id text PRIMARY KEY, actor_key text NOT NULL CHECK(actor_key ~ '^[a-f0-9]{64}$'),
 kind text NOT NULL CHECK(kind IN ('binding','state','grant','refresh','unknown')), day date NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX mcp_oauth_record_actor_day ON mcp_oauth_record(actor_key,day);
CREATE TABLE mcp_oauth_counter_key (id text PRIMARY KEY CHECK(id='counter'), fingerprint text NOT NULL CHECK(fingerprint ~ '^[a-f0-9]{64}$'));
CREATE FUNCTION guard_mcp_oauth() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_TABLE_NAME='mcp_oauth_binding' THEN
  IF ROW(NEW.id,NEW.user_id,NEW.connection_id,NEW.connection_revision,NEW.connection_profile_digest,NEW.purpose,NEW.profile_id,NEW.profile_revision,NEW.profile_digest,NEW.manifest_digest,NEW.manifest,NEW.created_at) IS DISTINCT FROM ROW(OLD.id,OLD.user_id,OLD.connection_id,OLD.connection_revision,OLD.connection_profile_digest,OLD.purpose,OLD.profile_id,OLD.profile_revision,OLD.profile_digest,OLD.manifest_digest,OLD.manifest,OLD.created_at) OR OLD.state<>'configured' OR NEW.state<>'revoked' OR NEW.revision<>OLD.revision+1 THEN RAISE EXCEPTION 'mcp oauth binding immutable'; END IF;
 ELSIF TG_TABLE_NAME='mcp_oauth_state' THEN
  IF ROW(NEW.id,NEW.user_id,NEW.binding_id,NEW.connection_id,NEW.state_hash,NEW.session_hash,NEW.redirect_uri,NEW.challenge,NEW.expires_at,NEW.created_at) IS DISTINCT FROM ROW(OLD.id,OLD.user_id,OLD.binding_id,OLD.connection_id,OLD.state_hash,OLD.session_hash,OLD.redirect_uri,OLD.challenge,OLD.expires_at,OLD.created_at) OR NEW.revision<>OLD.revision+1 OR NOT ((OLD.state='pending' AND NEW.state IN ('consumed','revoked')) OR (OLD.state='consumed' AND NEW.state IN ('issued','revoked'))) THEN RAISE EXCEPTION 'mcp oauth state immutable or already consumed'; END IF;
 ELSIF TG_TABLE_NAME='mcp_oauth_grant' THEN
  IF ROW(NEW.id,NEW.user_id,NEW.connection_id,NEW.binding_id,NEW.state_id,NEW.created_at) IS DISTINCT FROM ROW(OLD.id,OLD.user_id,OLD.connection_id,OLD.binding_id,OLD.state_id,OLD.created_at) OR NEW.revision<>OLD.revision+1 OR OLD.state='revoked' OR (OLD.state='uncertain' AND NEW.state<>'revoked') OR NEW.refresh_fence<OLD.refresh_fence OR NEW.refresh_fence>OLD.refresh_fence+1 THEN RAISE EXCEPTION 'mcp oauth grant immutable or invalid revision'; END IF;
 ELSIF TG_TABLE_NAME='mcp_oauth_refresh' THEN
  IF ROW(NEW.id,NEW.user_id,NEW.grant_id,NEW.binding_id,NEW.credential_revision,NEW.fence,NEW.deadline,NEW.created_at) IS DISTINCT FROM ROW(OLD.id,OLD.user_id,OLD.grant_id,OLD.binding_id,OLD.credential_revision,OLD.fence,OLD.deadline,OLD.created_at) OR NEW.revision<>OLD.revision+1 OR NOT ((OLD.state='reserved' AND NEW.state IN ('entered','cancelled')) OR (OLD.state='entered' AND NEW.state IN ('replaced','unknown'))) THEN RAISE EXCEPTION 'mcp oauth refresh immutable or invalid transition'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE FUNCTION deny_mcp_oauth_record_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'mcp oauth anonymous record immutable'; END $$;
DO $$ DECLARE t text; r text; BEGIN
 FOREACH t IN ARRAY ARRAY['mcp_oauth_binding','mcp_oauth_state','mcp_oauth_grant','mcp_oauth_refresh'] LOOP
  EXECUTE format('CREATE TRIGGER mcp_oauth_guard BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION guard_mcp_oauth()',t);
 END LOOP;
 FOREACH t IN ARRAY ARRAY['mcp_oauth_record','mcp_oauth_counter_key'] LOOP
  EXECUTE format('CREATE TRIGGER mcp_oauth_retained BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION deny_mcp_oauth_record_mutation()',t);
 END LOOP;
 FOREACH t IN ARRAY ARRAY['mcp_oauth_binding','mcp_oauth_state','mcp_oauth_grant','mcp_oauth_refresh','mcp_oauth_record','mcp_oauth_counter_key'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON TABLE %I FROM PUBLIC',t);
  FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
   IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('REVOKE ALL ON TABLE %I FROM %I',t,r); END IF;
  END LOOP;
 END LOOP;
END $$;

-- Cascading secret deletion cannot erase an entered refresh's anonymous uncertainty.
CREATE FUNCTION retain_mcp_oauth_deleted_refresh() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.state IN ('entered','unknown') THEN
  INSERT INTO mcp_oauth_record(id,actor_key,kind,day) SELECT 'unknown:'||OLD.id,actor_key,'unknown',(clock_timestamp() AT TIME ZONE 'UTC')::date FROM mcp_oauth_record WHERE id=OLD.id AND kind='refresh' ON CONFLICT DO NOTHING;
 END IF;
 RETURN OLD;
END $$;
CREATE TRIGGER mcp_oauth_refresh_deletion BEFORE DELETE ON mcp_oauth_refresh FOR EACH ROW EXECUTE FUNCTION retain_mcp_oauth_deleted_refresh();
