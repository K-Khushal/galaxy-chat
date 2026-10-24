-- Migration 0022: durable sandbox approval, funding and execution journal foundation.
-- Accounting and journal only: no provider adapter, no transport route, no worker activation.
-- Financial operation/evidence/audit/retained principal rows are anonymous (actor_key only)
-- and never cascade with owner, job or source payload metadata. Deletion is always denied.

-- Additive extension of the durable jobs registry with the sandbox action revision
-- and its precise terminal error codes; fixture behavior is unchanged.
ALTER TABLE durable_job DROP CONSTRAINT durable_job_action_revision_check;
ALTER TABLE durable_job ADD CONSTRAINT durable_job_action_revision_check
  CHECK(action_revision IN ('publish-fixture-report-v1','sandbox-python-run-v1'));
ALTER TABLE durable_job DROP CONSTRAINT durable_job_error_check;
ALTER TABLE durable_job ADD CONSTRAINT durable_job_error_check
  CHECK(error IN ('job_limits','job_source_unavailable','job_approval_expired','job_invite_required',
    'sandbox_unconfigured','sandbox_approval_expired','sandbox_binding_changed','sandbox_create_rejected',
    'sandbox_create_ambiguous','sandbox_liability_retained','sandbox_execution_unresolved',
    'sandbox_operation_released','sandbox_status_mismatch','sandbox_execution_failed'));

-- Retained principal machinery. The principal digest binds the canonical numeric GitHub
-- account id under a domain-separated secret; account recreation or key rotation never
-- resets limits because the principal row pins the actor key and its key version.
CREATE TABLE sandbox_counter_key (
 id text PRIMARY KEY CHECK(id='counter'),
 fingerprint text NOT NULL CHECK(fingerprint ~ '^[a-f0-9]{64}$'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE sandbox_actor_principal (
 principal_digest text PRIMARY KEY CHECK(principal_digest ~ '^[a-f0-9]{64}$'),
 actor_key text NOT NULL UNIQUE CHECK(actor_key ~ '^[a-f0-9]{64}$'),
 actor_version text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE sandbox_operation (
 id text PRIMARY KEY CHECK(id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
 actor_key text NOT NULL CHECK(actor_key ~ '^[a-f0-9]{64}$'),
 actor_version text NOT NULL,
 idempotency_key text NOT NULL CHECK(idempotency_key ~ '^[a-zA-Z0-9:_-]{1,160}$'),
 binding_digest text NOT NULL CHECK(binding_digest ~ '^[a-f0-9]{64}$'),
 identity jsonb NOT NULL CHECK(jsonb_typeof(identity)='object' AND octet_length(identity::text)<=16384),
 fee_snapshot jsonb NOT NULL CHECK(jsonb_typeof(fee_snapshot)='object' AND octet_length(fee_snapshot::text)<=8192),
 month text NOT NULL CHECK(month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
 day date NOT NULL,
 state text NOT NULL DEFAULT 'reserved' CHECK(state IN ('reserved','entered','held','completed_unreconciled','settled','released')),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 reserved_microdollars bigint NOT NULL CHECK(reserved_microdollars BETWEEN 0 AND 10000000),
 incurred_microdollars bigint NOT NULL DEFAULT 0 CHECK(incurred_microdollars BETWEEN 0 AND 9007199254740991),
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 1),
 deadline timestamptz NOT NULL,
 -- Durable creation tombstone: persisted BEFORE any gateway create call. Once set it is
 -- never cleared; only attempts=0 with a NULL tombstone proves non-entry.
 create_requested_at timestamptz,
 provider_handle text CHECK(provider_handle IS NULL OR octet_length(provider_handle) BETWEEN 1 AND 128),
 receipt_id text UNIQUE,
 receipt jsonb,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(actor_key,idempotency_key),
 CHECK(state<>'reserved' OR (attempts=0 AND create_requested_at IS NULL)),
 CHECK(state NOT IN ('entered','held','completed_unreconciled') OR (attempts=1 AND create_requested_at IS NOT NULL)),
 CHECK(state<>'settled'), -- No authenticated receipt issuer exists in this foundation.
 CHECK((state='settled')=(receipt IS NOT NULL)),
 CHECK((receipt_id IS NULL)=(receipt IS NULL)),
 CHECK(state<>'released' OR (incurred_microdollars=0 AND attempts=0 AND create_requested_at IS NULL)),
 CHECK(provider_handle IS NULL OR attempts=1),
 CHECK(create_requested_at IS NULL OR attempts=1)
);
CREATE INDEX sandbox_operation_actor_day ON sandbox_operation(actor_key,day);
CREATE INDEX sandbox_operation_state ON sandbox_operation(state);
CREATE INDEX sandbox_operation_month ON sandbox_operation(month);
-- Owner/job/source payload metadata cascades with the owner; the financial row above does not.
CREATE TABLE sandbox_operation_owner (
 operation_id text PRIMARY KEY REFERENCES sandbox_operation(id),
 user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
 job_id text NOT NULL REFERENCES durable_job(id) ON DELETE CASCADE,
 source_artifact_id text NOT NULL,
 source_version integer NOT NULL
);
CREATE INDEX sandbox_operation_owner_user ON sandbox_operation_owner(user_id);
-- Durable namespaced carry: prior sandbox holds are frozen per month and never shrink.
CREATE TABLE sandbox_period (
 month text PRIMARY KEY CHECK(month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
 plan_identity jsonb NOT NULL,
 sources_digest text NOT NULL CHECK(sources_digest ~ '^[a-f0-9]{64}$'),
 ordinary_infra_microdollars bigint NOT NULL CHECK(ordinary_infra_microdollars BETWEEN 0 AND 10000000),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE sandbox_operation_commitment (
 month text NOT NULL REFERENCES sandbox_period(month),
 source_id text NOT NULL REFERENCES sandbox_operation(id),
 amount_microdollars bigint NOT NULL CHECK(amount_microdollars BETWEEN 0 AND 9007199254740991),
 PRIMARY KEY(month,source_id)
);
CREATE TABLE sandbox_operation_audit (
 id text PRIMARY KEY CHECK(id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
 operation_id text NOT NULL REFERENCES sandbox_operation(id),
 event text NOT NULL CHECK(event IN ('reserved','entered','held','released','settled','completed_unreconciled')),
 revision integer NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(operation_id,revision)
);
-- Anonymous terminal transport evidence is separate from authentic cost settlement receipts.
CREATE TABLE sandbox_operation_evidence (
 operation_id text NOT NULL REFERENCES sandbox_operation(id),
 ordinal integer NOT NULL CHECK(ordinal BETWEEN 0 AND 15),
 digest text NOT NULL UNIQUE CHECK(digest ~ '^[a-f0-9]{64}$'),
 evidence jsonb NOT NULL CHECK(jsonb_typeof(evidence)='object' AND octet_length(evidence::text)<=8192),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(operation_id,ordinal)
);
CREATE TABLE sandbox_receipt (
 id text PRIMARY KEY CHECK(id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
 operation_id text NOT NULL REFERENCES sandbox_operation(id),
 receipt jsonb NOT NULL CHECK(jsonb_typeof(receipt)='object' AND octet_length(receipt::text)<=8192),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE OR REPLACE FUNCTION sandbox_immutable_deny()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'sandbox financial records are retained: updates and deletes are prohibited';
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION guard_sandbox_operation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'sandbox financial records are retained'; END IF;
 IF ROW(NEW.id,NEW.actor_key,NEW.actor_version,NEW.idempotency_key,NEW.binding_digest,NEW.identity,NEW.fee_snapshot,NEW.month,NEW.day,NEW.reserved_microdollars,NEW.deadline,NEW.created_at) IS DISTINCT FROM ROW(OLD.id,OLD.actor_key,OLD.actor_version,OLD.idempotency_key,OLD.binding_digest,OLD.identity,OLD.fee_snapshot,OLD.month,OLD.day,OLD.reserved_microdollars,OLD.deadline,OLD.created_at) THEN RAISE EXCEPTION 'sandbox operation identity is immutable'; END IF;
 IF OLD.create_requested_at IS NOT NULL AND NEW.create_requested_at IS DISTINCT FROM OLD.create_requested_at THEN RAISE EXCEPTION 'sandbox creation tombstone is immutable'; END IF;
 IF OLD.provider_handle IS NOT NULL AND NEW.provider_handle IS DISTINCT FROM OLD.provider_handle THEN RAISE EXCEPTION 'sandbox provider handle is immutable'; END IF;
 IF NEW.attempts<OLD.attempts OR NEW.incurred_microdollars<OLD.incurred_microdollars OR NEW.revision<>OLD.revision+1 THEN RAISE EXCEPTION 'sandbox incurred minimum or revision is immutable'; END IF;
 IF NOT((OLD.state='reserved' AND NEW.state IN('entered','released'))OR(OLD.state='entered' AND NEW.state IN('entered','held','completed_unreconciled'))OR(OLD.state IN('held','completed_unreconciled') AND NEW.state='held')) THEN RAISE EXCEPTION 'invalid sandbox operation state transition'; END IF;
 IF NEW.state='held' AND NOT EXISTS(SELECT 1 FROM sandbox_operation_evidence e WHERE e.operation_id=NEW.id) THEN RAISE EXCEPTION 'sandbox terminal transport evidence required'; END IF;
 IF NEW.state='completed_unreconciled' AND NOT EXISTS(SELECT 1 FROM sandbox_operation_evidence e WHERE e.operation_id=NEW.id) THEN RAISE EXCEPTION 'sandbox terminal transport evidence required'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER sandbox_operation_guard BEFORE UPDATE OR DELETE ON sandbox_operation FOR EACH ROW EXECUTE FUNCTION guard_sandbox_operation();
CREATE TRIGGER sandbox_operation_owner_guard BEFORE UPDATE ON sandbox_operation_owner FOR EACH ROW EXECUTE FUNCTION sandbox_immutable_deny();
CREATE TRIGGER sandbox_actor_principal_guard BEFORE UPDATE OR DELETE ON sandbox_actor_principal FOR EACH ROW EXECUTE FUNCTION sandbox_immutable_deny();
CREATE TRIGGER sandbox_counter_key_guard BEFORE UPDATE OR DELETE ON sandbox_counter_key FOR EACH ROW EXECUTE FUNCTION sandbox_immutable_deny();
CREATE TRIGGER sandbox_period_guard BEFORE UPDATE OR DELETE ON sandbox_period FOR EACH ROW EXECUTE FUNCTION sandbox_immutable_deny();
CREATE TRIGGER sandbox_operation_commitment_guard BEFORE UPDATE OR DELETE ON sandbox_operation_commitment FOR EACH ROW EXECUTE FUNCTION sandbox_immutable_deny();
CREATE TRIGGER sandbox_operation_audit_guard BEFORE UPDATE OR DELETE ON sandbox_operation_audit FOR EACH ROW EXECUTE FUNCTION sandbox_immutable_deny();
CREATE TRIGGER sandbox_operation_evidence_guard BEFORE UPDATE OR DELETE ON sandbox_operation_evidence FOR EACH ROW EXECUTE FUNCTION sandbox_immutable_deny();
CREATE TRIGGER sandbox_receipt_guard BEFORE UPDATE OR DELETE ON sandbox_receipt FOR EACH ROW EXECUTE FUNCTION sandbox_immutable_deny();

DO $$ DECLARE t text;r text; BEGIN FOREACH t IN ARRAY ARRAY['sandbox_operation','sandbox_operation_owner','sandbox_actor_principal','sandbox_counter_key','sandbox_period','sandbox_operation_commitment','sandbox_operation_audit','sandbox_operation_evidence','sandbox_receipt'] LOOP EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);EXECUTE format('REVOKE ALL ON TABLE %I FROM PUBLIC',t);FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('REVOKE ALL ON TABLE %I FROM %I',t,r);END IF;END LOOP;END LOOP;END $$;
