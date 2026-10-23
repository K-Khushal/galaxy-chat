# MCP wire-client local review

Reviewed source `0d93c93`, integrated with image main `2ea10b2` at `abc14cd`. Independent security/spec and standards reviews cleared the six-file client slice. No routes, discovery, OAuth flow, tool registration, approvals or fee ledger are implemented by this slice.

The transport stays off by default. Enabled configuration requires independently keyed HMAC/AES-GCM, expiring operator profiles, a canonical immutable HTTPS broker endpoint and Cloudflare mTLS binding. There is no global fetch fallback or automatic retry. Exact wire serialization and credential AAD are tested against the actual broker parser/authenticator/decryptor. Profiles and endpoint cannot be mutated through the public config.

Review corrections include strict IP attestation validation, complete body-lifecycle timeout/cancellation, final pre-entry expiry checks, cancellation independent of cancellation-promise settlement, late fetch/body completion cleanup, and absolute deadline checks preventing timer starvation from accepting late success. Post-entry failures remain outcome unknown; this client cannot release future ledger holds.

Root independent focused checks: 29 offline tests, 162 assertions. Full integrated checks: frozen install; standalone Node22 broker 27 tests; app 283 pass, 1 inherited native-Postgres skip, 0 fail, 3,753 assertions; types, lint, vendor integrity, strict Webpack build, and full Node22 OpenNext build all pass. Logs/results are under `/private/tmp/galaxy-mcp-wire-final-`.

All wire tests use fake binding transport and the local broker protocol oracle. No external MCP, OAuth, paid model/search/image requests or deployment were performed. No UI was added by this transport-only slice. Hosted Cloudflare mTLS certificate/binding behavior, live broker connectivity, replay durability, budget/capacity and operational recovery remain pending. Successful bundling does not prove the uncalled transport works in the hosted runtime.

Child #34 remains in progress: owned connections, token/OAuth lifecycle, bounded immutable tool catalogs, explicit approvals, separate platform fee/capacity ledger and enabled end-to-end integration still require local implementation. Existing model-provider BYOK does not fund these costs.
