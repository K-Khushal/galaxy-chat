# Galaxy Chat

[Galaxy Chat](https://galaxychat.tech) is a multi-model AI chat app. Sign in with GitHub, Google or an email code. Eligible new Users receive 10 one-time Credits; an OpenRouter BYOK key unlocks the full model catalog. v1 includes saved and Temporary chats, resumable Replies, Message editing and Versions, Attachments, Chat search and groups, and account settings.

Built with Next.js App Router, React, TypeScript, Bun, Biome, Tailwind CSS, shadcn/ui on Base UI, Drizzle and Postgres. Better Auth handles sign-in, OpenRouter and the AI SDK serve Replies, Redis coordinates Generations, R2 stores private Attachments, and Sentry provides observability.

See [GLOSSARY.md](GLOSSARY.md) for terminology and [docs/adr/](docs/adr/) for binding decisions.

## Local setup

Requires Node.js 22+, Bun, Postgres, Redis (TCP/TLS), OAuth apps for GitHub and Google, Resend, Cloudflare Turnstile and a private R2 bucket.

1. Run `bun install --frozen-lockfile`.
2. Copy `.env.example` to `.env.local` and supply the values. `lib/env.ts` validates configuration as each concern is used. Keep `CREDIT_IDENTITY_KEY` stable to preserve Credit grant deduplication.
3. Set OAuth callbacks to `<BETTER_AUTH_URL>/api/auth/callback/github` and `/google`. Verify the Resend sending domain and configure Turnstile for your hostname.
4. Configure R2 CORS with your exact app origins (including `http://localhost:3000` locally), method `PUT`, and allowed headers `content-type` and `if-none-match`. Keep public access disabled, scope the R2 token to Object Read & Write on the bucket, and do not expire live objects under `u/`.
5. Run `bun run db:migrate`, then `bun run dev`.

## Checks

Before pushing, run in order:

```sh
bun run lint
bun run typecheck
bun test
bun run test:ui
bun run build
```

Tests use PGlite and mock models. Run `bun run test:e2e` for Playwright browser coverage; see [tests/e2e/README.md](tests/e2e/README.md) for prerequisites.

## Deployment

Production runs on Vercel (ADR 0002) at <https://galaxychat.tech>. Set every variable from `.env.example` in the Vercel project; `lib/env.ts` fails loudly when a route needs one that is missing. Never commit values.

**Migrations.** `vercel.json` sets the build command to `bun run db:migrate` followed by `bun run build`, with the migration step only when `VERCEL_ENV=production`. Vercel uses `buildCommand` from `vercel.json` ahead of the framework's `build` script. Preview builds do not receive production secrets, so they skip the migration and just build. If a migration fails, `db:migrate` exits non-zero and the deployment fails before `next build` runs; the previous deployment keeps serving. Locally, run `bun run db:migrate` yourself.

### Production services

| Service | Configuration |
| --- | --- |
| Neon (Postgres) | `DATABASE_URL`: the pooled connection string, with the password URL-encoded. |
| Upstash Redis | `REDIS_URL`: the TCP/TLS URL (`rediss://…`), not the REST URL or token. |
| Cloudflare R2 | A private bucket (no public access) with `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` and `R2_BUCKET`; the token is limited to Object Read & Write on that bucket. CORS: allow `PUT`, `GET` and `HEAD` from the exact app origins (for example `https://galaxychat.tech`, plus `https://www.galaxychat.tech` if used), allow headers `content-type` and `if-none-match`, and expose `ETag`. Do not expire live objects under `u/`. |
| Resend | A verified sending domain, with `RESEND_API_KEY` and `AUTH_EMAIL_FROM` on that domain. |
| GitHub and Google OAuth | `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`. Callback URLs: `https://galaxychat.tech/api/auth/callback/github` and `https://galaxychat.tech/api/auth/callback/google`. Set `BETTER_AUTH_URL` to the site origin and list other origins in `APP_ORIGINS`. |
| Cloudflare Turnstile | `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY`, for the production hostname. |
| Sentry | `SENTRY_DSN` and `SENTRY_ENVIRONMENT` enable error reporting; `SENTRY_AUTH_TOKEN` is build-only, for source maps. Leave `SENTRY_DSN` unset to disable Sentry. |
| OpenRouter | `OPENROUTER_API_KEY` is the Platform key that pays for Credit Replies. Users' BYOK keys are encrypted with `BYOK_ENCRYPTION_KEYS_JSON` and `BYOK_ACTIVE_KEY_VERSION`. |

Also set `BETTER_AUTH_SECRET` and `CREDIT_IDENTITY_KEY` (keep the latter stable).
