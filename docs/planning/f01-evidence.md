# F01 evidence

Date: 2026-10-17. Branch: `codex/f01-feasibility`. Scope: local Halaska prototype plus the Next 16 / Bun / AI SDK 7 / Better Auth foundation. This file records commands that ran in this worktree. It does not accept a deploy, a live OAuth login, a provider stream, Worker CPU, or the $10/month budget.

## Gate split

Local checks below can be reviewed and can unlock the next code ticket. These live checks stay pending and do not block that review:

- GitHub OAuth against a real OAuth app
- Provider server-sent events, cancellation, and secret handling on a host
- Cloudflare deploy, Worker CPU, and upload-size acceptance
- Billing and a current-price budget go/no-go

Do not treat this document as permission to close GitHub issue #5 or #6. Each still has a required live check.

## Vendoring

The official Halaska kit is vendored unmodified.

| File | Source | Bytes | SHA-256 |
| --- | --- | --- | --- |
| `vendor/halaska/halaska-kit.jsx` | https://ui.halaska.com/halaska-kit.jsx | 739157 | `54e24582de20e96c3228e2abc5eba225219183c03b82eeefc2bad0a57ef5c24a` |
| `vendor/halaska/halaska-kit.d.ts` | https://ui.halaska.com/halaska-kit.d.ts | 9403 | `fc8760c4c3ada52d642f76b2da5c346afd853a7c47f28047762d5dcde01ab27b` |
| `vendor/halaska/LICENSE` | https://raw.githubusercontent.com/Halaska-Studio/ui/main/LICENSE | 1071 | `3e8303becd6efb3a15b58158af96a35da65234196df1733ae1b792a9166b404a` |

Kit response recorded earlier: HTTP 200, `etag: "46e78c0d7a342cae4522ea8d97071632"`, `last-modified: Sat, 17 Oct 2026 09:02:15 GMT`, `content-type: text/jsx`. Shim: `etag: "e8b4c1489c8d0f6bcaeb8bd1338d99ec"`, `content-type: video/mp2t`. Git blob `a7e55b0c39ab7b290e9c851bed81fc73038dd225`. Last kit commit `260b4981306ac5506c86b6b1823e4ae8df2c8f7c` (2026-10-01). License: MIT, Copyright (c) 2026 Halaska Studio. `biome.json` ignores `vendor/`.

`node scripts/f01-vendor-integrity.mjs` checks those three SHA-256 lines only. Exit 0. Printed `f01 vendor integrity passed`.

## Prototype

`/spike/f01` renders only when `F01_PROTOTYPE=1`. Otherwise the page calls `notFound()`. The route is dynamic. The production build without that variable lists it as a dynamic route and does not prerender the prototype.

Halaska pieces: `ThemeProvider`, `usePal`, `tokens`, `Stack`, `Card`, `CardHeader`, `EmptyState`, `TextArea`, `Button`, `Dialog`. Theme is a native named radio group (`fieldset` / `legend` / `input type="radio"`). Message bubbles receive Halaska palette values through CSS variables on the transcript subtree. Reduced motion sets the kit duration variables on that subtree, passes `initial` and `resize` `"instant"` to `use-stick-to-bottom`, reveals the canned reply in one update, and scrolls with `animation: "instant"`. `setKitMotion` is not called.

The reply text is constant. The prototype does not call a model.

`bun run f01:preview` compiles the prototype with Tailwind and serves it on `127.0.0.1:4317` only. Generated files stay in `.f01-preview/`, which is gitignored. This session got HTTP 200 and an HTML shell whose script bundle contains the prototype title, `f01-theme`, and `prefers-reduced-motion`. No browser keyboard, contrast, hydration, or focus pass was done.

First-load client chunks for `/spike/f01` from `.next/diagnostics/route-bundle-stats.json` after the Next 16.4.2 build: 1,263,012 raw bytes, 379,540 gzip bytes across 15 chunks (`gzip.compress`, `mtime=0`). The chunk containing the `halaska` marker is `static/chunks/2ootc1d-brg16.js`: 32,715 raw, 10,934 gzip. These are client chunks, not a Worker upload size.

## Foundation pins

Installed with Bun 1.4.2. `package-lock.json` is removed. `bun.lock` is the lockfile. Local Bun was not upgraded. GitHub's latest stable release seen earlier is 1.4.3.

| Package | Pinned |
| --- | --- |
| `next` | 16.4.2 |
| `react` / `react-dom` | 19.3.1 |
| `ai` | 7.0.143 |
| `@ai-sdk/react` | 4.0.147 |
| `@ai-sdk/openai` | 4.0.96 |
| `@openrouter/ai-sdk-provider` | 3.1.0 |
| `better-auth` / `@better-auth/drizzle-adapter` | 1.7.10 |
| `drizzle-orm` | 0.45.4 |
| `postgres` | 3.4.9 |
| `@opennextjs/cloudflare` | 1.20.12 |
| `wrangler` | 4.151.1 |

Auth is Better Auth with GitHub only, Drizzle, and postgres.js (`prepare: false`). Supabase is the intended Postgres and private storage host. Supabase Auth is not used. `resolveAuthConfig` returns null unless `BETTER_AUTH_SECRET` (at least 32 characters), `BETTER_AUTH_URL`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, and `DATABASE_URL` are all non-empty. There is no default secret. An empty `GITHUB_INVITE_LOGINS` invites nobody. Chat layout and API routes call `requireChatAccess`. Storage reads `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, and `SUPABASE_STORAGE_BUCKET` on the server. Uploads return `storage_unconfigured` or `storage_unavailable`. Platform-funded model calls also require `FUNDED_INFERENCE=1`; a provider key alone returns `funded_inference_disabled`. `.env.example` lists these names with nonfunctional placeholders. `.gitignore` ignores `.env*` and keeps `.env.example`. `drizzle/0000_baseline.sql` is the versioned schema and is applied only by `bun run db:migrate` when `DATABASE_URL` is set.

A Node `proxy.ts` was tried. OpenNext then failed while bundling Node middleware: esbuild could not resolve `@opentelemetry/api` from its copied Next tracer. The file was removed. `/chat` is gated in the chat layout, and the chat APIs gate themselves. That is not a substitute for a deployed session test.

## Checks that ran

Machine: Node `v25.8.2`, npm `11.17.0`, Bun `1.4.2`. No real `.env` file was read. Commands:

```text
bun install
bun run f01:integrity
bun test
bun run typecheck
bun run build
bun run build:workers
```

Outcomes:

- `bun install` exit 0. Lockfile saved.
- Integrity exit 0.
- `bun test` exit 0. Ten tests, including a rejected auth check that does not reach the title provider, and migration rollback plus serialized concurrent apply.
- `bun run typecheck` (`tsc --noEmit --pretty false --incremental false`) exit 0.
- `bun run build` (Next.js 16.4.2) exit 0. Static pages generated. `/`, `/forgot-password`, and `/sign-up` are static. Chat, auth API, and `/spike/f01` are dynamic. No Clerk key is required.
- `bun run build:workers` exit 0 after the proxy file was removed. OpenNext printed `Worker saved in .open-next/worker.js` and `OpenNext build complete.` It warned that `compatibility_date` `2024-12-30` is old, and esbuild warned about a duplicate `database` key inside bundled Better Auth message strings. `.open-next/worker.js` is 2,278 bytes raw and 735 gzip. The server function `handler.mjs` is 23,449,308 bytes raw and 5,267,704 gzip. No Wrangler upload ran, so the deployed script size is unknown. This does not show that the Free tier accepts the bundle.

`bunx biome check` exit 0. Checked 144 files. The previous 17 errors and 5 warnings are fixed in the first-party UI. No rules were disabled.

`bun install --frozen-lockfile` exit 0. `bun run f01:integrity` exit 0. `bun test` exit 0, 7 tests. `bun run typecheck` exit 0. `bun run build` exit 0 on Next.js 16.4.2. `bun run db:migrate` without `DATABASE_URL` exit 1 and printed only `{"level":"error","id":"persistence_unconfigured"}`. No database was contacted.

CI in `.github/workflows/ci.yml` installs Node 22 and Bun 1.4.3, then runs frozen install, integrity, lint, typecheck, tests, and build. That workflow has not been executed on a hosted runner.

## Checks that did not run

- No browser session for keyboard, dialog focus, contrast, hydration, or reduced motion.
- No GitHub OAuth login and no Supabase project.
- No provider request. `OPENROUTER_API_KEY` was not present.
- No `wrangler deploy`, preview publish, or other cloud write.
- No fresh fetch of Supabase or Gateway prices in this slice. Workers Free is 100,000 requests/day and 10ms CPU. Workers Paid is a $5/month minimum, not a hard cap. The limits page updated Oct 12, 2026 lists 64 MiB uncompressed and says there is no compressed size limit. OpenNext's docs still say 3 MiB gzip on Free and 10 MiB on Paid. Those statements still conflict, and this slice did not upload a Worker. Vercel Hobby remains non-commercial personal use. The $10/month cap is not accepted and is not rejected.

## Still pending

1. Browser-check the preview at `http://127.0.0.1:4317` (`bun run f01:preview`) and `/spike/f01` with `F01_PROTOTYPE=1`.
2. Populate `.env.example` values locally, then exercise GitHub sign-in, the invite allowlist, and a real provider stream.
3. Decide Worker tier from an actual upload size and a streaming CPU trace. Do not deploy until that measurement exists.
4. Run the GitHub Actions workflow on a hosted runner. The local equivalents already passed.
