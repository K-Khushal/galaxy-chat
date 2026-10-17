# Foundation evidence

Date: 2026-10-17. Branch: `codex/f01-feasibility`. Commit `378ea0a` plus these uncommitted review fixes. No new commit, push, deploy, or hosted Actions run.

## Local results

| Command | Result |
| --- | --- |
| `bun run lint` | exit 0, 148 files |
| `bun run typecheck` | exit 0 |
| `bun test` | exit 0, 10 tests |
| `bun run f01:integrity` | exit 0, vendor hashes unchanged |
| `bun run build` | exit 0, Next.js 16.4.2 |
| `bun run db:migrate` with no `DATABASE_URL` | exit 1, error id `persistence_unconfigured` only |

CI (`.github/workflows/ci.yml`) provisions Node 22 and Bun 1.4.3 before those checks. It has not run on a hosted runner.

## What this slice enforces

- Message batches validate every distinct chat id for the current owner inside a database transaction. A mixed owned and unowned batch throws `forbidden` before `insert`. `deleteChat` deletes the owner's messages and chat in one transaction. `chat_message.chat_id` also cascades on chat delete. Unscoped `getChat(id)` is removed.
- `FUNDED_INFERENCE` defaults off. `runFundedModelCall` returns `funded_inference_disabled` before the supplied function runs, including when `OPENROUTER_API_KEY` is set. Chat streaming, including search, goes through that guard. `.env.example` documents it.
- Title generation is a server-only helper, not a server action. It calls `requireChatAccess` before the funded guard and the provider. A rejecting auth check does not run the provider function. `app/(chat)/action.ts` no longer exports it.
- `drizzle/0000_baseline.sql` creates Better Auth and chat tables, enables row level security, and revokes `PUBLIC`, `anon`, and `authenticated`. It does not call `auth.uid()`. `DATABASE_URL` in `.env.example` is the Supabase transaction pooler (port 6543). `bun run db:migrate` opens one `sql.begin` transaction and takes `pg_advisory_xact_lock` before creating or reading `schema_migrations` and before applying pending files. Commit or rollback releases that lock. There is no `pg_advisory_lock` or `pg_advisory_unlock`. A fake of that transaction showed a failed file rolls back every pending version from the attempt, a retry commits them, and a second runner acquires the lock only after the first commit and does not reapply. No cloud migration ran. Applying the SQL to Supabase is still pending.
- Provider and chat error paths log `{ level, id }` or render an error id. They do not print the caught provider, database, or request object.

## Browser check

Codex checked the loopback prototype. Named Theme controls, dark styling, sending a local reply, and the dialog all behaved: the dialog opened with Cancel focused, and Escape closed it and restored focus to Spike notes. Screenshot: `/private/tmp/galaxy-f01-dark.png`. Full contrast, mobile and real-device layout, reduced-motion runtime, and Next.js hydration were not measured.

## Still pending

Live GitHub OAuth, a real provider stream, Cloudflare deploy, Worker CPU and upload size, billing, and the $10/month decision remain pending. They do not block the next local ticket.
