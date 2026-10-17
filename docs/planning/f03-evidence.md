# F03 evidence

Date: 2026-10-17. Branch: `codex/f03-auth-persistence`. No commit, push, pull request, deploy, or hosted Actions run.

## Local results

| Command | Result |
| --- | --- |
| `bun install --frozen-lockfile` | exit 0, lockfile already matched |
| `bun run lint` | exit 0 |
| `bun run typecheck` | exit 0 |
| `bun test` | exit 0, 19 tests |
| `bun run f01:integrity` | exit 0, vendor hashes unchanged |
| `bun run build` | exit 0, Next.js 16.4.2 |

`@electric-sql/pglite@0.5.10` and `@electric-sql/pglite-socket@0.2.13` are dev dependencies. The integration test starts that embedded Postgres on `127.0.0.1` with an ephemeral port, points `DATABASE_URL` at it, and applies `drizzle/0000_baseline.sql` and `drizzle/0001_ownership.sql` through `scripts/db-migrate.ts`. No Supabase host, GitHub token, or provider key is used.

A local `next start` with no `.env` returned `/sign-in` 200, including the sentence that the server will not create a session. `GET /api/history` and `POST /api/auth/sign-in/email` returned 503 `auth_unconfigured`. The process was stopped. The signed-in search, rename, and account dialogs were not opened in a browser.

## What the database tests exercised

Two invited users, one user outside `GITHUB_INVITE_LOGINS`, and a separate deleter/survivor pair used signed session cookies against the route handlers.

- Session creation for the non-invited user returns no row. A session inserted directly is revoked on the first history request (`invite_required`, 403) and the next request is `unauthenticated` (401). Email sign-in and sign-up return 403 and do not add a user. `GET /api/auth/get-session` without a cookie is null.
- An expired session and a session removed by `POST /api/auth/sign-out` cannot list history.
- History pages of conversations that share one `created_at` follow `(created_at, id)` order. `ending_before` returns the older page and `starting_after` returns the newer page, with no duplicate or skipped id. A title query does not return the other user's conversation. A query containing `%_` matches only a title that contains those characters.
- Message reads are chronological by `(created_at, id)`. `after` returns only the later tied message. The other user's chat id is 403 and the body does not include the message text. A batch that names both an owned and an unowned chat is 403 and writes neither row. Library output does not include the other user's file URL.
- Rename and delete of the other user's conversation are 403 and leave the row in place. The owner can rename and delete.
- `deleteChatMessages` derives the actor from the session. The other user gets `not_found` and no row changes. The owner deletes only messages after the selected timestamp and id.
- Export contains the caller's conversation and usage id. It does not contain the other user's title or an OAuth access token. Deleting the account removes that user only. The survivor's history still lists their conversation.
- An object key owned by someone else is 403. The caller's key, while storage is unconfigured, is 503 `storage_unconfigured`. A missing key is 400. No object bytes are stored.

`drizzle/0001_ownership.sql` adds owner timeline indexes, a partial unique index on GitHub login, visibility and message-role checks, and an ownership-only `usage_record` table with row level security and the same anon/authenticated revoke. It does not store credit amounts or attachment objects.

## Residual limitations

Live GitHub OAuth has not been exercised, and the SQL has not been applied to Supabase. PGlite speaks Postgres on a local socket; it is not the Supabase transaction pooler. The migrate command still takes `pg_advisory_xact_lock` inside one `sql.begin` transaction. Funded inference stays off. Attachments and the credit ledger are not implemented. Keyboard, focus, contrast, and mobile behavior of the new account controls were not measured.
