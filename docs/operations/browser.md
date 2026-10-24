# Browser intent and offline trace policy foundation (issue #61, child of #38/#18)

This slice delivers reusable policy contracts and a deterministic offline diagnostic for a possible future browser feature. It defines what a reviewed browser intent candidate may contain (`lib/browser/contract.ts`) and validates synthetic caller-supplied browser/network traces against such an intent (`lib/browser/policy.ts`). No browser is enabled and nothing here completes #38: there is no execution route, no UI, no adapter, no permanent unavailable stub and no second funding ledger. Every denial and liability in the platform is preserved.

## What an intent candidate is — and is not

A browser intent candidate (`parseBrowserIntent`) is bounded, immutable candidate data with a stable SHA-256 content fingerprint (`browserIntentFingerprint`) over its canonical form. Fields: the immutable action revision `browser-intent-v1`, one exact initial HTTPS URL, an explicitly enumerated origin/path allowlist, the fixed action set (`navigate`, `extract-text`, `screenshot`) and the fixed limits (≤3 navigations, ≤10 user-level actions, ≤60 seconds, 64 KiB extraction per action, 2 MiB screenshot per action). Callers cannot change the limits; there is no field, boolean or flag anywhere in this slice that enables production execution.

A candidate is **not** approval, network authority, billing proof, provider capability or an admission token. A caller's JSON, hash or claim of review confers nothing: only an explicitly supplied allowlist enumerates reviewed destinations, and the shipped default is an empty allowlist — no real site is pre-approved. `GET` alone never means a website or path is side-effect-free; exact allowlist membership is the only destination rule and it is not weakened by method, spelling or encoding.

## Exactness and normalization

Destinations are canonical exact spellings; equivalent spellings cannot bypass the allowlist because only one spelling of each destination is even parseable:

- HTTPS with the default port only; credentials, query strings, fragments and alternate port spellings are rejected.
- DNS-name hosts only: no IP literals (v4 or v6), no IDNA/punycode labels, no trailing dot, no `localhost`/`local`/`internal`/`invalid`/`test` suffixes, no uppercase or otherwise non-canonical host spelling.
- Paths are bounded ASCII (`/`, letters, digits, `_ . ~ -`) with no percent escapes, no `//`, no dot segments and no wildcard or suffix forms. Allowlist matching is exact string equality after these checks — there is nothing left to normalize.
- The host checks reuse the MCP egress endpoint validation (`services/mcp-egress/src/profile.ts`) and the address checks reuse its public-address policy (`services/mcp-egress/src/ip-policy.ts`) by import. Neither module was modified.
- When the allowlist is non-empty, the initial URL's exact origin and path must be enumerated in it. An explicitly empty allowlist is a valid candidate under which no navigation — including the initial URL — is approved.

## Offline trace diagnostic

`evaluateBrowserTrace` validates a synthetic trace against a parsed intent. It is a candidate/fixture diagnostic classified `synthetic-evidence-only` with `authority: "none"`; it confers no executable capability, admission token, resource-stop evidence or settlement, and it performs no fetch, DNS, browser automation, Playwright/CDP or host payload execution.

Bounds are applied before any per-event iteration or serialization: at most 128 events, URLs ≤2048 characters, hostnames ≤253, and total UTF-8 trace bytes ≤4 MiB (sized so one maximum screenshot fits; callers cannot push more through). Violations are capped at 32.

The event vocabulary covers top-level `navigate`, `redirect`, `subresource`, `resolved`/`connected` address evidence and the two payload actions. One fresh session/page starts the trace; its timestamp fixes the original 60-second deadline and monotonic timestamps can never renew it. Navigations are capped at 3, user-level actions (navigate/extract-text/screenshot) at 10. Every network destination needs its own exact allowlisted URL plus `resolved` and `connected` evidence for its host: mixed public/private answer sets, missing evidence, a connected address outside the resolved set, or a changed answer set on re-resolution are all denied, reusing the egress public-address semantics for private, metadata, mapped, link-local and documentation IPv4/IPv6 forms. WebSockets, popups/additional tabs, downloads, form/upload/message/purchase submission, credential/cookie/session import, arbitrary script/evaluate actions, extensions, every non-GET request and any unknown event kind are denied with fixed violation codes.

Payload sizes are measured, never claimed: extraction text is measured in UTF-8 bytes against 64 KiB per action, screenshot data is base64-decoded and measured against 2 MiB per action, and a caller `claimedBytes` that disagrees with measurement is itself a violation. Reports contain only counts, the intent fingerprint and fixed codes with event indexes — never raw page content, screenshot bytes, cookies, URLs or input-derived strings; parse errors are fixed-code exceptions with no payload.

A finite caller-supplied trace proves only what it contains. The diagnostic reports `unreportedTraffic: "not-observable"`: it cannot establish that unreported browser traffic did not occur, and an accepted result is not a compliance or vendor statement.

## Evidence boundaries and remaining gates

Offline tests cover hostile intents (credentials, IP literals, IPv6/mapped/ULA/metadata addresses, canonical-URL confusion, wildcards, oversize arrays), trace bounds, deadline renewal attempts, rebinding and mixed-DNS denials, redirect/subresource escapes, forbidden vocabulary, forged byte counts and report sanitization, plus one valid synthetic read-only fixture that passes with explicit synthetic-only labeling. These are diagnostic proofs only.

Real browser capability remains gated on #38: adapter egress enforcement before requests (not trace reconstruction), complete authenticated observations, approved durable jobs/funding, an authenticated cost/resource-stop issuer and actual provider isolation/termination. No fetch, DNS, Chromium, Playwright, CDP or host payload execution, no paid calls and no cloud login/provisioning/deployment were performed for this slice.
