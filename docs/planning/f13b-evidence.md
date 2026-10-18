# F13-B bounded owner-funded web search

Scope: child #33 of #17, built on merged F13-A source `15a6b4bf1b7689dd5b2b74cba123d7ca1d64fa5a`. Frozen application source and tests: `d56a89f24fe27d319cb6ae436a168c6891ce12ed` on `codex/f13-search`. This is an offline implementation slice. Search remains disabled by default. No provider account, real key, paid query, model request, deployment, cloud login or billing change was used.

## Provider and funding boundary

Tavily is the only initial adapter. Read-only planning used Tavily's official [pricing](https://www.tavily.com/pricing), [API-key guidance](https://help.tavily.com/articles/9170796666-how-can-i-create-an-api-key), [Search endpoint](https://docs.tavily.com/documentation/api-reference/endpoint/search), [privacy policy](https://www.tavily.com/privacy) and [terms](https://www.tavily.com/terms), plus the [OWASP SSRF prevention guidance](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html), [URL Standard](https://url.spec.whatwg.org/) and [WCAG link-purpose guidance](https://www.w3.org/WAI/WCAG22/Understanding/link-purpose-in-context.html). The provider documentation supported one-credit basic search and identified a separately priced pay-as-you-go credit. The 8,000-microdollar value is therefore only a candidate operator snapshot, never a hard-coded entitlement or universal-free claim. Free-plan credits do not make the conservative cash equivalent zero.

Activation requires `SEARCH_TOOLS_ENABLED=1`, a strict operator-verified snapshot with verification and expiry timestamps, every request/spend cap, the existing BYOK encryption keyring and stable resource HMAC secret. Blank `.env.example` placeholders fail closed. The user saves a separate Tavily key, sees its masked value/revision, selects one exact query, sets a search ceiling and acknowledges both separate Tavily funding and query sharing. The model key and platform credits cannot pay search. Saving a key never tests or spends it.

## Implemented bounds

The adapter uses only `POST https://api.tavily.com/search`, Bearer auth to that fixed origin, `redirect: "error"`, basic depth, one chunk per source, at most five results, no answer/raw content/images/favicon/date, no automatic parameters, usage reporting and safe search. It makes one attempt with a 10-second deadline inside the inherited 20-second tool run. Content length and the streamed body are capped at 64 KiB before JSON parsing. The exact authorized query is 1–256 characters; a byte-different or repeated model query is denied before search credential entry.

Only canonical HTTP(S) result URLs with a hostname and no credentials survive. Fragments are removed, duplicate URLs are dropped, result URLs are never fetched, text controls are removed, title/snippet/URL lengths are bounded and trailing evidence is reduced until the complete JSON is at most 4 KiB. Stable server IDs `S1`–`S5` follow provider rank. The stored private evidence contains the canonical title, URL, hostname, snippet, server retrieval timestamp and one-credit receipt. Empty valid evidence is `no_results`; provider/contract failures are `provider_error`. React renders snippets as escaped text labeled untrusted and uses `noreferrer noopener` links. Provider source parts and inline `[[S1]]` tokens must resolve to the same stored ID and canonical URL; forged IDs or mismatched URLs fail.

Search reuses the F13-A three-step, four-call, 512-output-token, 12,000-input-byte and 20-second model limits. It adds at most one paid search. The model sees a bounded untrusted envelope and cannot obtain the search key. If an authorized search is unused, the answer and trace say so instead of claiming grounding.

## Credential, accounting and retention boundary

Migration `0011_search_tools.sql` is reserved for this child; `0010` belongs to a separately inherited slice. The private `search_credential` row is owner/provider/revision scoped, uses the existing AES-256-GCM keyring with search-specific `galaxy-search-aes256gcm-v1` AAD, supports revision compare-and-swap replacement/revocation, has browser-role revocation and RLS, appears only as masked metadata in account export and cascades on account deletion.

The anonymous `byok_operation` audit adds `kind='search'`, the verified price revision, reserved/actual microdollars and receipt credits. It contains no user ID, query, result URL/snippet, provider body or secret. The private tool call links to it. Under the shared advisory lock, reservation atomically rechecks owner/run/call/deadline, key revision, price proof, absence of another search, inherited actor/global concurrency/rate/record limits and all configured search request/spend caps. Entry rechecks the current credential and commits before outbound work. Pre-entry cancellation/revocation releases the reservation. After entry, only a valid echoed query with `usage.credits === 1` settles complete; abort, timeout, transport/provider error, malformed/oversized body, query mismatch or missing/unexpected usage remains held. One credit is a provider usage unit, not proof of a cash charge.

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

## Separate live gates

Before real activation, reverify the then-current Tavily basic-search contract, credit cost, PAYG/subscription applicability, account plan, key type, dashboard monthly limit, downstream-user/terms fit and privacy notice. Obtain explicit authorization for one bounded live query and its budget. That gate must verify real `usage` and result shapes, citation behavior, host egress, fixed-origin redirect denial, timeout/body-limit behavior and whether failed requests can incur credits. Configure monitored reconciliation for held costs. Reissue the expiring operator snapshot only from that evidence.

No local proof establishes provider availability, free credits, cash charged, failure billing, hosted network behavior, production budgets or deployment readiness. Root owns independent source review, GitHub/PR/CI/merge and every live gate.
