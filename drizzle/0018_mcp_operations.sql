-- Default-off accounting only: no transport, receipt issuer or OAuth authority.
CREATE TABLE mcp_operation (
 id text PRIMARY KEY,
 actor_key text NOT NULL CHECK(actor_key ~ '^[a-f0-9]{64}$'),
 actor_version text NOT NULL,
 idempotency_key text NOT NULL,
 binding_digest text NOT NULL CHECK(binding_digest ~ '^[a-f0-9]{64}$'),
 identity jsonb NOT NULL CHECK(octet_length(identity::text)<=16384),
 fee_snapshot jsonb NOT NULL CHECK(octet_length(fee_snapshot::text)<=8192),
 month text NOT NULL CHECK(month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
 day date NOT NULL,
 state text NOT NULL CHECK(state IN ('reserved','entered','held','settled','released')),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 reserved_microdollars bigint NOT NULL CHECK(reserved_microdollars BETWEEN 0 AND 10000000),
 incurred_microdollars bigint NOT NULL DEFAULT 0 CHECK(incurred_microdollars BETWEEN 0 AND 9007199254740991),
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 1),
 deadline timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 receipt_id text UNIQUE,
 receipt jsonb,
 UNIQUE(actor_key,idempotency_key),
 CHECK((state IN ('reserved','released'))=(attempts=0)),
 CHECK((state='settled')=(receipt IS NOT NULL)),
 CHECK((receipt_id IS NULL)=(receipt IS NULL)),
 CHECK(state<>'released' OR incurred_microdollars=0),
 CHECK(receipt IS NULL OR (
   receipt->>'id'=receipt_id AND receipt->>'operationId'=id AND receipt->>'bindingDigest'=binding_digest
   AND receipt->>'terminal'='true' AND (receipt->>'incurredMicrodollars')::numeric=incurred_microdollars
 ))
);
CREATE INDEX mcp_operation_actor_day ON mcp_operation(actor_key,day);
CREATE INDEX mcp_operation_state ON mcp_operation(state);
CREATE TABLE mcp_operation_owner (
 operation_id text PRIMARY KEY REFERENCES mcp_operation(id),
 user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
 connection_id text NOT NULL REFERENCES mcp_connection(id) ON DELETE CASCADE
);
CREATE INDEX mcp_operation_owner_user ON mcp_operation_owner(user_id);
CREATE TABLE mcp_actor_alias (
 user_id text PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
 actor_key text NOT NULL,
 key_version text NOT NULL
);
CREATE TABLE mcp_actor_key_version (
 version text PRIMARY KEY,
 fingerprint text NOT NULL CHECK(fingerprint ~ '^[a-f0-9]{64}$')
);
CREATE TABLE mcp_operation_period (
 month text PRIMARY KEY,
 plan_identity jsonb NOT NULL,
 sources_digest text NOT NULL CHECK(sources_digest ~ '^[a-f0-9]{64}$'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE mcp_operation_commitment (
 month text NOT NULL REFERENCES mcp_operation_period(month),
 source_id text NOT NULL REFERENCES mcp_operation(id),
 amount_microdollars bigint NOT NULL CHECK(amount_microdollars BETWEEN 0 AND 9007199254740991),
 PRIMARY KEY(month,source_id)
);
CREATE TABLE mcp_operation_audit (
 id text PRIMARY KEY,
 operation_id text NOT NULL REFERENCES mcp_operation(id),
 event text NOT NULL CHECK(event IN ('reserved','entered','held','released','settled')),
 revision integer NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(operation_id,revision)
);
-- Fixture issuer data is unreachable through the production factory. Owner rows cascade;
-- terminal evidence remains anonymous and immutable even after deletion.
CREATE TABLE mcp_fixture_authority (
 id text PRIMARY KEY,
 user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
 connection_id text NOT NULL REFERENCES mcp_connection(id) ON DELETE CASCADE,
 intent_digest text NOT NULL CHECK(intent_digest ~ '^[a-f0-9]{64}$'),
 fee_digest text NOT NULL CHECK(fee_digest ~ '^[a-f0-9]{64}$'),
 approval_id text UNIQUE,
 authority jsonb NOT NULL,
 expires_at timestamptz NOT NULL,
 consumed_by text UNIQUE REFERENCES mcp_operation(id)
);
CREATE TABLE mcp_fixture_receipt (
 id text PRIMARY KEY,
 operation_id text NOT NULL REFERENCES mcp_operation(id),
 receipt jsonb NOT NULL
);
CREATE FUNCTION guard_mcp_operation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'mcp financial records are retained'; END IF;
 IF ROW(NEW.id,NEW.actor_key,NEW.actor_version,NEW.idempotency_key,NEW.binding_digest,NEW.identity,NEW.fee_snapshot,NEW.month,NEW.day,NEW.reserved_microdollars,NEW.deadline,NEW.created_at)
 IS DISTINCT FROM ROW(OLD.id,OLD.actor_key,OLD.actor_version,OLD.idempotency_key,OLD.binding_digest,OLD.identity,OLD.fee_snapshot,OLD.month,OLD.day,OLD.reserved_microdollars,OLD.deadline,OLD.created_at)
 THEN RAISE EXCEPTION 'mcp operation identity is immutable'; END IF;
 IF OLD.state IN ('settled','released') OR NEW.incurred_microdollars<OLD.incurred_microdollars OR NEW.revision<>OLD.revision+1
 THEN RAISE EXCEPTION 'mcp terminal evidence or incurred minimum is immutable'; END IF;
 IF NOT ((OLD.state='reserved' AND NEW.state IN ('entered','released')) OR (OLD.state IN ('entered','held') AND NEW.state IN ('held','settled')))
 THEN RAISE EXCEPTION 'invalid mcp state transition'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER mcp_operation_guard BEFORE UPDATE OR DELETE ON mcp_operation FOR EACH ROW EXECUTE FUNCTION guard_mcp_operation();
CREATE FUNCTION guard_mcp_fixture_authority() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF ROW(NEW.id,NEW.user_id,NEW.connection_id,NEW.intent_digest,NEW.fee_digest,NEW.approval_id,NEW.authority,NEW.expires_at)
 IS DISTINCT FROM ROW(OLD.id,OLD.user_id,OLD.connection_id,OLD.intent_digest,OLD.fee_digest,OLD.approval_id,OLD.authority,OLD.expires_at)
 OR OLD.consumed_by IS NOT NULL OR NEW.consumed_by IS NULL
 THEN RAISE EXCEPTION 'mcp fixture authority is immutable and single use'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER mcp_fixture_authority_guard BEFORE UPDATE ON mcp_fixture_authority FOR EACH ROW EXECUTE FUNCTION guard_mcp_fixture_authority();
CREATE FUNCTION deny_mcp_record_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'mcp retained record is immutable'; END $$;
DO $$ DECLARE t text; r text; BEGIN
 FOREACH t IN ARRAY ARRAY['mcp_operation_period','mcp_operation_commitment','mcp_operation_audit','mcp_actor_key_version','mcp_fixture_receipt'] LOOP
  EXECUTE format('CREATE TRIGGER mcp_immutable BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION deny_mcp_record_mutation()',t);
 END LOOP;
 FOREACH t IN ARRAY ARRAY['mcp_operation','mcp_operation_owner','mcp_actor_alias','mcp_actor_key_version','mcp_operation_period','mcp_operation_commitment','mcp_operation_audit','mcp_fixture_authority','mcp_fixture_receipt'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON TABLE %I FROM PUBLIC',t);
  FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
   IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('REVOKE ALL ON TABLE %I FROM %I',t,r); END IF;
  END LOOP;
 END LOOP;
END $$;
