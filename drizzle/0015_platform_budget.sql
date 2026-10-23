-- Migration 0015: Shared platform budget and immutable durable carry foundation.
-- Enforces immutable, operator-reviewed monthly plans bounded by $10 total platform ceiling.
-- Carried legacy credit liability snapshots are permanently preserved across month rollovers and account deletions.

CREATE TABLE platform_budget_plan (
  month text PRIMARY KEY CHECK(month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  revision text NOT NULL CHECK(revision ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  digest text NOT NULL CHECK(digest ~ '^[a-f0-9]{64}$'),
  b_selected integer NOT NULL CHECK(b_selected BETWEEN 0 AND 10000000),
  a_credit integer NOT NULL CHECK(a_credit >= 0),
  a_mcp integer NOT NULL CHECK(a_mcp >= 0),
  k_infra integer NOT NULL CHECK(k_infra >= 0),
  k_provider_fees integer NOT NULL CHECK(k_provider_fees >= 0),
  k_safety integer NOT NULL CHECK(k_safety >= 0),
  l_carried integer NOT NULL CHECK(l_carried >= 0),
  reviewed_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL CHECK(expires_at > reviewed_at),
  coverage_proof_reference text NOT NULL CHECK(octet_length(coverage_proof_reference) BETWEEN 1 AND 256),
  coverage_proof_digest text NOT NULL CHECK(coverage_proof_digest ~ '^[a-f0-9]{64}$'),
  coverage_assertions jsonb NOT NULL,
  capacity_snapshot jsonb NOT NULL,
  capacity_digest text NOT NULL CHECK(capacity_digest ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT platform_budget_plan_ceiling_check CHECK(a_credit + a_mcp + k_infra + k_provider_fees + k_safety + l_carried <= b_selected),
  CONSTRAINT platform_budget_plan_zero_allocation_check CHECK((b_selected = 0 AND a_credit = 0 AND a_mcp = 0 AND k_infra = 0 AND k_provider_fees = 0 AND k_safety = 0 AND l_carried = 0) OR b_selected > 0)
);

CREATE TABLE platform_budget_carry (
  id text PRIMARY KEY CHECK(id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  month text NOT NULL REFERENCES platform_budget_plan(month) CHECK(month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  source_reservation_id text NOT NULL CHECK(source_reservation_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  actor_key text NOT NULL CHECK(actor_key ~ '^[a-f0-9]{64}$'),
  amount_microdollars integer NOT NULL CHECK(amount_microdollars > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT platform_budget_carry_month_source_unique UNIQUE(month, source_reservation_id)
);

CREATE INDEX platform_budget_carry_month ON platform_budget_carry(month, created_at);

CREATE OR REPLACE FUNCTION platform_budget_immutable_deny()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'table is append-only: updates and deletes are prohibited';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER platform_budget_plan_no_update_delete
BEFORE UPDATE OR DELETE ON platform_budget_plan
FOR EACH ROW EXECUTE FUNCTION platform_budget_immutable_deny();

CREATE TRIGGER platform_budget_carry_no_update_delete
BEFORE UPDATE OR DELETE ON platform_budget_carry
FOR EACH ROW EXECUTE FUNCTION platform_budget_immutable_deny();

REVOKE ALL ON platform_budget_plan FROM PUBLIC;
REVOKE ALL ON platform_budget_carry FROM PUBLIC;

DO $$
DECLARE role_name text;
BEGIN
  ALTER TABLE public.platform_budget_plan ENABLE ROW LEVEL SECURITY;
  ALTER TABLE public.platform_budget_carry ENABLE ROW LEVEL SECURITY;
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
      EXECUTE format('REVOKE ALL ON TABLE public.platform_budget_plan FROM %I', role_name);
      EXECUTE format('REVOKE ALL ON TABLE public.platform_budget_carry FROM %I', role_name);
    END IF;
  END LOOP;
END $$;
