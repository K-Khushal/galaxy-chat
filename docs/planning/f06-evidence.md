# F06 local credit and guest backend evidence

Date: 2026-10-17. Local backend slice only. Funded inference and guests remain disabled with the checked-in placeholders. No cloud resource, provider account, Turnstile widget, login, purchase, deployment, real provider request, commit, push or pull request was created for this slice. F06 live acceptance remains open.

## Implemented boundaries

- All money is integer USD microdollars: one credit = 100,000; the user daily allowance = 500,000. UTC day/month keys come from the database clock for reservations. Final spend stays in the reservation's original UTC period. No daily rollover. The environment must explicitly state inference, infrastructure, provider/payment fees and safety reserve; their sum cannot exceed 10,000,000 microdollars. Blank, negative, fractional, malformed or unknown values fail closed. No purchase/topup or paid fallback code exists.
- A single server-configured, expiring price snapshot permits one reviewed BASIC text-only nonreasoning OpenRouter model/endpoint. No model ID or price is guessed. Client model selection must match this allowlist. Unknown/expired price, missing key/database, unverified endpoint bounds or either kill switch prevent calls. Colon variants other than `:free` are rejected. Gateway/catalog expansion belongs to F05.
- `CreditStore` serializes every balance check/claim/settlement with `pg_advisory_xact_lock(41021406)` in explicit READ COMMITTED transactions. This is safe for transaction poolers; postgres.js continues to use `prepare: false`. Reservations debit both the actor/day and global/month in one transaction, and commit before the provider-entry claim commits. Default concurrency is one per actor and two globally.
- Every reservation records a price snapshot and immutable audit event with bounds. Append-only ledger triggers reject UPDATE/DELETE. Financial records use server HMAC actor keys and survive account deletion; no prompt text, provider keys, auth/session tokens or bot tokens enter these records. Keep `CREDIT_ACTOR_SECRET` stable across restarts; rotation requires a planned actor-key migration, otherwise per-actor identities change.
- Deterministic chat/message request keys and guest request UUIDs are persisted. A duplicate key is rejected with 409 (or the guest's durable 429 used state), and cannot call the provider again. Changed content with an existing key is a conflict. This slice does not replay saved streaming responses; F05 can add a replay UI later.
- Context uses at most 12 recent user/assistant text turns, dropping the oldest first, with a 12,000-byte serialized input budget. Reservations allow 16,384 input tokens, including framing headroom, and 512 total output tokens. Only a verified nonreasoning endpoint may be enabled. SDK retries and provider fallbacks are disabled; provider routing restricts endpoint, supported parameters, maximum token prices and zero per-request fees. No files, tools, search, memories or hidden summarization enter funded calls.
- All existing provider calls now pass through `startFundedStream`. Titles are bounded local text, so they incur no auxiliary call. The legacy unreserved callback always denies execution. The authenticated chat endpoint still uses Better Auth ownership and persists user/assistant text. Unknown funding modes/extra fields are rejected; there is no implemented BYOK path or silent platform substitute. F07 will implement the separate, platform-accounting-exempt credential path.
- Final usage requires complete integer token counts, zero reasoning, a matching raw provider usage record and its explicit cost receipt. Answer finish reason alone never makes that final receipt unknown: moderated/error/other completions with validated complete receipts settle normally. Decimal receipts are converted with integer arithmetic and rounded up to the next microdollar. Missing/partial usage, timeout, errors, client cancellation and runtime termination retain the conservative reservation. Observed incurred costs are monotonic and cannot be erased by cancellation or a smaller later settlement. A known final cost settles in full; a violated bound also stops funding in `funding_control`. Unverified bounds retain at least the observed bill and stop funding.
- Server draining continues independently of response consumption. It is best effort on a terminated serverless request: durable entered/reserved/held rows still protect funds and concurrency when completion never runs. Pending holds from prior days/months also constrain current balances until reconciliation; settlement never sums the same row twice within one window.

## APIs and operator recovery

`GET /api/credits` requires the real invited Better Auth session, derives its own actor, ignores query user IDs and sends `Cache-Control: no-store`, including failures. Public contract:

```ts
{
  funding: "platform";
  state: "disabled" | "available" | "daily_exhausted" | "shared_exhausted" | "busy";
  configured: boolean;
  allowanceMicrodollars: 500000;
  remainingMicrodollars: number; // daily allowance less final charges and conservative holds
  creditMicrodollars: 100000;
  resetsAt: string; // next 00:00 UTC, ISO
  reason?: string; // stable redacted error ID
}
```

Availability also checks shared funding, concurrency, database control and provider configuration. Remaining daily allowance alone never promises availability. No shared/admin amounts, price secret or actor identifier is returned. F04's view-model mapping is integration work; this backend slice does not edit UI components.

`CreditStore.operatorView()` and `operatorPending()` are server-only views, with no public/admin HTTP endpoint. Reconcile a pending row using its stored actor key/kind and reservation ID with `finish(..., {kind: "known", microdollars, evidence: "provider receipt reference", usage: {...}})`. A verified zero final receipt is valid. Only an unentered `reserved` row can be released with `before_entry`; that outcome on entered/held rows retains funds. Failed/crashed rows never expire automatically. Provider response IDs are retained in audit evidence when available; a crash before a provider ID/receipt exists requires provider-side investigation. Database `funding_control.stopped` and environment `FUNDED_KILL_SWITCH` independently stop new calls. Investigate an incident and reconcile holds before explicitly resuming either control.

## Guest boundary

`GET /api/guest` returns only `{state: "disabled" | "available" | "used" | "busy", remainingGenerations: 0 | 1, limitations: string[], reason?: string}` and may issue an HttpOnly/Secure/SameSite=Strict signed `__Host-` cookie. It never creates an auth session. `POST /api/guest` accepts exactly `{requestId: UUID, text: string, botToken: string}`. It returns the AI SDK UI message SSE format and stores usage metadata only, never guest chats/messages/memory.

One durable guest reservation consumes the single allowance, including an uncertain or failed attempt; it is not granted back on cancellation. Guest input is bounded to 2,000 UTF-8 bytes, output to 512 tokens, with the same global/daily/concurrency reservations. Tools/files/advanced models/extra fields are rejected. HMAC network counters allow at most three attempts/hour, shared across cookie resets; IPv6 addresses normalize to /64. Missing/malformed trusted IP, wrong origin, bad signature, used identity, invalid bot proof and exhausted funds all deny execution.

Real guests additionally require a provisioned Turnstile widget with action `galaxy_guest`, server-side Siteverify success with exact hostname/action matching, a configured secret, HTTPS application origin, and explicit `GUEST_TRUSTED_PROXY=cloudflare` plus `GUEST_ORIGIN_IS_PROXY_ONLY=1`. The deployed origin must reject direct visitor access so `CF-Connecting-IP` is trustworthy. The code does not trust arbitrary forwarded headers. These are deployment prerequisites, not claims that any proxy/widget exists. Cookie/key expiry or resets and other devices cannot prove one real person; the API explicitly discloses that limit. No guest widget/UI is implemented here, so the guest API's local fixture success does not make guest onboarding live.

## Verification

Toolchain observed: Bun 1.4.2, Next 16.4.2, AI SDK 7.0.143, OpenRouter provider 3.1.0, Drizzle 0.45.4. The repository's separately configured CI toolchain is unchanged.

- `bun install --frozen-lockfile` — passed; no dependency or lockfile edits.
- `bun run lint` — passed, no fixes pending.
- `bun run typecheck` — passed.
- `bun test` — passed: 44 tests, 0 failures, 265 assertions across five files. Existing F03 ownership/invite/session tests remain; its expected migration list includes 0002 and a real-session credit API test was added.
- `bun run f01:integrity` — passed (`f01 vendor integrity passed`).
- `git diff --check` — passed.
- `bun run build` — passed without provider/auth/storage credentials. `/api/credits` and `/api/guest` are dynamic routes.

F06's 22 integration tests use real PGlite SQL and local Postgres-protocol loopback connections, not source-string assertions or paid services. They cover concurrent shared/daily exhaustion and concurrency, duplicate idempotency/claims/settlement, immutable audit snapshots, UTC daily/monthly rollover, prior-period unknown holds, crash recovery, cross-actor settlement denial, failures before/after provider entry, cancellation with known/unknown receipts, monotonic incurred spend, kill switches/unknown prices/models, input bounds, durable guest second-use/concurrent use, bot/origin/cookie/capability denials and network limits. Three tests run the actual installed AI SDK/OpenRouter adapter against an in-memory SSE/failure fetch fixture to inspect request limits, prove one provider invocation/no retry, and settle two content-filter completions without consuming active request slots. Test fixtures close database/socket connections; no preview/server process remains.

PGlite is a local shared engine and does not prove independently deployed PostgreSQL backends, Supabase pooler roles or remote concurrency behavior. The tests validate the actual SQL, persistence, orchestration and local contention; real-host concurrent-load evidence remains pending.

## Sources inspected and live gates

The installed version-matched AI SDK `src/types/usage.ts`, `src/generate-text/stream-text.ts` and stream result types establish total input/output versus reasoning tokens, `onEnd`/abort/error lifecycle, consumer draining and retry defaults. Installed OpenRouter source maps output limits to `max_tokens`, disables reasoning/fallbacks and preserves explicit raw cost receipts. Reviewed primary references: [OpenRouter provider routing and maximum prices](https://openrouter.ai/docs/guides/routing/provider-selection), [Turnstile server validation, action/hostname and single-use proofs](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/).

Still unverified: real BASIC model/endpoint pricing and billing period semantics, provider account spending limits and fees, model-specific tokenization/framing bound, actual nonreasoning/output/maximum-price enforcement, final usage receipts under provider failures/cancellation, live Turnstile/proxy trust, hosted streaming/draining, Workers CPU/size/runtime compatibility, and the total recurring $10 go/no-go. `FUNDED_PROVIDER_LIMITS_VERIFIED=0`, blank prices/keys/cost fields and the enabled kill switch intentionally keep everything off until that evidence exists. No F06 live checkbox or GitHub issue was closed.
