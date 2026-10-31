# Galaxy Chat

A multi-model AI chat application, being rebuilt in milestones M0–M8 (see the `v1` roadmap issue). Sign in with GitHub, Google or an email code. Eligible new Users receive 10 one-time Credits. Chat comes back in later milestones.

Read [`GLOSSARY.md`](GLOSSARY.md) for the vocabulary, [`docs/adr/`](docs/adr/) for the decisions and [`docs/stack.md`](docs/stack.md) for the stack.

## Local setup

Requires Node.js 22+, Bun, PostgreSQL, GitHub and Google OAuth apps, Resend, Upstash Redis and Cloudflare Turnstile.

1. `bun install --frozen-lockfile`
2. Copy `.env.example` to `.env.local` and fill it in. `lib/env.ts` validates it and reports every missing value.
3. Set OAuth callback URLs to `<BETTER_AUTH_URL>/api/auth/callback/github` and `<BETTER_AUTH_URL>/api/auth/callback/google`. Verify your Resend sending domain and configure Turnstile for your hostname. Keep `CREDIT_IDENTITY_KEY` stable to preserve grant deduplication.
4. `bun run db:migrate` applies pending SQL files from `drizzle/` in one transaction.
5. `bun run dev`

## Checks

Run in this order before pushing: `bun run lint`, `bun run typecheck`, `bun test`, `bun run build`. Tests use PGlite and need no database.
