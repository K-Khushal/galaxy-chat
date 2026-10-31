-- Credits (ADR 0003). One-time sign-up allowance; never renews.
CREATE TABLE "credit_balance" (
  "user_id" text PRIMARY KEY REFERENCES "user"("id") ON DELETE CASCADE,
  "remaining" integer NOT NULL CHECK ("remaining" >= 0),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

-- Keyed hashes of identities (verified email, GitHub/Google account id) that
-- already received Credits. No foreign key on purpose: rows survive account
-- deletion so a returning identity is not granted Credits again.
CREATE TABLE "credit_grant_identity" (
  "identity_hash" text PRIMARY KEY,
  "created_at" timestamp NOT NULL DEFAULT now()
);
