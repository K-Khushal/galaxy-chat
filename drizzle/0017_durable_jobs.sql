-- 0016 is reserved by the independently developed credit-plan binding migration.
-- This engine has no financial lease, provider dispatch, or remote side effects.
CREATE TABLE durable_job (
 id text PRIMARY KEY,
 user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
 source_artifact_id text NOT NULL,
 source_version integer NOT NULL CHECK(source_version BETWEEN 1 AND 40),
 action_revision text NOT NULL DEFAULT 'publish-fixture-report-v1' CHECK(action_revision='publish-fixture-report-v1'),
 state text NOT NULL CHECK(state IN ('queued','running','awaiting_approval','completed','cancelled','failed')),
 checkpoint integer NOT NULL DEFAULT 0 CHECK(checkpoint BETWEEN 0 AND 2),
 checkpoint_digest text CHECK(checkpoint_digest ~ '^[a-f0-9]{64}$'),
 proposal text CHECK(octet_length(proposal)<=4096),
 approval_expires_at timestamptz,
 approved_digest text,
 fence integer NOT NULL DEFAULT 0 CHECK(fence>=0),
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 5),
 lease_expires_at timestamptz,
 started_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 result_artifact_id text,
 error text CHECK(error IN ('job_limits','job_source_unavailable','job_approval_expired','job_invite_required')),
 CHECK((state='running')=(lease_expires_at IS NOT NULL)),
 CHECK(approved_digest IS NULL OR approved_digest=checkpoint_digest),
 CHECK(checkpoint=0 OR (checkpoint_digest IS NOT NULL AND proposal IS NOT NULL)),
 CHECK(state<>'completed' OR (checkpoint=2 AND result_artifact_id IS NOT NULL))
);
CREATE INDEX durable_job_owner_state ON durable_job(user_id,state);
CREATE TABLE durable_job_attempt (
 job_id text NOT NULL REFERENCES durable_job(id) ON DELETE CASCADE,
 fence integer NOT NULL CHECK(fence>0),
 checkpoint integer NOT NULL CHECK(checkpoint BETWEEN 0 AND 1),
 state text NOT NULL CHECK(state IN ('entered','checkpointed','expired','cancelled')),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(job_id,fence)
);
CREATE FUNCTION guard_job_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF ROW(NEW.id,NEW.user_id,NEW.source_artifact_id,NEW.source_version,NEW.action_revision,NEW.created_at)
 IS DISTINCT FROM ROW(OLD.id,OLD.user_id,OLD.source_artifact_id,OLD.source_version,OLD.action_revision,OLD.created_at)
 THEN RAISE EXCEPTION 'job identity is immutable'; END IF;
 IF OLD.checkpoint>0 AND ROW(NEW.checkpoint_digest,NEW.proposal,NEW.approval_expires_at)
 IS DISTINCT FROM ROW(OLD.checkpoint_digest,OLD.proposal,OLD.approval_expires_at)
 THEN RAISE EXCEPTION 'job proposal is immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER durable_job_identity BEFORE UPDATE ON durable_job FOR EACH ROW EXECUTE FUNCTION guard_job_identity();
REVOKE ALL ON durable_job,durable_job_attempt FROM PUBLIC;
DO $$ DECLARE t text; r text; BEGIN
 FOREACH t IN ARRAY ARRAY['durable_job','durable_job_attempt'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
  FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
   IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN
    EXECUTE format('REVOKE ALL ON TABLE %I FROM %I',t,r);
   END IF;
  END LOOP;
 END LOOP;
END $$;
