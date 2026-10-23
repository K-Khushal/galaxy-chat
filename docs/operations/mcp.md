# MCP Client Operations & Production Transport Boundary

This document outlines the operational boundaries, hosted requirements, and safety gates for the GalaxyChat MCP (Model Context Protocol) client transport and registry slices (Child 34).

## 1. Scope: Accepted Local Layers vs. Missing Application Layers

### What Is Implemented in This Slice
- **Strict Default-Off Production Transport (`lib/mcp/broker-client.ts`)**: The client transport module in `lib/mcp/` implements the exact wire protocol defined by the standalone HTTPS egress broker (`services/mcp-egress/src/protocol.ts`).
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
- **Owned Connection Registry (`0014_mcp_connections.sql`, `lib/mcp/registry-store.ts`)**:
  - Persistent connection UUID owned by Better Auth `user.id` (`ON DELETE CASCADE`).
  - Trimmed UTF-8 label bounded between 1 and 64 bytes (`label = btrim(label)` and no control characters).
  - Immutable binding to exact operator-reviewed `profileId`, `profileRevision`, `purpose`, and canonical profile SHA-256 digest (`profileDigest`).
  - Strict SQL checks on valid UUID format for `id` and `revision`, bounded identifier patterns for `profile_id` and `profile_revision`, and permitted purposes (`mcp.initialize`, `mcp.list`, `mcp.call`, `mcp.cancel`).
  - Explicit states: `configured`, `disabled`, `revoked` (revoked is terminal, no re-enable).
  - CAS concurrency control with required `expectedRevision` on every mutation (disable, enable, revoke, label update, delete).
  - Post-lock recheck: create and re-enable require enabled `McpClientConfig` with unexpired profile and matching snapshot digest; zero edits if operator profile was modified under existing revision.
  - Owner-scoped caps: maximum 5 connections per user (including disabled/revoked until explicitly deleted).
  - Transactional serialization reuses existing `lockByokResources` to maintain global lock order without new lock IDs.
  - Account export returns sanitized `mcpConnections` (no secrets/tokens).

### What Remains MISSING (Explicit Later Local Work)
This slice contains **NO runnable MCP capabilities, UI, routes, or agent tools**:
1. **Separate Fee Ledger**: No quote, cap, anonymous reservation, or billing reconciliation for MCP operations. No charges or platform funding unlocks.
2. **OAuth 2.1 PKCE & Token Storage**: No authorization code exchange, PKCE state verification, token encryption in database, or CAS refresh/revocation.
3. **Immutable Tool Catalog & AST Schema Validation**: No manual tool discovery, no schema depth/property/combinator sanitization, no catalog persistence.
4. **Consequential Action Approvals**: No integration with `tool_approval` or single-use user confirmation flows.
5. **ToolLoopAgent Integration & Network Dispatch**: No MCP tool wrappers in the agent loop. Transport client dispatch is not wired to registry connections; no UI or routes are added.

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

### Operator-Reviewed Profiles & Database Migration
- Database migration `0014_mcp_connections.sql` applied.
- `MCP_CLIENT_PROFILES_JSON` must define reviewed, expiring endpoints. An unreviewed or expired profile will fail closed on every registry create/re-enable attempt.
