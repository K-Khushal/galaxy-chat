# F08 independent review

Scope: issue #12 local beta integration, fixed feature baseline `fb442449971038c31e7d6a4197e88047710171a7`, including the independently reviewed F15 merge and narrow public guest integration. No live acceptance is inferred.

## Spec and security

The independent spec reviewer accepted the guest route/client, strict config shared by GET/POST, Turnstile lifecycle, text-only escaped output, SDK transport, cancellation/held spend, diagnostics redaction, integration tests and recovery guide. Missing or malformed public site keys are denied before verification/reservation/provider entry. The original backup command was corrected to a portable repository command. Provider receipts are preserved while diagnostics are stripped. Signed identity/ownership and platform-versus-BYOK boundaries remain intact. No actionable finding remains.

## Standards

The independent standards reviewer found no hard repository-standard violation or concrete correctness/security issue. Root accepted the small landing/help/privacy integration and development-only responsive selector; no new inference or authorization path was introduced. A redaction extraction was considered optional and avoided to keep distinct funded/BYOK contracts explicit.

## Root browser review

Real local Next development server, Bun 1.4.2, Next 16.4.2, IAB desktop viewport 1280x720. `/guest` without credentials settled to unavailable, with disabled prompt/Send and working availability/privacy/help/sign-in affordances. The real landing guest CTA reached `/guest` in the 390px public-page iframe.

Shared production GuestChat was exercised with clearly labeled injected local fixtures: valid prompt streaming/completion, one-generation terminal state, verification missing/complete/expired (draft preserved and Send disabled on expiry), Stop to conservative used state with no-transfer explanation, busy, exhausted and failure states. Literal script and Markdown-link prompt text remained inert visible text; renderer attack regressions separately cover provider output. No real bot challenge, authentication or provider call was performed.

The existing responsive workbench now selects public guest and labeled local fixtures. Root inspected the actual 390px iframe in light/dark themes, scrolled composer/footer and completed a local prompt. No observed horizontal clipping or inaccessible bottom controls. Screenshot evidence: `/private/tmp/galaxy-f08-phone-light.png` (public unavailable), `/private/tmp/galaxy-f08-phone-dark.png` (local completion). This is desktop browser emulation, not physical-device, contrast-ratio or assistive-technology proof.

## Independent checks

Root ran `bun test tests/f08.integration.test.ts tests/f08-ui.test.tsx tests/f08-security.test.tsx tests/f15-preview.test.tsx tests/f15-metadata.test.ts`: 13 passed, 176 assertions, 8.61s, default timeouts unchanged. Real migrated local SQL, signed sessions and installed SDK use synthetic provider SSE only. Local first text 38.97ms/completion 46.63ms; physical fake-data backup/restore 675.35ms and 4,759,729 bytes. These exclude remote model, hosting and browser performance.

Worker combined full suite: 98 passed, 878 assertions, 50.52s. Worker lint, vendor integrity, type-inclusive production build and diff check passed. The earlier local OpenNext Workers build passed before public-copy integration; it is not a fresh combined hosted artifact. Root final production build/smoke results recorded below after completion.

Live OAuth/invites, real Turnstile/trusted edge, provider prices/receipts/abort, hosted concurrency/runtime, cloud backup/secret recovery, production rollback, physical accessibility and all-in monthly budget remain pending. Keep issue #12 open. F09 onward may proceed locally behind their own implementation/availability gates; no public beta launch is authorized by this review.

Final root production build passed including TypeScript. Credential-free production smoke: `/guest` 200; `/api/guest` 200 with `Cache-Control: no-store`, disabled/zero generations and no secrets or balances; both preview routes 404 even with the development flag set; `/chat` redirected to `/sign-in?notice=auth_unconfigured`. Lint (222 files) and diff check passed. Local production and development servers stopped.
