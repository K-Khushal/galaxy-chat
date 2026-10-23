# MCP Client Operations & Production Transport Boundary

This document outlines the operational boundaries, hosted requirements, and safety gates for the GalaxyChat MCP (Model Context Protocol) client transport slice (Child 34).

## 1. Scope: Accepted Local Transport vs. Missing Application Layers

### What Is Implemented in This Slice
- **Strict Default-Off Production Transport**: The client transport module in `lib/mcp/` implements the exact wire protocol defined by the standalone HTTPS egress broker (`services/mcp-egress/src/protocol.ts`).
- **Cloudflare mTLS Binding Integration**: Uses the Cloudflare Workers mTLS fetcher binding named `MCP_EGRESS_MTLS` via `@opennextjs/cloudflare`'s `getCloudflareContext().env`. Fails closed if the binding or configuration is absent or unconfigured. Never falls back to ambient global `fetch` or unauthenticated connections.
- **Protocol & Attestation Conformance**: Version-1 envelope construction with canonical JSON key ordering, SHA-256 body hashing, HMAC-SHA256 request signing with `"galaxy-mcp-egress-v1\n"` prefix, and optional AES-256-GCM credential sealing with strict 9-element AAD binding.
- **Fail-Closed Pre-entry vs. Outcome-Unknown Error Contract**:
  - Failures before network entry (invalid configuration, disabled flag, expired profile, missing binding, pre-entry caller abort, expired deadline) throw `McpPreEntryError` with zero network calls.
  - Failures after network entry (in-flight abort, deadline timeout, transport disconnection, HTTP 3xx manual redirect, non-200 broker response, stream oversize > 96 KiB, malformed JSON, base64 failure, destination mismatch) throw `McpOutcomeUnknownError`. This contract ensures any future financial reservation/hold remains intact when the remote execution state is uncertain.
- **Response Bounds & Strict Validation**:
  - Full transport response bounded to 96 KiB (stream canceled immediately if exceeded).
  - Decoded response body strictly bounded to 64 KiB and profile-specific `maxResponseBytes`.
  - Header allowlist strictly restricted to `content-type`, `mcp-session-id`, and `mcp-protocol-version` (values bounded to 128 printable ASCII characters).
  - Explicit destination attestation validation (`profileId`, `revision`, `purpose`, `address`) matching the exact request. All returned bytes are marked untrusted for downstream callers.

### What Remains MISSING (Explicit Later Local Work)
This slice contains **NO runnable MCP capabilities, UI, routes, or agent tools**:
1. **Local Connections & State Machine**: No connection registration, active/inactive capping, or owner lifecycle in database.
2. **OAuth 2.1 PKCE & Token Storage**: No authorization code exchange, PKCE state verification, token encryption in database, or CAS refresh/revocation.
3. **Immutable Tool Catalog & AST Schema Validation**: No manual tool discovery, no schema depth/property/combinator sanitization, no catalog persistence.
4. **Consequential Action Approvals**: No integration with `tool_approval` or single-use user confirmation flows.
5. **Separate Fee Ledger**: No quote, cap, anonymous reservation, or billing reconciliation for MCP operations.
6. **ToolLoopAgent Integration**: No MCP tool wrappers in the agent loop. All user-facing chat and tool routes reject MCP operations with `403`.

---

## 2. Hosted & Live Production Gates

The following operational requirements are mandatory before enabling `MCP_CLIENT_ENABLED=1` in a hosted deployment:

### Cloudflare mTLS Binding & Non-Proxied Broker Hostname
- **mTLS Binding**: In `wrangler.toml` (or Cloudflare Dashboard), an mTLS certificate binding must be configured:
  ```toml
  [[mtls_certificates]]
  binding = "MCP_EGRESS_MTLS"
  certificate_id = "<provisioned-client-certificate-id>"
  ```
- **Non-Proxied Hostname Gate**: Per Cloudflare runtime documentation, an mTLS client certificate binding **cannot target a Cloudflare-proxied (orange-clouded) zone**. Attempting to send mTLS requests to an orange-clouded endpoint returns an immediate Cloudflare edge error (`520 Web Server Returns an Unknown Error`) because the edge terminates TLS before client certificate negotiation.
  - The broker endpoint (`MCP_CLIENT_BROKER_URL`) must resolve directly to a non-proxied (grey-clouded DNS record) origin, dedicated ingress gateway, or internal network destination where the broker HTTPS listener negotiates client certificates directly against `MCP_EGRESS_CLIENT_CA_FILE`.

### Standalone Broker & Replay Storage
- Standalone broker (`services/mcp-egress`) must be running with `MCP_EGRESS_BROKER_ENABLED=1`.
- A dedicated PostgreSQL instance with migration `0012_mcp_egress_replay.sql` applied must be provisioned with a restricted role for unique replay nonce insertion.

### Cryptographic Key Management
- `MCP_CLIENT_HMAC_KEY` and `MCP_CLIENT_ENVELOPE_KEY` must be generated independently as 32-byte cryptographically random secrets (canonical base64).
- The keys must match the broker's `MCP_EGRESS_HMAC_KEY` and `MCP_EGRESS_ENVELOPE_KEY` exactly, and must be distinct from one another.

### Operator-Reviewed Profiles
- `MCP_CLIENT_PROFILES_JSON` must define reviewed, expiring endpoints. An unreviewed or expired profile will fail closed on every dispatch attempt.
