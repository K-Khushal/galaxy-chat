-- Owned, untrusted offline metadata only. No operation/receipt/funding references.
CREATE TABLE mcp_catalog_revision (
 id text PRIMARY KEY, user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
 connection_id text NOT NULL REFERENCES mcp_connection(id) ON DELETE CASCADE,
 revision text NOT NULL CHECK(revision ~ '^[a-zA-Z0-9:_-]{1,160}$'),
 connection_revision text NOT NULL, profile jsonb NOT NULL,
 digest text NOT NULL CHECK(digest ~ '^[a-f0-9]{64}$'),
 definition jsonb NOT NULL CHECK(octet_length(definition::text)<=120000),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), UNIQUE(connection_id,revision),
 CHECK((jsonb_typeof(profile)='object' AND profile ?& ARRAY['id','revision','purpose','digest']
   AND jsonb_typeof(profile->'id')='string' AND jsonb_typeof(profile->'revision')='string'
   AND profile->>'id' ~ '^[a-zA-Z0-9:_-]{1,160}$' AND profile->>'revision' ~ '^[a-zA-Z0-9:_-]{1,160}$'
   AND profile->'purpose'='"mcp.call"'::jsonb AND jsonb_typeof(profile->'digest')='string'
   AND profile->>'digest' ~ '^[a-f0-9]{64}$') IS TRUE)
);
CREATE TABLE mcp_catalog_action (
 catalog_id text NOT NULL REFERENCES mcp_catalog_revision(id) ON DELETE CASCADE,
 name text NOT NULL CHECK(name ~ '^[a-zA-Z][a-zA-Z0-9_.-]{0,63}$'),
 digest text NOT NULL CHECK(digest ~ '^[a-f0-9]{64}$'),
 schema_digest text NOT NULL CHECK(schema_digest ~ '^[a-f0-9]{64}$'),
 output_schema_digest text CHECK(output_schema_digest IS NULL OR output_schema_digest ~ '^[a-f0-9]{64}$'),
 definition jsonb NOT NULL CHECK(octet_length(definition::text)<=20000), PRIMARY KEY(catalog_id,name)
);
CREATE TABLE mcp_catalog_head (
 connection_id text PRIMARY KEY REFERENCES mcp_connection(id) ON DELETE CASCADE,
 user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
 catalog_id text NOT NULL REFERENCES mcp_catalog_revision(id) ON DELETE CASCADE,
 revision text NOT NULL, state text NOT NULL CHECK(state IN ('active','revoked'))
);
CREATE TABLE mcp_catalog_admission (
 id text PRIMARY KEY, actor_key text NOT NULL CHECK(actor_key ~ '^[a-f0-9]{64}$'),
 kind text NOT NULL CHECK(kind IN ('revision','proposal')), created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX mcp_catalog_admission_actor ON mcp_catalog_admission(actor_key,kind);
CREATE TABLE mcp_action_proposal (
 id text PRIMARY KEY, revision integer NOT NULL CHECK(revision=1),
 user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
 catalog_id text NOT NULL REFERENCES mcp_catalog_revision(id) ON DELETE CASCADE,
 action_name text NOT NULL, run_id text NOT NULL REFERENCES tool_run(id) ON DELETE CASCADE,
 tool_call_id text NOT NULL, binding jsonb NOT NULL CHECK(octet_length(binding::text)<=8192),
 digest text NOT NULL CHECK(digest ~ '^[a-f0-9]{64}$'),
 approval_id text NOT NULL UNIQUE REFERENCES tool_approval(id) ON DELETE CASCADE,
 approval_digest text NOT NULL CHECK(approval_digest ~ '^[a-f0-9]{64}$'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(catalog_id,action_name) REFERENCES mcp_catalog_action(catalog_id,name) ON DELETE CASCADE,
 FOREIGN KEY(run_id,tool_call_id) REFERENCES tool_call(run_id,id) ON DELETE CASCADE,
 UNIQUE(run_id,tool_call_id),
 CONSTRAINT mcp_proposal_binding_valid CHECK((CASE WHEN jsonb_typeof(binding)='object' THEN
   binding ?& ARRAY['runId','toolCallId','tool','toolRevision','connectionRevision','arguments','target','costMicrodollars','mcp']
   AND binding - ARRAY['runId','toolCallId','tool','toolRevision','connectionRevision','arguments','target','costMicrodollars','mcp']='{}'::jsonb
   AND jsonb_typeof(binding->'runId')='string' AND jsonb_typeof(binding->'toolCallId')='string'
   AND binding->>'runId'=run_id AND binding->>'toolCallId'=tool_call_id
   AND jsonb_typeof(binding->'tool')='string' AND binding->>'tool'='mcp:'||action_name
   AND jsonb_typeof(binding->'toolRevision')='string'
   AND jsonb_typeof(binding->'connectionRevision')='string'
   AND jsonb_typeof(binding->'arguments')='object'
   AND jsonb_typeof(binding->'target')='string' AND binding->>'target' ~ '^[a-zA-Z0-9:_-]{1,160}$'
   AND CASE WHEN jsonb_typeof(binding->'costMicrodollars')='number' THEN
     (binding->>'costMicrodollars')::numeric BETWEEN 0 AND 10000000
     AND trunc((binding->>'costMicrodollars')::numeric)=(binding->>'costMicrodollars')::numeric
   ELSE false END
   AND jsonb_typeof(binding->'mcp')='object'
   AND binding->'mcp' ?& ARRAY['proposal','connection','profile','catalog','action','schemaDigest','outputSchemaDigest','requestDigest','argumentsDigest','targetDigest','feeDigest','plan']
   AND jsonb_typeof(binding->'mcp'->'proposal')='object'
   AND jsonb_typeof(binding->'mcp'->'proposal'->'id')='string'
   AND binding->'mcp'->'proposal'->>'id'=id AND binding->'mcp'->'proposal'->'revision'='1'::jsonb
   AND jsonb_typeof(binding->'mcp'->'proposal'->'digest')='string'
   AND binding->'mcp'->'proposal'->>'digest'=digest
   AND jsonb_typeof(binding->'mcp'->'connection')='object'
   AND jsonb_typeof(binding->'mcp'->'connection'->'id')='string'
   AND jsonb_typeof(binding->'mcp'->'connection'->'revision')='string'
   AND binding->'mcp'->'connection'->>'revision'=binding->>'connectionRevision'
   AND jsonb_typeof(binding->'mcp'->'profile')='object'
   AND jsonb_typeof(binding->'mcp'->'profile'->'id')='string'
   AND jsonb_typeof(binding->'mcp'->'profile'->'revision')='string'
   AND binding->'mcp'->'profile'->'purpose'='"mcp.call"'::jsonb
   AND jsonb_typeof(binding->'mcp'->'profile'->'digest')='string'
   AND binding->'mcp'->'profile'->>'digest' ~ '^[a-f0-9]{64}$'
   AND jsonb_typeof(binding->'mcp'->'catalog')='object'
   AND jsonb_typeof(binding->'mcp'->'catalog'->'id')='string'
   AND binding->'mcp'->'catalog'->>'id'=catalog_id
   AND jsonb_typeof(binding->'mcp'->'catalog'->'revision')='string'
   AND jsonb_typeof(binding->'mcp'->'catalog'->'digest')='string'
   AND binding->'mcp'->'catalog'->>'digest' ~ '^[a-f0-9]{64}$'
   AND jsonb_typeof(binding->'mcp'->'action')='object'
   AND jsonb_typeof(binding->'mcp'->'action'->'name')='string'
   AND binding->'mcp'->'action'->>'name'=action_name
   AND jsonb_typeof(binding->'mcp'->'action'->'digest')='string'
   AND binding->'mcp'->'action'->>'digest'=binding->>'toolRevision'
   AND binding->'mcp'->'action'->>'digest' ~ '^[a-f0-9]{64}$'
   AND jsonb_typeof(binding->'mcp'->'schemaDigest')='string' AND binding->'mcp'->>'schemaDigest' ~ '^[a-f0-9]{64}$'
   AND (binding->'mcp'->'outputSchemaDigest'='null'::jsonb OR (jsonb_typeof(binding->'mcp'->'outputSchemaDigest')='string' AND binding->'mcp'->>'outputSchemaDigest' ~ '^[a-f0-9]{64}$'))
   AND jsonb_typeof(binding->'mcp'->'requestDigest')='string' AND binding->'mcp'->>'requestDigest' ~ '^[a-f0-9]{64}$'
   AND jsonb_typeof(binding->'mcp'->'argumentsDigest')='string' AND binding->'mcp'->>'argumentsDigest' ~ '^[a-f0-9]{64}$'
   AND jsonb_typeof(binding->'mcp'->'targetDigest')='string' AND binding->'mcp'->>'targetDigest' ~ '^[a-f0-9]{64}$'
   AND jsonb_typeof(binding->'mcp'->'feeDigest')='string' AND binding->'mcp'->>'feeDigest' ~ '^[a-f0-9]{64}$'
   AND jsonb_typeof(binding->'mcp'->'plan')='object'
   AND jsonb_typeof(binding->'mcp'->'plan'->'month')='string' AND binding->'mcp'->'plan'->>'month' ~ '^\d{4}-(0[1-9]|1[0-2])$'
   AND jsonb_typeof(binding->'mcp'->'plan'->'revision')='string' AND binding->'mcp'->'plan'->>'revision' ~ '^[a-zA-Z0-9:_-]{1,160}$'
   AND jsonb_typeof(binding->'mcp'->'plan'->'digest')='string' AND binding->'mcp'->'plan'->>'digest' ~ '^[a-f0-9]{64}$'
   AND jsonb_typeof(binding->'mcp'->'plan'->'capacityDigest')='string' AND binding->'mcp'->'plan'->>'capacityDigest' ~ '^[a-f0-9]{64}$'
 ELSE false END) IS TRUE)
);
CREATE FUNCTION guard_mcp_catalog_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'mcp catalog definition is immutable'; END $$;
CREATE TRIGGER mcp_catalog_revision_immutable BEFORE UPDATE ON mcp_catalog_revision FOR EACH ROW EXECUTE FUNCTION guard_mcp_catalog_immutable();
CREATE TRIGGER mcp_catalog_action_immutable BEFORE UPDATE ON mcp_catalog_action FOR EACH ROW EXECUTE FUNCTION guard_mcp_catalog_immutable();
CREATE TRIGGER mcp_action_proposal_immutable BEFORE UPDATE ON mcp_action_proposal FOR EACH ROW EXECUTE FUNCTION guard_mcp_catalog_immutable();
CREATE TRIGGER mcp_catalog_admission_retained BEFORE UPDATE OR DELETE ON mcp_catalog_admission FOR EACH ROW EXECUTE FUNCTION guard_mcp_catalog_immutable();
CREATE FUNCTION guard_mcp_catalog_head() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM mcp_catalog_revision v JOIN mcp_connection c ON c.id=v.connection_id WHERE v.id=NEW.catalog_id AND v.user_id=NEW.user_id AND v.connection_id=NEW.connection_id AND c.user_id=NEW.user_id)
 THEN RAISE EXCEPTION 'invalid mcp catalog head binding'; END IF;
 IF TG_OP='UPDATE' AND (OLD.connection_id<>NEW.connection_id OR OLD.user_id<>NEW.user_id OR OLD.state='revoked' OR NEW.revision=OLD.revision)
 THEN RAISE EXCEPTION 'invalid mcp catalog head transition'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER mcp_catalog_head_guard BEFORE INSERT OR UPDATE ON mcp_catalog_head FOR EACH ROW EXECUTE FUNCTION guard_mcp_catalog_head();
CREATE FUNCTION guard_mcp_proposal_insert() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM tool_approval a JOIN tool_run r ON r.id=a.run_id JOIN mcp_catalog_revision c ON c.id=NEW.catalog_id
   WHERE a.id=NEW.approval_id AND a.user_id=NEW.user_id AND r.user_id=NEW.user_id AND c.user_id=NEW.user_id
   AND a.run_id=NEW.run_id AND a.binding=NEW.binding AND a.state='pending')
 THEN RAISE EXCEPTION 'invalid mcp proposal ownership or approval'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER mcp_proposal_insert_guard BEFORE INSERT ON mcp_action_proposal FOR EACH ROW EXECUTE FUNCTION guard_mcp_proposal_insert();
CREATE FUNCTION guard_mcp_tool_approval() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM mcp_action_proposal p WHERE p.approval_id=OLD.id) THEN
   IF ROW(NEW.id,NEW.user_id,NEW.run_id,NEW.binding,NEW.expires_at,NEW.created_at) IS DISTINCT FROM ROW(OLD.id,OLD.user_id,OLD.run_id,OLD.binding,OLD.expires_at,OLD.created_at)
     OR NOT ((OLD.state='pending' AND NEW.state IN ('approved','denied','revoked')) OR (OLD.state='approved' AND NEW.state IN ('revoked','consumed')))
   THEN RAISE EXCEPTION 'invalid or immutable mcp approval transition'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER mcp_tool_approval_guard BEFORE UPDATE ON tool_approval FOR EACH ROW EXECUTE FUNCTION guard_mcp_tool_approval();
DO $$ DECLARE t text; r text; BEGIN
 FOREACH t IN ARRAY ARRAY['mcp_catalog_revision','mcp_catalog_action','mcp_catalog_head','mcp_catalog_admission','mcp_action_proposal'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON TABLE %I FROM PUBLIC',t);
  FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
   IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('REVOKE ALL ON TABLE %I FROM %I',t,r); END IF;
  END LOOP;
 END LOOP;
END $$;
