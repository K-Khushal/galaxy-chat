# Galaxy Chat

A multi-model AI chat application, being rebuilt in milestones M0–M8 (see the `v1` roadmap issue). Sign in with GitHub, Google or an email code. Eligible new Users receive 10 one-time Credits. Chat comes back in later milestones.

Read [`GLOSSARY.md`](GLOSSARY.md) for the vocabulary, [`docs/adr/`](docs/adr/) for the decisions and [`docs/stack.md`](docs/stack.md) for the stack.

## Local setup

Requires Node.js 22+, Bun, PostgreSQL, GitHub and Google OAuth apps, Resend, a Redis server (for Upstash, its TCP `rediss://` URL) and Cloudflare Turnstile.

1. `bun install --frozen-lockfile`
2. Copy `.env.example` to `.env.local` and fill it in. `lib/env.ts` validates it and reports every missing value.
3. Set OAuth callback URLs to `<BETTER_AUTH_URL>/api/auth/callback/github` and `<BETTER_AUTH_URL>/api/auth/callback/google`. Verify your Resend sending domain and configure Turnstile for your hostname. Keep `CREDIT_IDENTITY_KEY` stable to preserve grant deduplication.
4. `bun run db:migrate` applies pending SQL files from `drizzle/` in one transaction.
5. `bun run dev`

## Attachments (R2)

Attachments (images, PDFs, text and code files) are stored in a private Cloudflare R2 bucket. The browser uploads straight to it with a presigned PUT; the app never proxies file bytes. Owner setup, once per environment:

1. **Bucket.** In the Cloudflare dashboard, R2 → Create bucket (any name, automatic location). Leave public access off: no `r2.dev` URL and no custom domain. Files are only ever read through short-lived presigned URLs.
2. **CORS.** Bucket → Settings → CORS policy → add:

   ```json
   [
     {
       "AllowedOrigins": ["https://<your app origin>", "http://localhost:3000"],
       "AllowedMethods": ["PUT"],
       "AllowedHeaders": ["content-type", "if-none-match"],
       "MaxAgeSeconds": 3600
     }
   ]
   ```

   List the exact origin(s) the app is served from (scheme and host, no trailing slash). Only PUT is needed: files are opened by navigation or `<img>`, which are not CORS requests.
3. **API token.** R2 → Manage R2 API tokens → Create API token, permission **Object Read & Write**, scoped to this bucket only. Copy the Access Key ID and Secret Access Key (shown once).
4. **Lifecycle rules.** No temporary prefix or lifecycle rule is required. Do not expire live objects under `u/`.
5. **Environment.** Set `R2_ACCOUNT_ID` (R2 overview page, or the account ID in the dashboard URL), `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` and `R2_BUCKET` in `.env.local` and on Vercel. They are read only when an Attachment is touched: a missing value fails that request with `server_misconfigured` and names the variable in the log.
6. **Migration.** `bun run db:migrate` applies `drizzle/0005_attachments.sql`.

**Lifecycle of a file.** A five-minute presigned PUT targets the final key `u/<userId>/<attachmentId>`, signing `If-None-Match: *`, content type and length. The browser sends the returned headers (including `If-None-Match`); CORS must allow that header on PUT. [R2 supports atomic conditional PutObject](https://developers.cloudflare.com/r2/api/s3/extensions/#conditional-operations-in-putobject): a replay against an existing object fails with 412. Confirm checks HEAD and magic bytes (an ETag-pinned ranged read), then conditionally changes `pending` to `ready`. Concurrent confirms return the same ready Attachment. There is no copy or promotion claim.

**Claiming and deleting.** A conditional update claims only ready files; an unsent-file delete atomically changes the status to `deleted` only when no Chat has claimed it. Deletion records a separate `attachment_tombstone` in the same transaction, with `purge_after = greatest(now(), presign_expires_at)`. Early object removal is best effort/retryable; removing the Attachment row never removes the tombstone. Chat deletion keeps the existing Chat row lock; account deletion locks the User and Chats and records tombstones before cascades. The tombstone table has no User or Chat foreign key, so it survives account deletion without retaining filename or content.

**Lazy purge and in-flight uploads.** Presign, confirm, Chat load and account deletion trigger a bounded global sweep, including deleted accounts. Once `purge_after` passes it removes the object and any failed-delete Attachment row. Minimal key tombstones remain and are swept again at most hourly per record (while the app is used), fairly ordered by next attempt. This intentionally adjusts the expiry-only proposal: [R2 documents that an unknown in-flight PUT can commit after a negative read](https://developers.cloudflare.com/r2/reference/consistency/#negative-reads-and-in-flight-writes); URL expiry does not establish that such writes finished. Dropping the last cleanup record after one DELETE would recreate the untracked-object gap. No cron is required, but without subsequent application use cleanup is delayed; storage failures retain records for retry.

Files that were uploaded but never sent in a Message are deleted the next time their owner uploads after 24 hours (no cron). Account deletion calls `deleteUserAttachments` (`lib/attachments/store.ts`).

## Checks

Run in this order before pushing: `bun run lint`, `bun run typecheck`, `bun test`, `bun run build`. Tests use PGlite and need no database.
