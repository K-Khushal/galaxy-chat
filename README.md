# Galaxy Chat

A multi-model AI chat application, being rebuilt in milestones M0–M8 (see the `v1` roadmap issue). Today the app is a foundation: GitHub sign-in through Better Auth, a Postgres client with a migration runner, and a placeholder home page. Chat comes back in later milestones.

Read [`GLOSSARY.md`](GLOSSARY.md) for the vocabulary, [`docs/adr/`](docs/adr/) for the decisions and [`docs/stack.md`](docs/stack.md) for the stack.

## Local setup

Requires Node.js 22+, Bun, a PostgreSQL database and a GitHub OAuth application.

1. `bun install --frozen-lockfile`
2. Copy `.env.example` to `.env.local` and fill it in. `lib/env.ts` validates it and reports every missing value.
3. Set the OAuth callback URL to `<BETTER_AUTH_URL>/api/auth/callback/github`, and add your GitHub login to `GITHUB_INVITE_LOGINS`.
4. `bun run db:migrate` applies pending SQL files from `drizzle/` in one transaction.
5. `bun run dev`

## Checks

Run in this order before pushing: `bun run lint`, `bun run typecheck`, `bun test`, `bun run build`. Tests use PGlite and need no database.
