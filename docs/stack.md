# Current implementation stack

This describes the checked-in application and lockfile, not a hosting or pricing guarantee. Last reconciled October 25, 2026. Exact installed versions are in `package.json` and `bun.lock`.

| Area | Implementation |
| --- | --- |
| Application | Next.js 16.4.2 App Router, React / React DOM 19.3.1, TypeScript |
| Toolchain | Node.js 22+, Bun (CI 1.4.3), Biome 2.2.0 |
| Styling and UI | Tailwind CSS 4, Radix primitives, shared design.how styling, Lucide, Sonner, next-themes |
| AI | AI SDK 7.0.143, React integration 4.0.147, OpenRouter adapter 3.1.0, Gateway through AI SDK |
| Authentication | Better Auth 1.7.10, GitHub OAuth and a server-enforced invite allowlist |
| Persistence | Drizzle ORM 0.45.4, postgres.js 3.4.9; versioned SQL migrations in `drizzle/` |
| Storage | Server-only Supabase private-storage integration; Supabase is the intended PostgreSQL host |
| Documents/artifacts | unpdf, sanitized Markdown/HTML pipeline, Recharts, vendored SheetJS 0.20.3, fast-png |
| Verification | Bun tests, disposable PGlite fixtures, native F10/F11 PostgreSQL CI harness, TypeScript, Biome |
| Hosting adapter | OpenNext Cloudflare 1.20.12, Wrangler 4.151.1; building does not deploy |

Better Auth owns sessions; Supabase Auth is not used. Clerk, MongoDB/Mongoose, Cloudinary, automatic Mem0 collection and their old auth/forms/upload paths are retired. No email/password login is supported.

Model routes, capabilities, prices and budget plans are operator-reviewed configuration, not seeded promises. Authenticated UI/data testing needs no inference key. Actual chat additionally needs a configured eligible BYOK route or explicit platform funding. Empty settings fail closed.

MCP, durable jobs, sandbox journals and browser-policy foundations remain in the repository because they are reviewed implementations, not unused starter code. Remaining connector and advanced-execution delivery is deferred; provider/resource-stop denial and retained liabilities remain enforced. Do not remove migrations, tests or retained financial history as cleanup.

The local implementation/review checkpoint is complete through PR #64. Live OAuth, Supabase, providers, hosting, device/accessibility and total operating-budget evidence remain separate acceptance gates. The platform ceiling is $10/month including infrastructure, fees, reserves and carried liabilities; no free-tier assumption establishes compliance.

For testing, use [local testing](operations/local-testing.md). For historical research, see [the dated stack investigation](planning/stack-research.md); its early proposals are superseded by this implementation description.
