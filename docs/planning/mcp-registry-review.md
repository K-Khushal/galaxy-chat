# Owned MCP registry local review

Independent spec/security and standards reviews cleared source 8a24aad, based on reviewed main 966a7b9. The registry bounds each owner to five records including disabled/revoked entries, pins complete operator profile identity/digest, and requires owner plus expected revision for mutations. Revocation is terminal. Current configuration, expiry and digest checks precede even idempotent enable. Cleanup and sanitized export remain available with configuration off. UTF-8 labels are bounded to 64 bytes and CR/LF/tab reject before SQL.

Migration 0014 adds only registry schema, constraints, index, RLS and revokes. Account export adds sanitized connections and deletion cascades owned records; existing account lock order remains intact. No endpoints, tokens, protocol bodies or financial ledger are added.

Root full checks at 10f1e77: frozen install; Node22 broker 27 pass; app 294 pass, 1 inherited native-Postgres skip, 0 fail, 3,872 assertions; types/lint/integrity/strict Webpack/full Node22 OpenNext pass. Final four-file review correction at 8a24aad: registry/account suites 22 pass, 264 assertions; types/lint pass. Full-suite/build evidence precedes the small final label/idempotent-enable correction. Hosted CI must verify the final PR head.

Tests use actual local DB/store transactions and real validated configuration with a binding that throws if called. PGlite plus one connection proves queued transaction ordering, not independent native PostgreSQL session contention. Upgrade fixtures preserve image/search metadata and monetary rows; account deletion specifically proves owned search liability survival, not every liability category. No network, OAuth or paid app call occurred. No UI was added.

Shared platform funding/capacity invariants, OAuth/token lifecycle, immutable catalogs, approvals and dispatch integration still require local work. Hosted DB grants, runtime/mTLS, funding, recovery and deployment proof remain pending. Configured records confer no funding or network readiness. Advanced features remain off.
