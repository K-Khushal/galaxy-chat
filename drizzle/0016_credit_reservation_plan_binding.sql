-- Migration 0016: Scoped credit reservation platform budget plan binding.
-- Binds credit reservations to an immutable reviewed platform budget plan.
-- Enforces: all NULL for legacy rows OR all four explicit non-null with strict pattern checks and plan_month = reservation.month.
-- An UPDATE trigger rejects any change to or backfill of plan binding columns.

ALTER TABLE public.credit_reservation
  ADD COLUMN plan_month text,
  ADD COLUMN plan_revision text,
  ADD COLUMN plan_digest text,
  ADD COLUMN plan_capacity_digest text;

ALTER TABLE public.credit_reservation
  ADD CONSTRAINT credit_reservation_plan_month_fk
  FOREIGN KEY (plan_month) REFERENCES public.platform_budget_plan(month);

ALTER TABLE public.credit_reservation
  ADD CONSTRAINT credit_reservation_plan_binding_check CHECK (
    (
      plan_month IS NULL
      AND plan_revision IS NULL
      AND plan_digest IS NULL
      AND plan_capacity_digest IS NULL
    )
    OR (
      plan_month IS NOT NULL
      AND plan_revision IS NOT NULL
      AND plan_digest IS NOT NULL
      AND plan_capacity_digest IS NOT NULL
      AND plan_month = month
      AND plan_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'
      AND plan_revision ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      AND plan_digest ~ '^[a-f0-9]{64}$'
      AND plan_capacity_digest ~ '^[a-f0-9]{64}$'
    )
  );

CREATE INDEX credit_reservation_plan_month ON public.credit_reservation(plan_month);

CREATE OR REPLACE FUNCTION public.credit_reservation_plan_binding_immutable()
RETURNS trigger AS $$
BEGIN
  IF (
    NEW.plan_month IS DISTINCT FROM OLD.plan_month OR
    NEW.plan_revision IS DISTINCT FROM OLD.plan_revision OR
    NEW.plan_digest IS DISTINCT FROM OLD.plan_digest OR
    NEW.plan_capacity_digest IS DISTINCT FROM OLD.plan_capacity_digest
  ) THEN
    RAISE EXCEPTION 'credit reservation plan binding is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER credit_reservation_plan_binding_immutable_trigger
BEFORE UPDATE ON public.credit_reservation
FOR EACH ROW EXECUTE FUNCTION public.credit_reservation_plan_binding_immutable();
