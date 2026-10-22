-- Broker-only durable replay ledger. No owner credentials or request bodies.
-- Use a dedicated DB role with SELECT/INSERT, never expose through app routes.
CREATE TABLE public.mcp_egress_nonce (
  request_id uuid PRIMARY KEY,
  expires_at timestamptz NOT NULL
);
CREATE INDEX mcp_egress_nonce_expiry_idx ON public.mcp_egress_nonce (expires_at);
ALTER TABLE public.mcp_egress_nonce ENABLE ROW LEVEL SECURITY;
-- No public policies: the broker requires a separately provisioned restricted
-- role/policy (or trusted table owner). Provisioning is outside this migration.
REVOKE ALL ON public.mcp_egress_nonce FROM PUBLIC;
-- Operator maintenance may delete WHERE expires_at < clock_timestamp(). Keep
-- rows beyond maximum signed-envelope validity; never delete live IDs.
