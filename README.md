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

Deploy on Vercel with managed Postgres and Redis, and configure the variables documented in `.env.example`. Apply pending SQL migrations with `bun run db:migrate` before serving the updated app. Attachments use a private R2 bucket; hosting uses Vercel (ADR 0002).
