# Foundation evidence

Date: 2026-10-17. Branch: `codex/f01-feasibility`. Local review fixes only. No commit, push, deploy, or hosted Actions run.

## Local results

| Command | Result |
| --- | --- |
| `bun install --frozen-lockfile` | exit 0 |
| `bun run f01:integrity` | exit 0, vendor hashes unchanged |
| `bun run lint` | exit 0, 144 files |
| `bun run typecheck` | exit 0 |
| `bun test` | exit 0, 7 tests |
| `bun run build` | exit 0, Next.js 16.4.2 |
| `bun run db:migrate` with no `DATABASE_URL` | exit 1, error id `persistence_unconfigured` only |

CI (`.github/workflows/ci.yml`) provisions Node 22 and Bun 1.4.3 before those checks. It has not run on a hosted runner.

## What this slice enforces

- Message batches validate every distinct chat id for the current owner inside a database transaction. A mixed owned and unowned batch throws `forbidden` before `insert`. `deleteChat` deletes the owner's messages and chat in one transaction. `chat_message.chat_id` also cascades on chat delete. Unscoped `getChat(id)` is removed.
- `FUNDED_INFERENCE` defaults off. `runFundedModelCall` returns `funded_inference_disabled` before the supplied function runs, including when `OPENROUTER_API_KEY` is set. Title generation and chat streaming, including search, go through that guard. `.env.example` documents it.
- `drizzle/0000_baseline.sql` creates Better Auth and chat tables, enables row level security, and revokes `PUBLIC`, `anon`, and `authenticated`. It does not call `auth.uid()`. `bun run db:migrate` applies versioned files only when `DATABASE_URL` is set. No cloud migration ran. The SQL text is checked locally; applying it to Supabase is still pending.
- Provider and chat error paths log `{ level, id }` or render an error id. They do not print the caught provider, database, or request object.

## Still pending

Live GitHub OAuth, a real provider stream, Cloudflare deploy, Worker CPU and upload size, billing, and the $10/month decision remain pending. They do not block the next local ticket.
