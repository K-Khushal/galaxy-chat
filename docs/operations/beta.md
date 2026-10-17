# Gated beta operations

Status: local implementation and local recovery rehearsal only. OAuth, paid model receipts, production proxy trust, hosted runtime, cloud backups and the all-in $10 budget have not been accepted. Keep inference disabled until those gates are evidenced. This guide provisions nothing and contains no usable secret.

## Access and spending

Only a current Better Auth session whose GitHub login is still in `GITHUB_INVITE_LOGINS` may enter private chat, credits, keys, owned history or account data. `/sign-in` does not promise an invitation. `/guest` uses only the isolated guest API; its cookie is not an auth session and its exchange does not transfer when signing in.

Platform funding requires the explicit reviewed BASIC route, unexpired all-in pricing and endpoint bounds, provider account safeguards, a stable actor secret, and configured total commitments. One credit is 100,000 USD microdollars; the daily allowance is 500,000 (five credits), resetting at 00:00 UTC without rollover and subject to the shared cap. Credits measure money, not a fixed number of messages. A worst-case reservation can require more than the remaining fractional balance. Final validated usage settles actual costs. Unknown provider usage, Stop, disconnect or runtime termination keeps its conservative hold. There are no automatic paid retries, topups or funded fallbacks. Titles are local text; no auxiliary inference bypass exists.

Guests additionally require a real Turnstile site key and server secret, action `galaxy_guest`, exact hostname/action verification, HTTPS, and a Cloudflare-only origin that visitors cannot access directly. Only then may `CF-Connecting-IP` be trusted. The site key is public; neither server key nor budget totals are sent in the guest view. A valid unused identity can receive one basic text generation, with a 2,000-byte JSON-encoded text bound and 512 output tokens. The client shows the same byte budget, because non-Latin text can use multiple bytes. A failed or stopped entered generation still uses the guest allowance. Cookie resets/devices cannot establish one unique human. Network attempt counters are durable HMACs, at most three attempts/hour; IPv6 is coarsened to /64. Missing configuration, bot proof, signed cookie, trusted IP or spending capacity fails closed.

BYOK is explicit and separate. User keys are server-encrypted with owner/provider/revision/version-bound AES-GCM and never exported. The selected provider account pays model charges; messages go to that provider and model host under their terms. App resource limits do not cap the provider bill. Provider-side budgets remain necessary. Metadata-only key tests do not run inference or prove model permission. Never substitute platform funds after a BYOK failure.

## Retention and user data

| Data | Current behavior | Deletion and recovery limit |
| --- | --- | --- |
| Guest prompt/answer | In page memory and provider transport; never saved as app chat history, memory or browser storage | Leaving/reloading loses the local exchange; no app guest-chat export/transfer exists. Provider processing is separate. |
| Signed-in profile, sessions, chats/messages, branches/runs and personal usage metadata | Persist in PostgreSQL until the owner deletes the chat/account; no automatic age-based deletion job is implemented | Account deletion cascades owned data and credentials; chat deletion removes its owned branches/runs/messages. |
| Explicit memories and projects | Owner-authored content persists only after an explicit Save action; no automatic collection or inference write | Memory deletion prevents later selection; stale previews reject. Project deletion removes its scoped memories and ungroups saved chats. Account deletion cascades both. |
| Temporary signed-in transcript | Only in the open client component and transient request/provider transport; no chat/message/branch/run/title rows, browser storage, content export or automatic memory writes | Navigation/reload loses it; anonymous funding/resource accounting remains, including unknown holds. Provider retention is independent. |
| Provider credentials | Only ciphertext, nonce, key version and masked/test metadata are stored | Replace/delete uses current revision. Deletion prevents later entry; already-entered remote work may continue. |
| Credit reservations/append-only ledger and guest usage/rate metadata | Pseudonymous HMAC identities, cost/receipt references and timestamps; no prompt/key/bot/session token is intentionally recorded | Retained across account deletion to prevent resetting spending safety. No automatic purge/TTL currently exists. |
| Anonymous BYOK leases | Resource accounting survives account deletion | Entered/held leases retain service slots until known terminal state or manual investigation. |
| Provider/cloud logs and backups | Controlled by the selected operator/provider services | No provider retention, zero-retention or completed cloud-erasure guarantee is made here. Production retention and backup expiry must be decided before beta activation. |

The app has no implemented automatic memory, files/OCR, tools, search, artifacts, image generation, connectors or background execution. Text-route capability checks reject files/tools/search; storage routes remain unavailable. Keep prototype flags `F01_PROTOTYPE=0` and `F04_UI_HARNESS=0` in production. The UI harness additionally requires development runtime. Do not invent future feature flags as evidence of a safety control.

Account & settings provides owned JSON export and account deletion behind the real session. Export contains owned profile/chats/messages/branches/runs, memories/projects and safe key/operation metadata, excluding plaintext keys, ciphertext, nonce, key version and anonymous actor key. Browser copies/downloads are the user's responsibility. Deleting an account does not recall an entered provider request, erase provider records or retroactively remove already-issued backups. Record deletion scope and backup retention honestly. A restored backup must reconcile later deletions before reopening access.

## Quota and support language

Use the server's state. Available credit numbers never override disabled, busy, daily/shared exhaustion or key/resource failures.

| Condition | Explain/action |
| --- | --- |
| Unconfigured/disabled | Generation is unavailable; do not imply a working provider, bot service or invitation. |
| Guest used | Sign in to continue if invited. Signing in does not save or transfer the guest exchange. |
| Bot proof absent/expired | Complete a new verification. Never retry a consumed proof automatically. |
| Daily exhausted | Allowance resets at 00:00 UTC, subject to shared funding. |
| Shared exhausted/stopped | Platform generation is paused. Do not suggest payment or silently switch funding. |
| Active/unknown hold | Request is in progress or awaiting reconciliation. Do not promise an automatic release time. |
| BYOK invalid/unavailable | Replace/reload the selected saved key. Platform credits were not used. |
| BYOK resource limit | Service capacity is limited; a provider key does not remove those limits. |
| Provider failure/Stop | A response may be partial; uncertain costs/leases remain reserved. |

Until a real monitored contact is published, support is the repository's issue channel for non-sensitive reproduction details. Do not claim an SLA, private support mailbox or monitored chat that does not exist. Ask for the timestamp/timezone, page/action, stable error ID, selected funding/provider and a sanitized request ID if available. Never request API keys, encryption keys, session/bot tokens, database URLs, full exports, private prompts or raw provider diagnostics in a public issue. If a secret is disclosed, remove the public copy and rotate/revoke at its actual provider; do not paste it into logs or tickets.

## Backup and restore

Local proof: `bun test tests/f08.integration.test.ts --test-name-pattern 'physical backup'` uses installed PGlite physical `dumpDataDir`/`loadDataDir` APIs on fake data. It drains the single application PostgreSQL queue before snapshotting, restores into a separate local engine, and verifies owner isolation, decryptability with the separately supplied fixture keyring, exact funded charges, append-only ledger trigger, foreign keys and RLS. A second test rehearses funding shutdown while preserving unknown holds and ledger entries. It creates no production backup and supplies no hosted RPO/RTO promise.

Before live activation, choose an operator-owned encrypted PostgreSQL backup location and schedule, access policy, expiry and off-site recovery path within budget. Back up all schema/data, including migrations, original branch/run state, financial reservations, immutable ledger, guest usage/rate state and anonymous BYOK leases. A partial history-only restore can reset spending/resource safety and is not acceptable. Verify roles/revocations/triggers/functions as well as rows. Retain receipt and deployment revision references without secrets.

Store the auth secret, stable credit actor secret, guest cookie secret, BYOK resource HMAC secret, versioned encryption keyring and active version in a separately protected secret manager/recovery path. Database ciphertext without all still-required key versions cannot recover saved keys. A database backup is not proof of secret-manager recovery; that manual gate remains open. Do not rotate HMAC identities or reset unresolved leases as a recovery shortcut. Retired encryption versions may be removed only after re-encrypting all dependent records and verifying recovery.

Restore into an isolated database first, with network/provider access and both funding paths disabled. Recover the correct secret versions separately. Verify row counts/ownership, grants/RLS, immutable ledger/FKs, decryption without printing keys, shared/daily balances and unresolved holds/leases. Reconcile changes after the snapshot: real provider charges/entered operations and deletions must not be forgotten. Do not replay old requests. Test signed-in owner/nonowner export/history, unavailable guest state and provider failure locally. Reopen only after actual operator review of host, receipts, backups and budget.

## Shutdown and rollback

1. Stop new platform work with `FUNDED_KILL_SWITCH=1` and `FUNDED_INFERENCE=0`; set `BYOK_ENABLED=0` separately. Preserve all current secrets and database state. A database `funding_control.stopped=true` independently stops funded entry. This does not recall already-entered remote work.
2. Capture the failing release, redacted logs/error IDs and reservation/run/lease identifiers. Preserve every unresolved reservation and immutable audit row. Verify the provider's actual final receipt before settling known cost. Only a proven pre-entry reservation may be released as pre-entry; never release unknown entered/held work because it is old.
3. Restore a previously reviewed compatible application artifact. F08 adds no schema migration; the prior F07 base `fb442449971038c31e7d6a4197e88047710171a7` understands schema migrations 0000–0004. Removing the new guest page requires removing its public CTA at the same time. Keep inference disabled during rollback.
4. Never roll back by dropping audit tables, deleting guest usage, clearing holds/leases or resetting secrets. If a future release changes schema, establish artifact/schema compatibility first; no destructive down-migration is prescribed here.
5. Verify private route authorization, owned history/export, key redaction, disabled guest/funding states and retained holds against the restored database. Reconcile pending charges/resources before explicitly resuming both environment and database controls.

The local shutdown rehearsal proves no new provider entry and unchanged held reservation/ledger data. Restoring a deployed prior binary, secrets-manager recovery, cloud backup recovery, load behavior, billing reconciliation and production rollback are still manual/live acceptance gates. Do not close F08 from local proof alone.

## F09 explicit context and temporary chat

Apply migration `0005_explicit_context.sql` through `bun run db:migrate` before running this version. It adds owner-filtered, RLS-enabled project/memory tables and a composite owner/project constraint on saved conversations. A project deletion trigger clears grouping before deleting project-scoped memories. Keep the migration on rollback; prior binaries can ignore these additive columns/tables. Do not drop user context or audit records to roll back application code.

`/chat/context` is the explicit editor and owned project grouping view. Up to 100 memories (1,000 characters and 1,800 UTF-8 bytes each) and 30 projects (80-character name, instructions up to 2,000 characters and 3,000 UTF-8 bytes) are allowed. No background extraction or Mem0 integration exists. A new saved conversation chooses one project; subsequent turns/branches cannot switch it. Global memories still require selection; scoped memories can enter only their own project. Deleting a project leaves saved conversations ungrouped and removes its scoped memories.

Before sending, Request context shows the exact selected memory content and project instructions. At most eight memories may be checked. The server resolves owned IDs rather than accepting caller-provided instructions, verifies the preview digest and checks again before provider entry. Edits/deletes fail stale requests closed. Refresh the selection, clear deleted memories, or reload a conversation after project deletion. Requests already entered at a provider cannot be recalled; deleting a memory does not remove facts repeated in previous saved prompts/answers or provider-held data.

Instructions share the existing encoded 12,000-byte input budget with up to 12 recent messages. Instructions themselves may use at most 4,500 encoded bytes. Selected memory/instructions are never silently dropped; oversized selections reject. Oldest conversation messages can be omitted to stay in budget. The conservative provider input ceiling remains 16,384 tokens, output 512 tokens, with the same reviewed reservation calculation. Byte accounting is a conservative guard, not a tokenizer-based exact token count.

`/chat/temporary` is an explicit new ephemeral conversation. It cannot reopen a saved chat/branch, regenerate/edit saved content, create titles, persist messages, or populate history/export. Recent text is sent from client memory only. Memory context is optional and remains explicit; inference never creates a new memory. The app stores no transcript in local/session storage. Do not enable request-body, prompt/response, AI SDK tracing, or diagnostic content logging in the host; only stable error IDs and anonymous operational accounting are permitted. Provider/cloud retention and a user's own browser/clipboard copies are independent.

Temporary generation uses the identical signed invitation, platform reservation or BYOK key/resource path. Platform accounting retains opaque request IDs, one-way request digests, HMAC actor identity, numeric usage/cost/state/timestamps and fixed evidence; temporary provider response IDs are not retained. BYOK retains its anonymous existing resource lease/digest without platform spend. Stop, disconnect and deletion never release uncertain entered usage. No guest advanced controls or temporary-to-saved transfer exists.

Portable local verification commands are `bun run lint`, `bun run typecheck`, `bun test`, and `bun run build`; run them serially. F09 fixture UI at `/preview/ui?context=1` remains development-only under `F04_UI_HARNESS=1`; its editor and picker use an explicitly injected in-memory client and never call auth/database/providers. It is not a signed-in availability bypass or live acceptance evidence.
