# Galaxy Chat implementation backlog

Created 2026-10-17. M0/M1 are actionable delivery slices; M2–M4 are roadmap scopes to refine before implementation. Every delivery requires relevant acceptance evidence, ownership checks, and no secret logging. GitHub links are recorded in github-issues.md.

## Gate split

Local correctness can merge and unlock the next code ticket: typecheck, focused tests, production build, and review. Live acceptance stays pending and does not block later tickets: real GitHub OAuth, provider SSE, a Cloudflare deploy, Worker CPU and upload-size acceptance, billing, and the $10/month decision. Do not check a box that mixes local work with live proof. Do not close a GitHub issue while a required live check is pending. F02 does not bypass F01.

## F01: Validate deployment and UI compatibility

Phase: M0. Dependencies: none.

Prove the chosen stack can support the beta within $10/month before replacing the application.

- [x] Pin mutually compatible stable Next.js, React, AI SDK, and provider versions; use Bun for the lockfile. Recorded in f01-evidence.md. Live Worker acceptance is a separate unchecked item.
- [ ] Deploy a minimal streaming request on the selected free hosting tier; verify cancellation, secrets, runtime compatibility, and quota behavior.
- [x] Vendor Halaska from the official source with MIT attribution and a checksum-only integrity check.
- [ ] Validate the prototype in a browser: hydration, keyboard navigation, dialog focus, contrast, and reduced motion. A loopback preview exists; it is not a signed-off browser pass.
- [x] Prototype an AI Elements conversation/composer inside a Halaska shell and record the measured client chunk sizes.
- [ ] Document current recurring costs, commercial-use eligibility, and fallback from fresh price pages; stop the rollout if the budget cannot be met. Earlier notes are not a budget acceptance pass.

## F02: Establish the application foundation and CI

Phase: M0. Dependencies: F01. Local foundation work may land while F01 live checks stay open.

Replace obsolete scaffolding with a reproducible, typed foundation.

- [x] Use a Bun lockfile, strict TypeScript, and a fail-closed auth environment parser. `.env.example` documents names and nonfunctional placeholders.
- [x] Add lint, typecheck, production build, and focused tests to `.github/workflows/ci.yml` on Node 22 and Bun 1.4.3. The same commands passed locally. A hosted Actions run has not been observed.
- [x] Separate UI, chat orchestration, provider access, persistence, and auth modules. Metering remains a later ticket.
- [x] Remove Clerk, MongoDB/Mongoose, Cloudinary, and Mem0 now that Better Auth, Drizzle, and fail-closed storage/provider paths are wired.
- [x] Provide structured error IDs and redacted logs without prompts, credentials, or private documents.

## F03: Implement invite auth and ownership-safe persistence

Phase: M1. Dependencies: F02.

Provide invite-only accounts and isolate every user's data. The local Better Auth, Drizzle schema, invite allowlist, and owner filters exist. Local route and database proof is recorded in f03-evidence.md. Live GitHub OAuth remains pending, so these boxes stay open.

- [ ] Implement GitHub OAuth first, invite validation, and secure session handling. Local code fails closed without credentials. A real provider login has not been exercised.
- [ ] Create versioned database schema for profiles, conversations, messages and future usage records.
- [ ] Enforce ownership server-side on every read/write/delete and private object operation; add database policies where supported.
- [ ] Add pagination, chronological message retrieval and account deletion/export foundations.
- [ ] Support owned conversation title search, rename and delete; verify pagination and search never expose another user's history.
- [ ] Prove cross-user reads/deletes/uploads fail and expired/revoked sessions cannot operate.

## F04: Build the responsive Halaska chat shell

Phase: M1. Dependencies: F02.

Create a polished desktop/mobile experience ready for real chat state.

- [ ] Implement navigation/history, empty states, composer, model picker, settings and credit display using Halaska visual conventions.
- [ ] Adapt shadcn/AI Elements behavior behind shared components where Halaska is incomplete.
- [ ] Support light/dark themes, keyboard focus, screen readers, reduced motion, mobile safe areas and touch input.
- [ ] Reserve animation for meaningful transitions; avoid animating every streamed token.
- [ ] Verify narrow screens, long content, errors, loading and large history without layout shift.

## F05: Deliver capability-aware streaming chat

Phase: M1. Dependencies: F03, F04.

Make core chat reliable across explicitly configured providers.

- [ ] Implement AI SDK streaming with explicit Gateway and OpenRouter adapters; no implicit provider routing.
- [ ] Maintain server-side model catalog with capabilities, price snapshot and basic-model allowlist; unknown prices fail closed for funded use.
- [ ] Support stop, retry, edit/regenerate as conversation branches, copy, code rendering and persistence across reload.
- [ ] Render sources and provider-supplied reasoning only when available; distinguish errors from completed responses.
- [ ] Bound input/context/output, handle disconnects and retries without duplicate messages; avoid blocking first token on title generation.

## F06: Enforce guest limits and atomic dollar-based credits

Phase: M1. Dependencies: F03.

Protect the $10 total monthly ceiling before enabling funded requests.

- [ ] Represent USD in integer microdollars: 1 credit = $0.10; five daily credits = $0.50, reset at 00:00 UTC with no rollover.
- [ ] Reserve worst-case bounded request cost atomically against both daily user allowance and shared monthly inference budget; account for infrastructure and provider fees in the total cap.
- [ ] Settle actual input/output/reasoning/tool costs when known; retain conservative reservations on unknown usage and reconcile later.
- [ ] Make retries, concurrency, cancellation and provider failures idempotent; never double-charge or release an incurred unknown cost.
- [ ] Permit one basic guest generation with signed guest identity, rate limits and bot mitigation; disclose that cookie resets prevent perfect anonymous person-level enforcement.
- [ ] Deny tools/advanced models for guests and free funded use; show exhausted-budget and BYOK alternatives; include kill switch and spend dashboard.

## F07: Add encrypted BYOK provider settings

Phase: M1. Dependencies: F03, F05.

Let users fund their own model requests across devices.

- [ ] Support OpenRouter and Gateway user keys with masked display, test, replacement and deletion.
- [ ] Encrypt keys server-side with managed secret material, key-version metadata and a documented rotation path; never return plaintext to clients or logs.
- [ ] Choose funded versus BYOK explicitly per request; never fall back silently to platform funds.
- [ ] Show capability limitations and handle invalid/revoked keys without leaking credentials.
- [ ] Do not deduct funded model credits for BYOK; enforce separate resource and concurrency limits and explain third-party processing.

## F08: Ship and verify the gated chat beta

Phase: M1. Dependencies: F05, F06, F07.

Open the beta only when chat, privacy and spending controls work together.

- [ ] Wire all model calls, including titles and auxiliary calls, through spend enforcement before deployment.
- [ ] Run end-to-end guest-to-sign-in, invite, five-credit depletion, global cap, BYOK and history flows.
- [ ] Test concurrent requests, cross-user access, malicious Markdown, secret redaction and provider failures.
- [ ] Document retention/privacy, export/delete, basic support and quota messages.
- [ ] Record measured first-token/client performance and accessibility checks; verify backup/restore and rollback; keep advanced feature flags off.

## F09: Add explicit memory and projects

Phase: M2. Dependencies: F08.

Give users reusable context they can inspect and control.

- [ ] Implement memory create/edit/delete with explicit user save action; remove automatic Mem0 collection.
- [ ] Show which memories enter a request and bound their token budget.
- [ ] Support projects with instructions and conversation grouping; no cross-project/user leakage.
- [ ] Offer temporary chat with no durable conversation/memory storage, documented transient operational metadata and no claim about provider retention.
- [ ] Test deletion removes memory from subsequent prompts and temporary chat never populates saved history.

## F10: Add private attachments and document reading

Phase: M2. Dependencies: F08.

Let users safely ground conversations in their own files.

- [ ] Use private storage, signed access, ownership checks, size/type/page limits and per-user storage quotas.
- [ ] Start with images, text/Markdown and bounded PDF extraction; use model capability checks.
- [ ] Prevent active content execution and treat extracted instructions as untrusted data; show provenance.
- [ ] Make processing cancellable, clean up orphaned uploads and delete underlying objects with user deletion.
- [ ] Count extracted context and any OCR/provider calls in applicable budgets; no automatic paid OCR.

## F11: Create versioned Markdown and HTML artifacts

Phase: M2. Dependencies: F08.

Turn chat outputs into editable, downloadable work products.

- [ ] Create artifact records, immutable revisions and links to originating conversation messages.
- [ ] Support Markdown editing and sandboxed HTML preview with a side panel and downloads.
- [ ] Isolate preview origin/iframe, restrict scripts/network/navigation by default and prohibit parent credential access.
- [ ] Require explicit action for any external execution; do not execute MDX imports or server code.
- [ ] Test malicious HTML/links, version restore, long content and cross-user access.

## F12: Extend artifacts to charts, spreadsheets and images

Phase: M3. Dependencies: F10, F11.

Add useful structured outputs without unbounded execution.

- [ ] Split into smaller implementation tickets before starting: declarative charts, CSV/XLSX export, then BYOK image generation/editing.
- [ ] Validate chart schemas and render with a selected plotting library; never eval model code.
- [ ] Generate bounded spreadsheets with formula-injection controls and downloadable artifacts.
- [ ] Treat MDX as restricted structured content, not arbitrary executable modules.
- [ ] Show estimates and require explicit paid-provider selection for image tasks; retain provenance, revisions and file limits.

## F13: Add bounded tools, cited web search and MCP

Phase: M3. Dependencies: F08, F11.

Introduce tool use with observable, limited execution.

- [ ] Split into tools runtime, web search, then remote MCP integration tickets before starting.
- [ ] Use the version-matched AI SDK agent/tool APIs with step, time, token and cost limits and visible tool state.
- [ ] Provide sourced web results with explicit provider funding; BYOK model keys do not pay search fees.
- [ ] Support scoped per-user remote MCP connections, encrypted credentials, revocation and SSRF protections.
- [ ] Require approval for consequential writes; treat tool/search results as untrusted input and prevent secret exfiltration.

## F14: Add connectors and durable sandbox/browser tasks

Phase: M4. Dependencies: F13.

Enable longer autonomous work only with separate execution funding.

- [ ] Split into read-only connector OAuth, durable jobs, sandbox execution and browser-use tickets before starting.
- [ ] Start with one read-only connector selected from actual beta demand; minimize OAuth scopes and support revocation/deletion.
- [ ] Persist job lifecycle, checkpoints, cancellation, idempotency and recovery outside request-bound chat routes.
- [ ] Run isolated ephemeral sandboxes with network/secret restrictions, resource limits, idle shutdown and audit trail.
- [ ] Require explicit approval for external messages, purchases, uploads or irreversible mutations.
- [ ] Choose sandbox vendor after pricing validation; advanced execution stays disabled until separately funded within an approved budget.


## F15: Redesign the home and landing page

Phase: M1. Dependencies: #8, #9, #10, #11 local implementation. Deliver before the public beta gate #12. Parent roadmap: #4.

Replace the old home/landing page with a distinctive, polished introduction to the rebuilt Galaxy Chat. Carry the chat application's semantic design system into a fast, responsive public experience. Choose the best suitable free components regardless of library; use the installed design.how workflow. Routine visual decisions are delegated to the implementation agent.

Acceptance criteria:

- [ ] Audit the current homepage and replace outdated branding, library-era copy, navigation, screenshots and unsupported claims. Establish a cohesive visual direction, typography, spacing and light/dark/system behavior consistent with the real chat shell.
- [ ] Design a strong hero, clear product explanation, useful feature/benefit sections and a clear primary action. Show a real shared UI or explicitly labeled preview; no invented conversations presented as real, testimonials, customer counts or performance promises.
- [ ] Support the agreed entry flow: one bounded basic guest prompt when configured, then sign-in; invited signed-in users continue to chat. Coordinate guest interaction implementation with #12, preserving the server's quota, bot/proxy and authentication checks. Unconfigured/exhausted states must remain useful and honest.
- [ ] Explain BYOK and platform funding accurately: five daily credits ($0.50) reset at 00:00 UTC, subject to shared funding; provider charges apply to BYOK. Do not promise guaranteed free inference, unlimited use, all-model access or unfinished memory/artifact/tool/browser capabilities. Distinguish delivered features from roadmap items.
- [ ] Provide working sign-in/chat, privacy/data-control and support links using real routes or explicitly unavailable states. Preserve existing routing, session and ownership behavior; do not change auth or billing policy as part of the redesign.
- [ ] Make phone/tablet/desktop layouts accessible: semantic headings, labeled controls, visible keyboard focus, readable contrast, touch targets, contained overflow and reduced motion. Use restrained animation with a clear purpose and no heavy decorative runtime.
- [ ] Keep initial loading fast: server-render static content where appropriate, avoid unnecessary client bundles or paid dependencies, optimize any imagery and provide meaningful page metadata/social previews. Use installed Next.js version documentation.
- [ ] Record independent browser evidence for desktop and phone, light/dark themes and primary CTA states; run relevant lint/type/build checks. Report measured performance/accessibility results with the test conditions, and leave physical-device/live-provider checks pending when unavailable.

Out of scope: provisioning/deploying services, enabling billing, real paid inference, replacing the chat shell again, or implementing every roadmap capability. Safe placeholders must build without credentials. This ticket does not override #12's live beta acceptance gate.
