-- Concrete operator-configured synchronous MCP runtime; no financial record is removed.
CREATE TABLE mcp_runtime_manifest(digest text PRIMARY KEY CHECK(digest ~ '^[a-f0-9]{64}$'), definition jsonb NOT NULL CHECK(jsonb_typeof(definition)='object' AND octet_length(definition::text)<=100000), created_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE TABLE mcp_runtime_adoption(id text PRIMARY KEY,user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,manifest_digest text NOT NULL REFERENCES mcp_runtime_manifest(digest), initialize_connection text NOT NULL REFERENCES mcp_connection(id) ON DELETE CASCADE, call_connection text NOT NULL REFERENCES mcp_connection(id) ON DELETE CASCADE,catalog_id text NOT NULL REFERENCES mcp_catalog_revision(id) ON DELETE CASCADE,binding jsonb NOT NULL CHECK(jsonb_typeof(binding)='object'),state text NOT NULL DEFAULT 'configured' CHECK(state IN('configured','revoked')),revision integer NOT NULL DEFAULT 1 CHECK(revision>0),created_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE UNIQUE INDEX mcp_runtime_adoption_current ON mcp_runtime_adoption(call_connection) WHERE state='configured';
CREATE TABLE mcp_runtime_execution(id text PRIMARY KEY,user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,run_id text NOT NULL UNIQUE REFERENCES tool_run(id) ON DELETE CASCADE,adoption_id text NOT NULL REFERENCES mcp_runtime_adoption(id) ON DELETE CASCADE,definition jsonb NOT NULL CHECK(jsonb_typeof(definition)='object' AND octet_length(definition::text)<=8192),created_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE TABLE mcp_runtime_frame(id text PRIMARY KEY,execution_id text NOT NULL REFERENCES mcp_runtime_execution(id) ON DELETE CASCADE,user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,ordinal integer NOT NULL CHECK(ordinal BETWEEN 0 AND 2),kind text NOT NULL CHECK(kind IN('initialize','initialized','call')),operation_id text NOT NULL UNIQUE,approval_id text NOT NULL UNIQUE REFERENCES tool_approval(id) ON DELETE CASCADE,tool_call_id text NOT NULL,body jsonb NOT NULL CHECK(jsonb_typeof(body)='object' AND octet_length(body::text)<=8192),binding jsonb NOT NULL CHECK(jsonb_typeof(binding)='object' AND octet_length(binding::text)<=8192),intent jsonb NOT NULL CHECK(jsonb_typeof(intent)='object' AND octet_length(intent::text)<=16384),digest text NOT NULL CHECK(digest ~ '^[a-f0-9]{64}$'),state text NOT NULL DEFAULT 'prepared' CHECK(state IN('prepared','entered','completed','held')),revision integer NOT NULL DEFAULT 1 CHECK(revision>0),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),UNIQUE(execution_id,ordinal),CHECK((ordinal=0 AND kind='initialize')OR(ordinal=1 AND kind='initialized')OR(ordinal=2 AND kind='call')));
-- Anonymous terminal transport evidence is separate from authentic billing receipts.
CREATE TABLE mcp_runtime_evidence(operation_id text PRIMARY KEY REFERENCES mcp_operation(id),digest text NOT NULL UNIQUE CHECK(digest ~ '^[a-f0-9]{64}$'),evidence jsonb NOT NULL CHECK(jsonb_typeof(evidence)='object' AND octet_length(evidence::text)<=4096),created_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE FUNCTION guard_mcp_runtime() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_TABLE_NAME='mcp_runtime_adoption' THEN
  IF ROW(NEW.id,NEW.user_id,NEW.manifest_digest,NEW.initialize_connection,NEW.call_connection,NEW.catalog_id,NEW.binding,NEW.created_at) IS DISTINCT FROM ROW(OLD.id,OLD.user_id,OLD.manifest_digest,OLD.initialize_connection,OLD.call_connection,OLD.catalog_id,OLD.binding,OLD.created_at) OR OLD.state<>'configured' OR NEW.state<>'revoked' OR NEW.revision<>OLD.revision+1 THEN RAISE EXCEPTION 'mcp runtime adoption immutable'; END IF;
 ELSIF TG_TABLE_NAME='mcp_runtime_frame' THEN
  IF ROW(NEW.id,NEW.execution_id,NEW.user_id,NEW.ordinal,NEW.kind,NEW.operation_id,NEW.approval_id,NEW.tool_call_id,NEW.body,NEW.binding,NEW.intent,NEW.digest,NEW.created_at) IS DISTINCT FROM ROW(OLD.id,OLD.execution_id,OLD.user_id,OLD.ordinal,OLD.kind,OLD.operation_id,OLD.approval_id,OLD.tool_call_id,OLD.body,OLD.binding,OLD.intent,OLD.digest,OLD.created_at) OR NEW.revision<>OLD.revision+1 OR NOT((OLD.state='prepared' AND NEW.state='entered')OR(OLD.state='entered' AND NEW.state IN('completed','held'))) THEN RAISE EXCEPTION 'mcp runtime frame immutable or invalid transition'; END IF;
 ELSE RAISE EXCEPTION 'mcp runtime immutable'; END IF; RETURN NEW; END $$;
CREATE TRIGGER mcp_runtime_manifest_guard BEFORE UPDATE OR DELETE ON mcp_runtime_manifest FOR EACH ROW EXECUTE FUNCTION guard_mcp_runtime();
CREATE TRIGGER mcp_runtime_execution_guard BEFORE UPDATE ON mcp_runtime_execution FOR EACH ROW EXECUTE FUNCTION guard_mcp_runtime();
CREATE TRIGGER mcp_runtime_adoption_guard BEFORE UPDATE ON mcp_runtime_adoption FOR EACH ROW EXECUTE FUNCTION guard_mcp_runtime();
CREATE TRIGGER mcp_runtime_frame_guard BEFORE UPDATE ON mcp_runtime_frame FOR EACH ROW EXECUTE FUNCTION guard_mcp_runtime();
CREATE TRIGGER mcp_runtime_evidence_guard BEFORE UPDATE OR DELETE ON mcp_runtime_evidence FOR EACH ROW EXECUTE FUNCTION guard_mcp_runtime();
-- Runtime approvals have the same immutable identity/legal transitions as catalog approvals.
CREATE FUNCTION guard_mcp_runtime_approval() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF EXISTS(SELECT 1 FROM mcp_runtime_frame WHERE approval_id=OLD.id) AND (ROW(NEW.id,NEW.user_id,NEW.run_id,NEW.binding,NEW.expires_at,NEW.created_at) IS DISTINCT FROM ROW(OLD.id,OLD.user_id,OLD.run_id,OLD.binding,OLD.expires_at,OLD.created_at) OR NOT((OLD.state='pending' AND NEW.state IN('approved','denied','revoked'))OR(OLD.state='approved' AND NEW.state IN('revoked','consumed')))) THEN RAISE EXCEPTION 'mcp runtime approval immutable or invalid transition'; END IF; RETURN NEW; END $$;
CREATE TRIGGER mcp_runtime_approval_guard BEFORE UPDATE ON tool_approval FOR EACH ROW EXECUTE FUNCTION guard_mcp_runtime_approval();
ALTER TABLE mcp_operation DROP CONSTRAINT mcp_operation_state_check;
ALTER TABLE mcp_operation ADD CONSTRAINT mcp_operation_state_check CHECK(state IN('reserved','entered','held','completed_unreconciled','settled','released'));
CREATE OR REPLACE FUNCTION guard_mcp_operation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'mcp financial records are retained'; END IF;
 IF ROW(NEW.id,NEW.actor_key,NEW.actor_version,NEW.idempotency_key,NEW.binding_digest,NEW.identity,NEW.fee_snapshot,NEW.month,NEW.day,NEW.reserved_microdollars,NEW.deadline,NEW.created_at) IS DISTINCT FROM ROW(OLD.id,OLD.actor_key,OLD.actor_version,OLD.idempotency_key,OLD.binding_digest,OLD.identity,OLD.fee_snapshot,OLD.month,OLD.day,OLD.reserved_microdollars,OLD.deadline,OLD.created_at) THEN RAISE EXCEPTION 'mcp operation identity is immutable'; END IF;
 IF OLD.state IN('settled','released') OR NEW.incurred_microdollars<OLD.incurred_microdollars OR NEW.revision<>OLD.revision+1 THEN RAISE EXCEPTION 'mcp terminal evidence or incurred minimum is immutable'; END IF;
 IF NOT((OLD.state='reserved' AND NEW.state IN('entered','released'))OR(OLD.state IN('entered','held') AND NEW.state IN('held','settled'))OR(OLD.state='entered' AND NEW.state='completed_unreconciled')OR(OLD.state='completed_unreconciled' AND NEW.state='settled')) THEN RAISE EXCEPTION 'invalid mcp state transition'; END IF;
 IF NEW.state='completed_unreconciled' AND NOT EXISTS(SELECT 1 FROM mcp_runtime_evidence e WHERE e.operation_id=NEW.id) THEN RAISE EXCEPTION 'mcp terminal transport evidence required'; END IF;
 RETURN NEW;END $$;
DO $$ DECLARE t text;r text; BEGIN FOREACH t IN ARRAY ARRAY['mcp_runtime_manifest','mcp_runtime_adoption','mcp_runtime_execution','mcp_runtime_frame','mcp_runtime_evidence'] LOOP EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);EXECUTE format('REVOKE ALL ON TABLE %I FROM PUBLIC',t);FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('REVOKE ALL ON TABLE %I FROM %I',t,r);END IF;END LOOP;END LOOP;END $$;

ALTER TABLE mcp_operation_audit DROP CONSTRAINT mcp_operation_audit_event_check;
ALTER TABLE mcp_operation_audit ADD CONSTRAINT mcp_operation_audit_event_check CHECK(event IN('reserved','entered','held','released','settled','completed_unreconciled'));
-- Stable runtime financial actors survive deletion and actor-key rotation without altering legacy actors.
CREATE TABLE mcp_runtime_principal(principal_digest text PRIMARY KEY CHECK(principal_digest ~ '^[a-f0-9]{64}$'),actor_key text NOT NULL UNIQUE CHECK(actor_key ~ '^[a-f0-9]{64}$'),actor_version text NOT NULL);
CREATE TABLE mcp_runtime_counter_key(id text PRIMARY KEY CHECK(id='counter'),fingerprint text NOT NULL CHECK(fingerprint ~ '^[a-f0-9]{64}$'));
CREATE TRIGGER mcp_runtime_principal_guard BEFORE UPDATE OR DELETE ON mcp_runtime_principal FOR EACH ROW EXECUTE FUNCTION guard_mcp_runtime();
CREATE TRIGGER mcp_runtime_counter_key_guard BEFORE UPDATE OR DELETE ON mcp_runtime_counter_key FOR EACH ROW EXECUTE FUNCTION guard_mcp_runtime();
ALTER TABLE mcp_runtime_principal ENABLE ROW LEVEL SECURITY;
ALTER TABLE mcp_runtime_counter_key ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON mcp_runtime_principal,mcp_runtime_counter_key FROM PUBLIC;
DO $$ DECLARE r text;BEGIN FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r)THEN EXECUTE format('REVOKE ALL ON mcp_runtime_principal,mcp_runtime_counter_key FROM %I',r);END IF;END LOOP;END $$;
ALTER TABLE mcp_runtime_frame ADD CONSTRAINT mcp_runtime_frame_binding_valid CHECK((CASE WHEN jsonb_typeof(binding)='object' AND jsonb_typeof(intent)='object' THEN
 binding ?& ARRAY['runId','toolCallId','tool','toolRevision','connectionRevision','arguments','target','costMicrodollars','runtime']
 AND binding-ARRAY['runId','toolCallId','tool','toolRevision','connectionRevision','arguments','target','costMicrodollars','runtime']='{}'::jsonb
 AND jsonb_typeof(binding->'runId')='string' AND jsonb_typeof(binding->'toolCallId')='string' AND binding->>'toolCallId'=tool_call_id
 AND jsonb_typeof(binding->'toolRevision')='string' AND binding->>'toolRevision'=digest
 AND jsonb_typeof(binding->'arguments')='object' AND jsonb_typeof(binding->'runtime')='object'
 AND binding->'runtime' ?& ARRAY['frameId','digest'] AND (binding->'runtime')-ARRAY['frameId','digest']='{}'::jsonb
 AND jsonb_typeof(binding->'runtime'->'frameId')='string' AND binding->'runtime'->>'frameId'=id
 AND jsonb_typeof(binding->'runtime'->'digest')='string' AND binding->'runtime'->>'digest'=digest
 AND jsonb_typeof(intent->'id')='string' AND intent->>'id'=operation_id
 AND jsonb_typeof(intent->'authority')='object' AND intent->'authority'->>'id'=id AND intent->'authority'->>'digest'=digest
 AND jsonb_typeof(intent->'approval')='object' AND intent->'approval'->>'id'=approval_id
 AND jsonb_typeof(intent->'action')='object' AND intent->'action'->>'digest'=digest
 ELSE false END) IS TRUE);
ALTER TABLE mcp_runtime_evidence ADD CONSTRAINT mcp_runtime_evidence_valid CHECK((CASE WHEN jsonb_typeof(evidence)='object' THEN evidence ?& ARRAY['evidence','signature'] AND evidence-ARRAY['evidence','signature']='{}'::jsonb AND jsonb_typeof(evidence->'signature')='string' AND evidence->>'signature' ~ '^[A-Za-z0-9+/]{86}==$' AND jsonb_typeof(evidence->'evidence')='object' AND evidence->'evidence'->'version'='2'::jsonb AND evidence->'evidence'->>'operationId'=operation_id AND evidence->'evidence'->'phase'='"terminal"'::jsonb AND evidence->'evidence'->'terminal'='true'::jsonb ELSE false END) IS TRUE);
CREATE FUNCTION guard_mcp_runtime_frame_insert()RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM mcp_runtime_execution e JOIN tool_run r ON r.id=e.run_id AND r.user_id=e.user_id JOIN tool_approval a ON a.run_id=r.id AND a.user_id=r.user_id JOIN tool_call k ON k.run_id=r.id AND k.id=NEW.tool_call_id WHERE e.id=NEW.execution_id AND e.user_id=NEW.user_id AND a.id=NEW.approval_id AND a.state='pending' AND a.binding=NEW.binding AND k.name=NEW.binding->>'tool') THEN RAISE EXCEPTION 'mcp runtime frame ownership or approval mismatch';END IF;RETURN NEW;END $$;
CREATE TRIGGER mcp_runtime_frame_insert_guard BEFORE INSERT ON mcp_runtime_frame FOR EACH ROW EXECUTE FUNCTION guard_mcp_runtime_frame_insert();
