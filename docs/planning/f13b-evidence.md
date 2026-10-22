# F13-B bounded owner-funded web search

Scope: child #33 of #17, built on merged F13-A source `15a6b4bf1b7689dd5b2b74cba123d7ca1d64fa5a`. Original implementation source and tests: `d56a89f24fe27d319cb6ae436a168c6891ce12ed`. Recovered security corrections are frozen at `7d63a051b91e63d90536f417b667ed4099dcee1c` on `codex/f13-search`, after table integration `d937dc7`. This is an offline implementation slice. Search remains disabled by default. No provider account, real key, paid query, model request, deployment, cloud login or billing change was used.

## Provider and funding boundary

Tavily is the only initial adapter. Read-only planning used Tavily's official [pricing](https://www.tavily.com/pricing), [API-key guidance](https://help.tavily.com/articles/9170796666-how-can-i-create-an-api-key), [Search endpoint](https://docs.tavily.com/documentation/api-reference/endpoint/search), [privacy policy](https://www.tavily.com/privacy) and [terms](https://www.tavily.com/terms), plus the [OWASP SSRF prevention guidance](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html), [URL Standard](https://url.spec.whatwg.org/) and [WCAG link-purpose guidance](https://www.w3.org/WAI/WCAG22/Understanding/link-purpose-in-context.html). The provider documentation supported one-credit basic search and identified a separately priced pay-as-you-go credit. The 8,000-microdollar value is therefore only a candidate operator snapshot, never a hard-coded entitlement or universal-free claim. Free-plan credits do not make the conservative cash equivalent zero.

Activation requires `SEARCH_TOOLS_ENABLED=1`, a strict operator-verified snapshot with verification and expiry timestamps, every request/spend cap, the existing BYOK encryption keyring and stable resource HMAC secret. Blank `.env.example` placeholders fail closed. The user saves a separate Tavily key, sees its masked value/revision, selects one exact query, sets a search ceiling and acknowledges both separate Tavily funding and query sharing. The model key and platform credits cannot pay search. Saving a key never tests or spends it.

## Implemented bounds

The adapter uses only `POST https://api.tavily.com/search`, Bearer auth to that fixed origin, Workers-compatible `redirect: "manual"` with explicit rejection and body cancellation for every 3xx, basic depth, one chunk per source, at most five results, no answer/raw content/images/favicon/date, no automatic parameters, usage reporting and safe search. It makes one attempt with a 10-second deadline inside the inherited 20-second tool run. Content length and the streamed body are capped at 64 KiB before JSON parsing. The exact authorized query is 1–256 characters; a byte-different or repeated model query is denied before search credential entry.

Only canonical HTTP(S) result URLs with a hostname and no credentials survive. Fragments are removed, duplicate URLs are dropped, result URLs are never fetched, text controls are removed, title/snippet/URL lengths are bounded and trailing evidence is reduced until the complete final untrusted tool envelope, including both JSON serialization layers, is at most 4 KiB. Evidence is reduced before persistence and ID/citation use, so the model receives complete parseable evidence matching the persisted sources. Stable server IDs `S1`–`S5` follow provider rank. The stored private evidence contains the canonical title, URL, hostname, snippet, server retrieval timestamp and one-credit receipt. Empty valid evidence is `no_results`; provider/contract failures are `provider_error`. React renders snippets as escaped text labeled untrusted and uses `noreferrer noopener` links. Provider source parts and inline `[[S1]]` tokens must resolve to the same stored ID and canonical URL; forged IDs or mismatched URLs fail.

Search reuses the F13-A three-step, four-call, 512-output-token, 12,000-input-byte and 20-second model limits. It adds at most one paid search. The model sees a bounded untrusted envelope and cannot obtain the search key. If an authorized search is unused, the answer and trace say so instead of claiming grounding.

## Credential, accounting and retention boundary

Migration `0011_search_tools.sql` is reserved for this child; `0010` belongs to a separately inherited slice. The private `search_credential` row is owner/provider/revision scoped, uses the existing AES-256-GCM keyring with search-specific `galaxy-search-aes256gcm-v1` AAD, supports revision compare-and-swap replacement/revocation, has browser-role revocation and RLS, appears only as masked metadata in account export and cascades on account deletion.

The anonymous `byok_operation` audit adds `kind='search'`, the verified price revision, reserved/actual microdollars and receipt credits. It contains no user ID, query, result URL/snippet, provider body or secret. The private tool call links to it. Under the shared advisory lock, reservation atomically rechecks owner/run/call/deadline, key revision, price proof, absence of another search, inherited actor/global concurrency/rate/record limits and all configured search request/spend caps. Entry resolves the current price proof after awaiting the shared advisory lock, comparing expiry, full original snapshot identity, reserved cost and selection revision; it rechecks the current credential and commits before outbound work. Pre-entry cancellation/revocation releases the reservation. After entry, only a valid echoed query with `usage.credits === 1` settles complete; abort, timeout, transport/provider error, malformed/oversized body, query mismatch or missing/unexpected usage remains held. One credit is a provider usage unit, not proof of a cash charge.

Private query/evidence lives in the owned run/call and is included in export/deletion. Anonymous resource/cost rows survive deletion so account deletion cannot reset caps or erase unresolved liabilities.

## Offline proof

All heavy commands were serialized with `python3 /private/tmp/galaxy-run-check.py`. PGlite used local fixture sockets, and model/search adapters were injected fakes or locally intercepted SDK paths. No test reached Tavily or a real model provider.

The initial adapter test was written before its module and failed on the missing import. The final focused F13-B/search/UI/RLS suite passed **19 tests / 123 assertions**. It covers the exact fixed request and one attempt; 256-character query, 10-second constant, 64-KiB response and 4-KiB evidence bounds; hostile/credentialed/duplicate URLs and inert HTML-like snippets; stable citations and forged ID/URL rejection; disabled/expired/incomplete price configuration; distinct search key, ceiling and audit; valid settlement, unknown hold and no raw error; atomic spend/request/concurrency caps; pre-entry revocation/release; stale price proof; model query substitution; owner isolation, revision CAS, RLS, masked export and account cascade with anonymous audit retention.

The combined F13-A/F13-B regression passed **42 tests / 323 assertions** across runtime, integration, RLS and UI files. It includes the actual 20-second uncooperative-provider deadline, abort-after-running-event regression, original arithmetic/revision tools, four-call/three-step limits, approval behavior and intercepted OpenRouter path.

Final checks against frozen source `d56a89f24fe27d319cb6ae436a168c6891ce12ed`:

- `bun run lint`: **305 files**, no fixes or errors.
- `bun run typecheck`: passed with incremental output disabled.
- `bun test`: **197 pass / 1 skip / 0 fail**, **2,862 assertions**, **198 tests across 31 files**, **101.14s**. The one skip is the inherited native-PostgreSQL F10/F11 concurrency case when its explicit database URL is absent; no F13 test is skipped.
- `bunx next build --webpack`: Next **16.4.2** strict webpack build passed compilation, generated-route TypeScript, all **26/26** static pages and final build traces. `/api/search-credentials`, `/api/tools` and `/chat/tools` are dynamic; the preview routes retain their development gate.
- `git diff --check`: passed before the source commit. The checkout was clean after source commit and before this evidence-only file.

The development `/preview/ui?tools=1` fixture uses production components and fake clients only. It includes search funding controls plus completed sources, no-results and provider-error modes with a deliberately long hostile-looking snippet for narrow-screen review. `/preview/landing` retains the local tools picker. Root owns the desktop/phone browser walkthrough; this worker started no server or browser.

## Recovered security corrections (October 22)

Frozen source `7d63a051b91e63d90536f417b667ed4099dcee1c` preserves the interrupted worker edits and completes all five review categories:

- Workers-compatible manual redirects reject and cancel every 3xx body without a second destination or key forwarding.
- Final locked entry compares the full original price snapshot, revision and reserved cost with currently valid configuration. A deterministic gate around completion of the real shared-lock SQL changes expiry, cost or same-ID verification identity while entry waits; all three are rejected while the operation remains unentered and releasable.
- Both declared and streamed 64-KiB overflow cancel transport. The entered integration case retains its anonymous unknown-cost hold and makes one attempt.
- Title/snippet normalization removes Unicode `Cc` and `Cf` characters, including C1 and bidirectional formatting controls, while normalizing visible whitespace.
- A shared serializer measures the final double-serialized untrusted envelope before evidence persistence. An actual `MockLanguageModelV4` continuation receives at most 4,096 bytes, `truncated: false`, complete parseable evidence equal to the persisted sources/IDs, and a valid `[[S1]]` citation. Both persisted model-step input counts remain at most 12,000 bytes. The inherited joint-context rejection regression remains in the focused suite.

The preserved private API cache headers and search privacy/funding disclosures are included. No configuration enables search.

Recovery validation uses the restored serialized runner with `fcntl` lock `/private/tmp/galaxy-heavy-checks.lock`. `bun run typecheck` passed. `bun run lint` checked **317 files** with no errors or fixes. The combined F13-B/F13-A/table run passed 59 tests and exposed one test-only SQL column typo in the newly added joint-cap assertion (`tool_step.operation_id`, corrected from `run_id`); the affected full F13-B integration file then passed **12 tests / 71 assertions / 0 failures** in **18.06s**, including the actual SDK envelope and locked-price regressions. The final full-suite/build/integrity results below validate the recovered frozen source; the original implementation checks above remain historical evidence.

Final recovery checks against frozen source `7d63a051b91e63d90536f417b667ed4099dcee1c`:

- `bun test`: **215 pass / 1 skip / 0 fail**, **3,143 assertions**, **216 tests across 34 files**, **168.34s**. The one inherited native-PostgreSQL F10/F11 concurrency case needs its explicit database URL; no F13 test is skipped.
- `bunx next build --webpack`: Next **16.4.2** strict build passed compilation, generated-route TypeScript, static page generation and final traces. Recovery log: `/private/tmp/galaxy-search-recovery-build.log`.
- `bun run f01:integrity`: passed.
- `git diff --check`: passed. Application source stayed unchanged throughout the full suite and build; only this evidence file was edited.

The full-suite log is `/private/tmp/galaxy-search-recovery-full.log`. No worker check or server remains running after these results. Independent root re-review, browser validation, PR/CI and merge are still separate release gates. No server, browser session, cloud account, provider/model request or paid operation was started by this recovery worker.

## Separate live gates

Before real activation, reverify the then-current Tavily basic-search contract, credit cost, PAYG/subscription applicability, account plan, key type, dashboard monthly limit, downstream-user/terms fit and privacy notice. Obtain explicit authorization for one bounded live query and its budget. That gate must verify real `usage` and result shapes, citation behavior, host egress, fixed-origin redirect denial, timeout/body-limit behavior and whether failed requests can incur credits. Configure monitored reconciliation for held costs. Reissue the expiring operator snapshot only from that evidence.

No local proof establishes provider availability, free credits, cash charged, failure billing, hosted network behavior, production budgets or deployment readiness. Root owns independent source review, GitHub/PR/CI/merge and every live gate.
