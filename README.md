# Galaxy Chat

An invite-only chat application built with Next.js 16, React 19, AI SDK 7, Better Auth, Drizzle and PostgreSQL. Local implementations include owned chat history, streaming and branches, budget accounting, encrypted provider keys, a bounded guest flow, and public landing/help/privacy pages. Live provider, hosted runtime and beta acceptance checks remain tracked separately in [beta operations](docs/operations/beta.md).

Current implementation details: [stack](docs/stack.md). Complete configuration and testing walkthrough: [local testing](docs/operations/local-testing.md).

## Local setup

Requires Node.js 22+, Bun, a PostgreSQL connection (Supabase direct or pooler), and a GitHub OAuth application.

1. Install dependencies: `bun install --frozen-lockfile`.
2. Copy `.env.example` to `.env.local` (preserve it if it already exists) and configure `DATABASE_URL`, `BETTER_AUTH_SECRET` (at least 32 characters), `BETTER_AUTH_URL`, `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET`. Existing `.env` files also work. Never commit credentials.
3. Add your GitHub username to `GITHUB_INVITE_LOGINS` (comma-separated). An empty list allows nobody to sign in.
4. Match your OAuth application's callback URL to `<BETTER_AUTH_URL>/api/auth/callback/github`. Use the same hostname and port in your browser and `BETTER_AUTH_URL`, for example `http://127.0.0.1:3000`.
5. **Run `bun run db:migrate` before signing in.** Environment configuration alone does not create database tables. The command applies all pending SQL migrations in `drizzle/` in a transaction. Repeating it skips recorded versions.
6. Run `bun run dev` and open the configured local URL. Restart the server after changing environment values.

The migration command uses Next.js environment-file precedence and defaults to development. For production configuration, run `NODE_ENV=production bun run db:migrate`; exported environment variables take precedence. Use the server PostgreSQL role, never a public Supabase API key. The app uses Better Auth rather than Supabase Auth.

If sign-in fails with `relation "verification" does not exist`, run the migration command against the same database as the application. If the migration fails, resolve that error before retrying sign-in; do not delete the database or bypass authentication.

## Feature configuration

Signing in does not enable inference. Platform-funded chat requires the explicit funding, budget and reviewed model settings in `.env.example`. BYOK requires encryption/resource secrets, a reviewed model allowlist, `BYOK_ENABLED=1`, and a user key saved in Account & settings. Disabled or incomplete configuration stays unavailable. Guest generation additionally requires Turnstile and a trusted hosted proxy; localhost does not satisfy that flow's production requirements.

The repository now includes explicit memory/projects, attachments, artifacts, charts/tables/images, tools, search, and MCP foundations. Availability depends on configuration and the live acceptance gates; see the operational guides in `docs/operations/`. Automatic memory collection and autonomous browser execution remain unavailable. The app no longer uses Clerk, MongoDB, Cloudinary or Mem0. See [beta operations](docs/operations/beta.md) for configuration boundaries, data controls, backup and recovery, and pending live acceptance.

## Checks and commands

- `bun run lint` — Biome checks.
- `bun run typecheck` — TypeScript checks.
- `bun test` — local unit and PostgreSQL integration tests using disposable PGlite databases and provider fixtures.
- `bun run build` — production Next.js build.
- `bun run start` — serve the production build.
- `bun run db:migrate` — apply pending PostgreSQL migrations.
- `bun run test:native-postgres` — run the real native concurrency case using installed PostgreSQL binaries; fails explicitly when unavailable.
- `bun run build:workers` — create an OpenNext Cloudflare bundle; does not deploy.

Run the full test suite and production build sequentially on this host. Tests use local provider fixtures and do not prove real GitHub login, paid inference or deployment.

## Current status

Current-phase local implementation and reviews are complete through PR #64. Live OAuth, Supabase, provider, deployment, budget and remaining device/accessibility acceptance are pending. Connector integrations and remaining remote/sandbox/browser execution are deferred to the next phase; their reviewed foundations remain default-off. Historical research and planning notes are retained as evidence, not instructions to activate these capabilities.
