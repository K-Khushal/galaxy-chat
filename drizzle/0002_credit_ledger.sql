-- All money is integer microdollars. Actor keys are server HMACs, not user IDs.
-- Audit rows intentionally survive account deletion so spend cannot be reset.
CREATE TABLE public.credit_reservation (
  id text PRIMARY KEY,
  actor_key text NOT NULL,
  actor_kind text NOT NULL CHECK (actor_kind IN ('user', 'guest')),
  idempotency_key text NOT NULL,
  request_digest text NOT NULL,
  day text NOT NULL,
  month text NOT NULL,
  reserved_microdollars integer NOT NULL CHECK (reserved_microdollars > 0),
  charged_microdollars integer NOT NULL CHECK (charged_microdollars >= 0),
  incurred_microdollars integer NOT NULL DEFAULT 0 CHECK (incurred_microdollars >= 0 AND incurred_microdollars <= charged_microdollars),
  state text NOT NULL CHECK (state IN ('reserved', 'entered', 'held', 'settled', 'released')),
  price_snapshot jsonb NOT NULL,
  usage jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(actor_key, idempotency_key)
);
CREATE INDEX credit_reservation_actor_day ON public.credit_reservation(actor_key, day);
CREATE INDEX credit_reservation_month ON public.credit_reservation(month);
CREATE TABLE public.credit_ledger (
  id text PRIMARY KEY,
  reservation_id text NOT NULL REFERENCES public.credit_reservation(id),
  event text NOT NULL,
  microdollars integer NOT NULL CHECK (microdollars >= 0),
  evidence jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.guest_usage (
  actor_key text PRIMARY KEY,
  reservation_id text NOT NULL UNIQUE REFERENCES public.credit_reservation(id),
  used_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.guest_rate (
  network_key text NOT NULL,
  hour text NOT NULL,
  attempts integer NOT NULL CHECK (attempts > 0),
  PRIMARY KEY(network_key, hour)
);
CREATE TABLE public.funding_control (
  id text PRIMARY KEY CHECK (id = 'platform'),
  stopped boolean NOT NULL DEFAULT false
);
INSERT INTO public.funding_control(id) VALUES ('platform');
CREATE FUNCTION public.reject_credit_ledger_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'credit ledger is append only';
END $$;
CREATE TRIGGER credit_ledger_append_only BEFORE UPDATE OR DELETE ON public.credit_ledger
  FOR EACH ROW EXECUTE FUNCTION public.reject_credit_ledger_mutation();
DO $$
DECLARE table_name text; role_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['credit_reservation', 'credit_ledger', 'guest_usage', 'guest_rate', 'funding_control'] LOOP
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC', table_name);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
    FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
        EXECUTE format('REVOKE ALL ON TABLE public.%I FROM %I', table_name, role_name);
      END IF;
    END LOOP;
  END LOOP;
END $$;
