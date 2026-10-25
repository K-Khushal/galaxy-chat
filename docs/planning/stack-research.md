# Low-cost beta stack research

> Historical research snapshot. Early proposals below (including Supabase Auth and Google OAuth) are not the implemented baseline. Use [the current stack](../stack.md) and [local testing](../operations/local-testing.md) for setup. Provider prices/allowances below are dated research, not verified operating-budget commitments.

Verified 2026-10-17. Prices are USD, exclude taxes, and are not guarantees of future availability. Recommendations below are engineering judgments; linked facts come from primary sources.

## Recommended baseline

Use one Next.js App Router application with TypeScript, Bun for installation/scripts/tests, AI SDK, and Supabase Free for Postgres, Auth, and private object storage. Keep the credit ledger in Postgres transactions. Start with GitHub/Google OAuth and an application invite allowlist. Use Vercel AI Gateway for platform-funded chat while eligible for its free credits, and support user-owned Gateway/OpenRouter credentials through an explicit provider boundary. Do not introduce Redis, a separate vector database, queues, or a paid observability service in the first milestone.

Target Cloudflare Workers, subject to an early compatibility and resource-budget spike. Prefer testing OpenNext against the normal Next.js build first to preserve the requested framework; compare vinext only if needed. This deliberately differs from Cloudflare's current default recommendation because vinext remains beta. Do not promise that a full Next.js application fits the Workers Free limits before measuring it.

## Framework and runtime findings

- Official Next.js release notes show **16.4** as released October 6, 2026. Choose the latest security-patched stable release compatible with the deployment adapter when implementing, rather than copying this minor version into an untested migration. [Next.js 16.4](https://nextjs.org/blog/next-16-4), [release/security index](https://nextjs.org/blog).
- AI SDK's current introduction labels its documentation **v7 Latest**, with a published 6-to-7 migration guide. Use current v7 APIs and compatible provider packages, then lock exact tested versions. Do not assume the old v6 examples apply. [AI SDK introduction](https://ai-sdk.dev/docs/introduction), [migration guide](https://ai-sdk.dev/docs/migration-guides/migration-guide-7-0).
- Bun's release index lists **1.4.3**, released October 10, 2026. Bun can be the local toolchain without being the deployed runtime: Workers runs its own runtime. Avoid Bun-specific server APIs in application code intended for Workers. [Bun release index](https://bun.sh/blog), [Workers framework guide](https://developers.cloudflare.com/workers/framework-guides/web-apps/nextjs/).
- Exact npm versions and cross-package compatibility remain implementation checks, not established by documentation labels alone. Record the resolved versions and lockfile in the foundation ticket.

## Hosting decision

| Candidate | Verified constraint | Decision |
| --- | --- | --- |
| Cloudflare Workers Free | 100,000 requests/day; 10ms CPU per invocation. OpenNext documents a 3MiB compressed Worker limit on Free. | Try first; measure production output, auth, SSR, and long streaming responses. Network wait and CPU are different budgets. |
| Cloudflare Workers Paid | $5/month subscription plus usage beyond allowances; CPU limits can be configured. | Fallback within the $10 target, but it consumes half the budget before AI usage and is not a hard monthly billing cap. |
| Vercel Hobby | Personal, non-commercial use only. | Suitable only if actual use qualifies. Do not base a commercial product plan on this tier. |

Sources: [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/), [OpenNext compatibility and size limits](https://opennext.js.org/cloudflare), [Vercel Hobby](https://vercel.com/docs/plans/hobby).

Cloudflare now recommends **vinext**, a Vite implementation of the Next.js API surface, while explicitly describing it as beta. OpenNext remains documented as another path and its own documentation claims Next.js 16 minor/patch support. These are not equivalent runtimes. The foundation spike must test SSE delivery/cancellation, cookie auth, WebCrypto key encryption, database transactions, cold starts, bundle size, CPU use, and production preview. [Cloudflare Next.js guide](https://developers.cloudflare.com/workers/framework-guides/web-apps/nextjs/), [OpenNext](https://opennext.js.org/cloudflare).

## Database, auth, and storage

| Option | Current free allowances / tradeoffs | Assessment |
| --- | --- | --- |
| Supabase Free | 500MB database, 50,000 monthly active users, 1GB storage, 5GB egress; projects pause after one week of inactivity; automatic backups are not included. Pro starts at $25/month. | Recommended for the initial beta: a single integrated backend with explicit ownership/RLS policies and a small operational footprint. Quota exhaustion requires reducing usage or revisiting budget, not silently upgrading. |
| Neon Free + Better Auth | Current pricing lists 1GB database/project, 100 CU-hours/project/month, 5GB public transfer, managed Better Auth, and 5GB object storage. Scale-to-zero introduces wake-up behavior. | Strong alternative; older articles quoting 0.5GB/50 CU-hours are stale. If chosen, validate managed-auth and storage integration before treating it as a drop-in equivalent. Self-hosting Better Auth adds application auth responsibilities. |

Sources: [Supabase pricing](https://supabase.com/pricing), [Supabase billing](https://supabase.com/docs/guides/platform/billing-on-supabase), [Neon pricing](https://neon.com/pricing), [Better Auth introduction](https://better-auth.com/docs/introduction).

Supabase's bundled SMTP is not a production email service: delivery is restricted to project-team addresses and currently limited to two messages/hour. OAuth avoids introducing email delivery in the first slice; add custom SMTP before offering email-based login or recovery. Invite emails are not required: an admin can allowlist a verified OAuth identity and share the app URL separately. [Supabase SMTP documentation](https://supabase.com/docs/guides/auth/auth-smtp).

## Inference routing and budget

- Gateway currently documents $5/month free credits, zero token markup, and no Gateway fee for provider BYOK. **Purchasing credits transitions the account to paid and removes the recurring free allowance.** Do not budget purchased credit plus $5 free indefinitely. Keep auto top-up off. [Gateway pricing](https://vercel.com/docs/ai-gateway/pricing).
- OpenRouter Standard charges 5.5% on credit purchases while passing through provider inference pricing. Its current BYOK allowance is based on list-price inference dollars, not the older request-count rule: Standard/Business include $25,000 monthly list-price BYOK inference before a 5% fee. User-owned OpenRouter credentials are distinct from storing direct provider credentials in OpenRouter. [OpenRouter pricing](https://openrouter.ai/pricing), [support](https://openrouter.ai/support).
- Free-model availability and rate limits should not define reliability promises. Choose a small allowlist from current model metadata, validate tool/image/reasoning capabilities individually, and use price ceilings rather than a permanently hard-coded model recommendation. [Gateway model catalog](https://vercel.com/ai-gateway/models), [OpenRouter pricing](https://openrouter.ai/pricing).

Product budget rules (derived from the agreed requirements): five daily credits equal $0.50, not a guarantee of funded capacity. One fully active user would consume $15 over 30 days. Reserve conservative request costs atomically against both user and shared monthly balances; settle with actual usage and retain unresolved reservations until reconciled. Include input context, output/reasoning tokens, retries, title generation, and tool fees. Use integer monetary units, idempotent settlement, bounded output, and fail closed when pricing or funding is unknown. BYOK bypasses the platform inference allowance, not abuse controls or infrastructure quotas.

Allocate a **single $10 total monthly cash budget**, subtracting hosting, taxes/fees, and other commitments before assigning an inference limit. Free-tier cloud quotas and an application ledger do not by themselves guarantee zero infrastructure overage. Keep paid features disabled by default, monitor service quotas, and define shutdown behavior before public access. Domains, email, search, sandbox/browser compute, image generation, and backup storage need their own estimates before enabling them; they are not paid for by an LLM key.

This research provisions no services and authorizes no purchases. Do not create a paid service, enable billing or automatic upgrades, or add a payment method as part of the foundation spike. Keep vinext out of the baseline while it is beta. A paid Workers fallback is an option to review with its concrete cost controls if the free deployment fails, not an automatic escalation.

## Foundation acceptance gates

1. Resolve and pin stable framework/provider packages; verify no preview package is adopted accidentally.
2. Demonstrate the production Worker build fits the selected tier and streams a real provider response with cancellation and final accounting.
3. Verify invitation gating, cross-user access denial, private storage policies, and encrypted-key isolation.
4. Prove simultaneous requests cannot overspend either allowance; exercise failed/aborted streams and crash reconciliation.
5. Record a deployment bill-of-materials and quota dashboard; prove the default configuration cannot auto-purchase inference credit.
6. Defer paid browser/sandbox and arbitrary execution until a separate cost/security spike succeeds.
