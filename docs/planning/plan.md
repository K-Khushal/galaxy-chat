# Galaxy Chat rebuild plan

Plan established 2026-10-17; status updated 2026-10-25: current-phase local implementation/reviews complete; live acceptance pending. Remaining connectors and advanced execution are deferred to the next phase. This plan supersedes the original legacy stack requirements for the rebuild.

## Product and release boundary

An AI workspace for developers and technical power users who want model choice, their own keys, reusable context and useful outputs. Ship a reliable chat beta first. No existing customers or production data need migration. Preserve unrelated working-tree changes; replace old modules incrementally behind a coherent new architecture.

The first release includes responsive streaming chat, invite-only authentication, one guest prompt, basic funded models, encrypted BYOK, conversation history/search, branching edit/regenerate, accessible code/Markdown, light/dark theme, clear spend states and account controls. Memory, attachments and artifacts follow after the beta quality gate.

Do not market universal model capability: expose supported providers and per-model capabilities. No paid subscription, team workspace, voice/realtime, native mobile app or public sharing in the initial release. These remain candidates after evidence from beta users.

## Agreed commercial and quota policy

- Total recurring platform budget: $0–$10/month, including hosting, inference, storage, search and execution. No blanket promise that the full roadmap can operate at that price.
- One credit is $0.10. Five daily credits represent a maximum $0.50 allowance, available only while shared funding remains. Daily reset is 00:00 UTC; no rollover or cash value.
- Platform inference budget is at most $10 minus all committed infrastructure fees, provider payment fees and a safety reserve. Keep a configurable cap and kill switch; no automatic top-ups.
- Track integer microdollars, not floating-point currency. Record immutable usage/ledger entries and provider price snapshots.
- Atomically reserve bounded worst-case cost across user and global budgets before sending a request. Reconcile actual usage, retaining conservative holds where final usage is unavailable. Include every auxiliary model call.
- A single fully active free user could use $15 per 30-day month; shared availability must be communicated before users encounter exhaustion.
- Guest: one bounded basic text generation, no tools, files, advanced models or durable memory. Signed guest IDs plus rate limits and bot checks reduce abuse but cannot prove one real person across devices/cookie resets.
- Invite-only accounts initially. GitHub OAuth is the first login option, avoiding an email delivery dependency. Invitation gating applies server-side.
- BYOK is explicit, encrypted at rest, deletable and usable across devices. Never silently substitute platform keys. BYOK model usage does not consume funded credits; concurrency, storage and execution limits still apply.
- Runtime sandbox/browser and paid search are disabled until funded separately within an approved operating budget. Free trials are not treated as permanent funding.

## Architecture direction

Use TypeScript, Next.js App Router, React, Bun package management, Vercel AI SDK, AI Elements and shadcn behavior adapted to Halaska's visual language. Pin mutually compatible stable versions during the local F01/F02 slice. Live deployment acceptance stays pending after that pin.

Use a single application initially. Separate modules for identity/ownership, conversations, model catalog/provider routing, usage reservations, encrypted credentials and rendering. Later add artifacts, memory and jobs at these boundaries rather than introducing microservices now.

Database and storage: Supabase Free for PostgreSQL and private Storage only. Do not use Supabase Auth. Authentication is Better Auth with the Drizzle adapter and postgres.js (`prepare: false` for the Supabase pooler). Ownership is the Better Auth user id enforced in application queries. Do not assume `auth.uid()`. Never expose a storage secret to the browser. GitHub OAuth is the first login option. Invitation gating applies server-side. Missing auth configuration fails closed with an error id and does not invent a session.

Hosting target: Cloudflare Workers with OpenNext, conditional on a production streaming/build/CPU compatibility spike. Bun is the development toolchain, not the Workers runtime. Do not substitute a beta runtime silently. If the free tier cannot fit, review a concrete alternative within the $10 cap; Vercel Hobby is restricted to qualifying personal non-commercial use, and paid Workers can incur overages. A local OpenNext bundle is not a deploy or a size acceptance pass.

Provider access: explicit Gateway and OpenRouter adapters. Prefer Gateway for funded chat while eligible for its recurring free allowance; verify account eligibility because purchasing credit ends that recurring allowance. Select the basic model from current cost/capability data during F01 and configure it server-side; do not hard-code a model name from memory. Unknown model pricing cannot use platform funds. Disable automatic paid fallback.

Keep server secrets and key decryption within provider execution. Do not expose keys through browser state, analytics, traces or errors. Separate the encryption key from the database; version ciphertext and document rotation.

Store conversations, messages/branches, model metadata, credential metadata and usage reservations in the database. Add private object storage for attachments/artifacts only at M2. Use bounded chronological context with a documented truncation strategy; avoid hidden paid summarization initially.

Future durable jobs persist lifecycle and checkpoints independently of HTTP requests. Browser execution belongs in an isolated third-party sandbox, never the application server. Job orchestration and sandbox vendor selection remain implementation-time feasibility decisions after budget validation.

## UI implementation rules

Halaska defines visual conventions. Use shared wrappers/adapted patterns to avoid inconsistent parallel design systems. Its examples do not supply application state, persistence or safe artifact execution.

Vendor the official kit and attribution only after inspection, record provenance/checksum, and verify client boundaries, SSR/hydration, styling and actual bundled size. The kit is vendored. Browser keyboard and contrast acceptance is still pending.

Retain accessible shadcn/AI Elements behavior where Halaska lacks a suitable primitive. Validate keyboard navigation, focus management, screen-reader semantics, contrast, reduced motion and mobile input. Prefer transform/opacity animation for meaningful state changes; token streaming should remain visually stable.

Official references: [installation](https://ui.halaska.com/docs/install), [component coverage](https://ui.halaska.com/components), [source and license](https://github.com/Halaska-Studio/ui). Accessibility and performance remain unverified until the spike.

## Data and trust boundaries

All reads and writes derive ownership from authenticated server identity, never request-supplied user IDs. Include private file access, chat exports/deletes, memories, artifacts and jobs. Integration tests must prove user A cannot access user B's records or objects.

Memory is explicitly saved, visible, editable and deletable. Temporary chats do not enter saved history or memory; disclose any transient logs and provider-side retention separately.

Render Markdown safely. HTML previews use an isolated sandbox with restrictive network/navigation policy. Do not evaluate arbitrary MDX modules, spreadsheet formulas on the server, or generated code inside the app runtime.

Remote MCP/tool output, web pages and documents are untrusted input. Connection scopes, revocation, SSRF prevention and approval before consequential external writes are prerequisites for those milestones.

## Delivery and quality gates

Local code correctness can merge and unlock the next ticket: typecheck, tests, a production `next build`, and review. Live acceptance stays visibly pending and does not block later tickets: GitHub OAuth against a real app, provider SSE, cancellation on a host, Cloudflare deploy, Worker CPU/size acceptance, billing, and the $10/month go/no-go. Do not mark those live checks passing, and do not close a GitHub issue while one of its required live checks is still pending. F02 does not bypass F01; the local slice may land while F01's live checks remain open.

1. M0 — F01–F02: prove deployment, stack and Halaska; establish reproducible build/CI. Local foundation can proceed; live deploy proof remains open.
2. M1 — F03–F08: secure identity/data, polished shell, reliable chat, atomic quotas and BYOK. Release invite beta only after all gates pass.
3. M2 — F09–F11: explicit memory/projects, private attachments and versioned Markdown/HTML artifacts.
4. M3 — F12–F13: charts/sheets/images, bounded tools, cited web search and MCP. Split roadmap scopes before implementation.
5. M4 — F14: connectors, durable jobs and isolated browser work with explicit funding and approval boundaries.

No calendar promises until the pending F01 live checks and the F02 CI gate are recorded. Work in dependency order, one reviewable vertical slice at a time. The backlog defines acceptance criteria and dependencies.

Required beta evidence: lint/typecheck/build, cross-user access tests, concurrent budget exhaustion, idempotent retries, cancellation and unknown-usage handling, guest limits, key redaction, provider failure behavior, keyboard/mobile checks and a verified deployed streaming flow. Measure first-token and UI responsiveness on a reference device/network; record results rather than inventing latency guarantees.

## Existing repository findings

The local foundation now pins Next 16.4.2, React 19.3.1, AI SDK 7.0.143, Better Auth 1.7.10, Drizzle 0.45.4, and postgres.js 3.4.9. Clerk, MongoDB/Mongoose, Cloudinary, and Mem0 are removed from the dependency list. Chat reads and writes filter on the Better Auth user id. Unconfigured auth, database, storage, and provider calls return error ids and do not create a session. `bun run build` completes without credentials. `bun run build:workers` produces an OpenNext bundle and does not deploy it.

The audit identified missing ownership/auth checks in chat reads/deletes and upload operations; the new routes require a session and an owner id. Uploads still fail closed because private storage is not wired. The chat route uses the OpenRouter provider when `OPENROUTER_API_KEY` is set. Title generation still runs before the stream when that key is present. Existing context retrieval behavior is replaced by the Drizzle message query. Credit, BYOK, artifact, and tool systems are not in this slice.

## Tracking and remaining prerequisites

Use backlog.md as the local ticket source. github-issues.md records all published URLs. The roadmap is GitHub issue #4 and F01–F14 are issues #5–#18 in K-Khushal/galaxy-chat.

Live OAuth, provider streaming, deployment, Worker acceptance, and billing remain pending. Placeholders live in `.env.example`. Real `.env` files stay gitignored. No cloud resource was provisioned in this slice.
