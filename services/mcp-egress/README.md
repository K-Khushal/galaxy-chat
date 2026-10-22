# MCP egress broker — local review slice

Standalone Node 22 HTTPS policy executor. This implements the transport/ingress
boundary from F13-C; it does not enable MCP in Galaxy Chat. The app does not call
this service. OAuth consent/callbacks, a complete MCP client/session adapter,
connection UI, owner revisions, approvals and the funding ledger remain later
work. There is no configured live endpoint, provider, fee contract or deployment.

## Local checks

Use the root repository's existing dependencies; no new install is needed.
From the repository root (serialize these with the shared check wrapper when
other Galaxy branches are running):

```sh
npm --prefix services/mcp-egress run check
npm --prefix services/mcp-egress run test
npm --prefix services/mcp-egress run build
npm --prefix services/mcp-egress run start
```

`start` exits silently without opening sockets unless
`MCP_EGRESS_BROKER_ENABLED=1`. Tests require Node 22+ and local OpenSSL to generate
a temporary CA. The `.node.ts` names deliberately keep this suite out of Bun's
app test discovery: native Node HTTPS/TLS behavior is the security boundary.
Tests use only loopback TLS/SQL sockets and injected DNS; no public DNS, MCP,
OAuth, provider, login, paid or cloud calls occur.

The TLS fixture calls the same `pinnedHttps` implementation as production. Its
injected dial maps the public test pin to loopback and presents that mapped peer
address to the production socket check. Separate tests deliberately present a
different peer address and assert **zero plaintext HTTP bytes**. The fixture does
not prove an external network route. The replay fixture exercises the production
Postgres adapter and migration through a PostgreSQL-compatible PGlite socket,
with two broker/store instances sharing its single backend. Real PostgreSQL
multi-session/process durability, restricted-role policies and network failure
behavior still require deployment review.

## Configuration and profiles

All `MCP_EGRESS_*` settings are explicitly allowlisted in `src/config.ts`. Missing,
unknown or malformed enabled configuration fails closed with one scrubbed code.
No HTTP proxy, custom upstream CA, resolver, dial, redirect or arbitrary header
setting exists. The only upstream trust roots are Node's normal roots; operators
must also review runtime-wide Node trust/loader settings in the eventual host.

Required settings when enabled:

- `MCP_EGRESS_HMAC_KEY` and `MCP_EGRESS_ENVELOPE_KEY`: **different**, independently
  generated 32-byte secrets, canonical base64. Never place these in profile JSON.
- `MCP_EGRESS_PROFILES_FILE`: operator-controlled JSON array (1–32 entries).
- `MCP_EGRESS_DATABASE_URL`: production Postgres connection. Unless `NODE_ENV` is
  explicitly `development` or `test`, durable replay is mandatory. Startup probes
  the nonce primary key, read access and rolled-back insert access before listen.

Default bind is `127.0.0.1:8788`; `::1` is also allowed. Wildcard binds `0.0.0.0` or
`::` require `MCP_EGRESS_REMOTE_BIND=1` and all three
`MCP_EGRESS_TLS_KEY_FILE`, `MCP_EGRESS_TLS_CERT_FILE`, and
`MCP_EGRESS_CLIENT_CA_FILE`. Those are **ingress** credentials: the HTTPS server
requires a verified client certificate and the HMAC. No other bind spelling or
hostname is accepted. Optional concurrency/connection caps are
`MCP_EGRESS_CONCURRENCY` (default 4, max 32) and
`MCP_EGRESS_MAX_CONNECTIONS` (default 32, max 128).

A profile is immutable `{profileId, revision, purpose}` policy. This example is
illustrative only, uses reserved example domains, and is not an approved server:

```json
[{
  "profileId": "operator-reviewed",
  "revision": "r1",
  "purpose": "mcp.call",
  "endpoint": "https://mcp.example/mcp",
  "contentType": "application/json",
  "responseTypes": ["application/json"],
  "maxRequestBytes": 65536,
  "maxResponseBytes": 65536,
  "timeoutMs": 20000,
  "connectMs": 3000,
  "firstByteMs": 5000,
  "resource": "https://mcp.example/mcp",
  "issuer": "https://issuer.example/",
  "credential": "bearer"
}]
```

Closed purposes are `mcp.initialize/list/call/cancel` (POST),
`oauth.resource/discovery` (GET), and `oauth.token/refresh/revoke` (POST).
Only canonical lowercase ASCII DNS HTTPS URLs are accepted. IP literals, IDNA,
trailing dots, userinfo, fragments, **every query string**, encoded/dot-segment
paths, alternate numeric spellings and noncanonical default ports are denied for
endpoint, issuer and resource. Reviewed nondefault HTTPS ports are supported.
Metadata-discovered URLs have no way to become destinations through ingress.
Every DNS answer is checked on every operation against the source-controlled
conservative special-purpose CIDR policy; one nonpublic answer rejects the set.
IPv4-mapped IPv6 and transition ranges are rejected. The policy intentionally
excludes some globally reachable special-purpose ranges too.

Credentials are `none` or `bearer` for MCP; `none` for metadata/code exchange;
`refresh` and `revoke` for their respective OAuth purposes. OAuth token operations
require `application/x-www-form-urlencoded` and fixed reviewed `formFields`:
`client_id` is required; `redirect_uri` is required only for code exchange;
`scope` is optional and fixed. Code exchange accepts only caller `code` and
`code_verifier`. Refresh/revoke accept no caller form fields. Broker code adds
the fixed resource, grant type and encrypted token. Optional `clientSecretRef`
(token/refresh/revoke only) looks up a secret in `MCP_EGRESS_SECRETS_FILE`, a
separate operator-controlled JSON map; secrets in profiles are rejected.
Client authentication here supports form `client_secret_post` only. A full OAuth
implementation must explicitly review that method and PKCE/state/issuer behavior.

## Protocol and boundary

There is one `POST /v1/egress` JSON endpoint, 96 KiB ingress bound, 8 KiB headers,
connection/concurrency limits and header/body/idle timeouts. The version-1 envelope
has request/operation UUIDs, issued-at/deadline milliseconds, profile/revision,
closed purpose, canonical-base64 body plus SHA-256 body hash, and optional sealed
credential. `src/protocol.ts` defines the exact canonical field order and HMAC
prefix; the signature goes in `X-MCP-Signature`. Unknown fields are rejected.
Clock skew is at most 30 seconds; deadline is at most issued-at plus 20 seconds.
The future app must supply the **remaining run** deadline, rather than renewing
that budget per operation. No whole-run approval or funding claim is made here.

Authentication precedes durable nonce consumption; decryption follows both.
AES-256-GCM AAD binds request ID, operation ID, profile/revision/purpose, connection
revision, resource and issuer. The broker constructs Authorization itself; it
never forwards caller headers. OAuth refresh/revocation tokens must come from the
sealed credential, never plaintext form input. Successful upstream bodies return
as base64 with a small protocol-header allowlist and a destination/profile
attestation. They remain untrusted data; successful OAuth bodies can contain
credentials and must never be logged. All failures expose only fixed codes.

Transport resolves all A/AAAA answers without caching, chooses one public pin,
uses a new agent with no TLS-session cache/pooling, and enforces that exact lookup.
Original Host/SNI and normal CA/hostname verification remain active. Neither
headers nor body dispatch until `secureConnect` proves the peer address matches.
No redirect, retry, proxy, decompression or unbounded parser exists. Response body
bytes are capped at 64 KiB (or a smaller profile cap) before any JSON/SSE parsing;
parsing is outside this broker. Connect/first-byte/operation deadlines and caller
disconnects destroy the one-use socket. Cancellation after dispatch does not prove
that the remote operation stopped; the later app ledger must preserve unknown
outcomes/holds.

Migration `0012_mcp_egress_replay.sql` adds only the private nonce table, primary
key, expiry index and RLS. It creates no placeholder migrations. Provisioning a
restricted broker role/policy is deliberately separate; no public RLS policy is
created. Retain nonces until their expiry; operator maintenance may delete only
rows where `expires_at < clock_timestamp()`. Never use untrusted request time as
a cleanup cutoff. PostgreSQL errors, bodies, tokens, envelopes, signatures and
queried URLs are not logged.

Activation requires independent source/security review, real hosted networking,
mTLS/secret provisioning, durable replay/RLS and clock/cleanup operations, endpoint
and issuer/client/scope review, complete pinned MCP protocol behavior, owner
consent and verified fee/funding/settlement evidence. Nothing in these offline
checks establishes hosted readiness or authorizes live traffic.
