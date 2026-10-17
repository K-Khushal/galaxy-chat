# Galaxy Chat rebuild plan

Date: 2026-10-17. Status: product direction accepted; implementation not started. This plan supersedes conflicting legacy requirements.md choices for the rebuild.

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

Use TypeScript, Next.js App Router, React, Bun package management, Vercel AI SDK, AI Elements and shadcn behavior adapted to Halaska's visual language. Pin mutually compatible stable versions during F01, including the deployment adapter; do not choose package versions solely because they are newest.

Use a single application initially. Separate modules for identity/ownership, conversations, model catalog/provider routing, usage reservations, encrypted credentials and rendering. Later add artifacts, memory and jobs at these boundaries rather than introducing microservices now.

Database choice: Supabase Free for PostgreSQL, Auth and private Storage, with transactional reservations and row-level access controls. Use GitHub OAuth first. Its free tier has capacity, inactivity and backup limitations; record and monitor these before beta. See stack-research.md for sourced details.

Hosting target: Cloudflare Workers with OpenNext, conditional on a production streaming/build/CPU compatibility spike. Bun is the development toolchain, not the Workers runtime. Do not substitute a beta runtime silently. If the free tier cannot fit, review a concrete alternative within the $10 cap; Vercel Hobby is restricted to qualifying personal non-commercial use, and paid Workers can incur overages.

Provider access: explicit Gateway and OpenRouter adapters. Prefer Gateway for funded chat while eligible for its recurring free allowance; verify account eligibility because purchasing credit ends that recurring allowance. Select the basic model from current cost/capability data during F01 and configure it server-side; do not hard-code a model name from memory. Unknown model pricing cannot use platform funds. Disable automatic paid fallback.

Keep server secrets and key decryption within provider execution. Do not expose keys through browser state, analytics, traces or errors. Separate the encryption key from the database; version ciphertext and document rotation.

Store conversations, messages/branches, model metadata, credential metadata and usage reservations in the database. Add private object storage for attachments/artifacts only at M2. Use bounded chronological context with a documented truncation strategy; avoid hidden paid summarization initially.

Future durable jobs persist lifecycle and checkpoints independently of HTTP requests. Browser execution belongs in an isolated third-party sandbox, never the application server. Job orchestration and sandbox vendor selection remain implementation-time feasibility decisions after budget validation.

## UI implementation rules

Halaska defines visual conventions. Use shared wrappers/adapted patterns to avoid inconsistent parallel design systems. Its examples do not supply application state, persistence or safe artifact execution.

Vendor the official kit and attribution only after inspection, record provenance/checksum, and verify client boundaries, SSR/hydration, styling and actual bundled size. The requested kit installation belongs to F01; no kit or packages have been installed during planning.

Retain accessible shadcn/AI Elements behavior where Halaska lacks a suitable primitive. Validate keyboard navigation, focus management, screen-reader semantics, contrast, reduced motion and mobile input. Prefer transform/opacity animation for meaningful state changes; token streaming should remain visually stable.

Official references: [installation](https://ui.halaska.com/docs/install), [component coverage](https://ui.halaska.com/components), [source and license](https://github.com/Halaska-Studio/ui). Accessibility and performance remain unverified until the spike.

## Data and trust boundaries

All reads and writes derive ownership from authenticated server identity, never request-supplied user IDs. Include private file access, chat exports/deletes, memories, artifacts and jobs. Integration tests must prove user A cannot access user B's records or objects.

Memory is explicitly saved, visible, editable and deletable. Temporary chats do not enter saved history or memory; disclose any transient logs and provider-side retention separately.

Render Markdown safely. HTML previews use an isolated sandbox with restrictive network/navigation policy. Do not evaluate arbitrary MDX modules, spreadsheet formulas on the server, or generated code inside the app runtime.

Remote MCP/tool output, web pages and documents are untrusted input. Connection scopes, revocation, SSRF prevention and approval before consequential external writes are prerequisites for those milestones.

## Delivery and quality gates

1. M0 — F01–F02: prove deployment, stack and Halaska; establish reproducible build/CI.
2. M1 — F03–F08: secure identity/data, polished shell, reliable chat, atomic quotas and BYOK. Release invite beta only after all gates pass.
3. M2 — F09–F11: explicit memory/projects, private attachments and versioned Markdown/HTML artifacts.
4. M3 — F12–F13: charts/sheets/images, bounded tools, cited web search and MCP. Split roadmap scopes before implementation.
5. M4 — F14: connectors, durable jobs and isolated browser work with explicit funding and approval boundaries.

No calendar promises until F01 establishes feasibility and F02 establishes a build baseline. Work in dependency order, one reviewable vertical slice at a time. The backlog defines acceptance criteria and dependencies.

Required beta evidence: lint/typecheck/build, cross-user access tests, concurrent budget exhaustion, idempotent retries, cancellation and unknown-usage handling, guest limits, key redaction, provider failure behavior, keyboard/mobile checks and a verified deployed streaming flow. Measure first-token and UI responsiveness on a reference device/network; record results rather than inventing latency guarantees.

## Existing repository findings

Current code uses Next 15.5.9, React 19.1, AI SDK 5, Clerk, MongoDB/Mongoose, Cloudinary and Mem0. It contains streaming chat, two model options, search toggle, image uploads and history, but no complete credit/BYOK/artifact/tool system.

The audit identified missing ownership/auth checks in chat reads/deletes and upload operations; these are release blockers, not features to carry forward. The existing OpenRouter client is unused while string model IDs imply Gateway routing. Current title generation delays streaming. Existing context retrieval takes the oldest 100 messages. Replace these behaviors in F03/F05/F08.

Existing .gitignore changes and untracked skills-lock.json are outside this planning change.

## Tracking and remaining prerequisites

Use backlog.md as the local ticket source. github-issues.md records all published URLs. The roadmap is GitHub issue #4 and F01–F14 are issues #5–#18 in K-Khushal/galaxy-chat. Publication succeeded through gh with network access; the integration itself still returned 403. The earlier CLI invalid-login report was caused by the restricted environment.

No deployment, billing signup, package upgrade, application rewrite or UI retrofit has occurred during this planning step.

