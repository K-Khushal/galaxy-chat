# Current stack

What is checked in after the M0 teardown. Exact versions are in `package.json` and `bun.lock`. The rebuild plan is the `v1` roadmap issue; binding decisions are in [`adr/`](adr/).

| Area | Implementation |
| --- | --- |
| Application | Next.js 16 App Router, React 19, TypeScript |
| Toolchain | Node.js 22+, Bun (CI 1.4.3), Biome |
| Styling and UI | Tailwind CSS 4, shadcn/ui on Base UI (`base-nova`), OKLCH tokens in `app/globals.css`, Lucide, Sonner, next-themes; `/design` (dev only) renders every primitive |
| Authentication | Better Auth with GitHub OAuth and a server-enforced invite allowlist |
| Persistence | Drizzle ORM and postgres.js; versioned SQL migrations in `drizzle/` |
| Markdown | Streamdown, wrapped in `components/elements/response.tsx` |
| Secrets | AES-256-GCM sealing for BYOK keys in `lib/byok/crypto.ts` |
| Configuration | One zod schema in `lib/env.ts`, mirrored by `.env.example` |
| Verification | Bun tests with PGlite, TypeScript, Biome; CI runs the same four checks |

Not here yet, by design: AI SDK, model registry, chat, Credits and BYOK key storage. They arrive in M1–M8 on top of this foundation.
