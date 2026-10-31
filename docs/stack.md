# Current stack

What is checked in. Exact versions are in `package.json` and `bun.lock`. The rebuild plan is the `v1` roadmap issue; binding decisions are in [`adr/`](adr/).

| Area | Implementation |
| --- | --- |
| Application | Next.js 16 App Router, React 19, TypeScript |
| Toolchain | Node.js 22+, Bun (CI 1.4.3), Biome |
| Styling and UI | Tailwind CSS 4, shadcn/ui on Base UI (`base-nova`), OKLCH tokens in `app/globals.css`, Lucide, Sonner, next-themes; `/design` (dev only) renders every primitive |
| Authentication | Better Auth with GitHub/Google OAuth and email one-time codes; open sign-up |
| Persistence | Drizzle ORM and postgres.js; versioned SQL migrations in `drizzle/` |
| Markdown | Streamdown, wrapped in `components/elements/response.tsx` |
| Secrets | AES-256-GCM sealing for BYOK keys in `lib/byok/crypto.ts` |
| Redis | One TCP/TLS connection (`REDIS_URL`, node-redis) from `lib/redis.ts`, created on first use, plus a second subscriber connection for resumable-stream pub/sub. It backs Better Auth `secondaryStorage` (sessions, sign-in codes), the fixed-window limits in `lib/ratelimit.ts` (email-code requests per IP and per address, Message sends, BYOK saves), Generation locks and Stop signals. No REST client |
| Configuration | zod schemas in `lib/env.ts`, one per concern (database, auth, Redis, Platform key, BYOK keyring), each read on first use and mirrored by `.env.example`. A missing variable fails with its name when something uses it, not at startup |
| Attachments | Cloudflare R2 through the S3 API (`@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`) in `lib/attachments/`. Browsers PUT directly to a presigned URL that signs the content type and exact length; the server then verifies size, type and magic bytes. The PUT targets the final key `u/<userId>/<attachmentId>` with signed `If-None-Match: *`, making the object immutable; confirm conditionally marks it ready without a copy. Independent key tombstones survive User and Chat cascades. Lazy global cleanup removes deleted objects after the URL expires and retains minimal tombstones for late in-flight writes. Models read images and (where supported) PDFs through short-lived presigned GET URLs; other PDFs go in as text extracted with `unpdf`, and text and code files go in as capped text. Variables `R2_*`, read lazily |
| Verification | Bun tests with PGlite, TypeScript, Biome; CI runs the same four checks |

Not here yet, by design: the rest of M5–M8. They arrive on top of this foundation.
