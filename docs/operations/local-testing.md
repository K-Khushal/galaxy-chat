# Local testing

Use a separate development database. This guide performs no provisioning, purchases or deployment. Start with auth/data testing; adding provider credentials is a separate, potentially billable step.

## 1. Install and configure

Requires Node.js 22+ and Bun (CI uses 1.4.3). From the repository root:

```sh
bun install --frozen-lockfile
cp .env.example .env.local
```

If `.env.local` already exists, edit it instead of copying over it. Do not commit it. Next.js reads `.env.local`; exported shell variables take precedence. The migration command uses `@next/env` with development precedence by default. Restart the dev server after changing values. A literal `$` in a dotenv value must be escaped as `\$`; URL-encode special characters in database credentials.

Fill these settings in section 1:

| Variable | Value |
| --- | --- |
| `DATABASE_URL` | Your development PostgreSQL URI, with the database provider's TLS settings. Direct/session or supported pooler connection; not a Supabase API key. |
| `BETTER_AUTH_URL` | `http://127.0.0.1:3000` for the commands below |
| `BETTER_AUTH_SECRET` | A fresh random secret of at least 32 characters |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | Credentials for your development GitHub OAuth app |
| `GITHUB_INVITE_LOGINS` | Your GitHub username; comma-separated for additional invited testers |

Generate an auth secret locally with `openssl rand -hex 32` and paste it into `.env.local`. Keep generated values private. Configure the OAuth app's homepage as `http://127.0.0.1:3000` and callback as `http://127.0.0.1:3000/api/auth/callback/github`. Use that same hostname/port in the browser; `localhost` and `127.0.0.1` are different origins.

## 2. Apply migrations and start

```sh
bun run db:migrate
bun run dev --hostname 127.0.0.1 --port 3000
```

Open `http://127.0.0.1:3000`. Migrations create all pending tables and record applied versions; repeat runs skip recorded versions. Never manually delete migration history or existing financial records. Missing `verification` or other relations mean migrations have not been applied to the database the app uses. Stop and fix migration errors before signing in.

Check the landing/help/privacy pages, GitHub sign-in, sign-out, light/dark layout, account settings, and memory/project controls. Signing in alone does not enable generation. Streaming, saved generated conversations and branches need a configured model. A second separately invited account can check ownership isolation. No email/password registration is available.

## 3. Optional: test BYOK chat

Keep `FUNDED_INFERENCE=0` and `FUNDED_KILL_SWITCH=1` while testing user-funded chat. BYOK requires:

- `BYOK_ENABLED=1`.
- `BYOK_ENCRYPTION_KEYS_JSON='{"v1":"<canonical base64 encoding of 32 random bytes>"}'` and `BYOK_ACTIVE_KEY_VERSION=v1`. Generate the key with `openssl rand -base64 32`; replace the placeholder, retaining the single quotes around JSON in the env file.
- An independent `BYOK_RESOURCE_SECRET` of at least 32 characters, generated separately with `openssl rand -hex 32`.
- `BYOK_MODELS_JSON` containing an operator-reviewed, unexpired text route in the shape documented in `.env.example`. Use the actual endpoint model/provider and verified capabilities; the example names are intentionally nonfunctional. Do not set `verified=true` merely to bypass the review.
- Save your provider key through Account & settings after signing in. `OPENROUTER_API_KEY` and `AI_GATEWAY_API_KEY` are platform funding credentials, not the per-user BYOK configuration.

Back up encryption keys securely; losing them makes stored keys unreadable. Keep the resource secret stable while leases are unresolved. Provider requests can incur charges on your account. No real inference request is made by setup or the fixture tests.

## 4. Optional: private attachments

Populate `SUPABASE_URL`, the **server-only** `SUPABASE_SECRET_KEY` and a private `SUPABASE_STORAGE_BUCKET`. Review storage permissions and the total infrastructure budget, configure positive `ATTACHMENT_PLATFORM_BYTES`, `ATTACHMENT_USER_BYTES` and `ATTACHMENT_DAILY_TRANSFER_BYTES` within the bounds in `.env.example`, and arrange the documented cleanup/reconciliation before enabling `ATTACHMENTS_ENABLED=1`. See [beta operations](beta.md). Do not turn the bucket public or expose its secret with `NEXT_PUBLIC_*`.

Guest generation requires Turnstile and a trusted hosted proxy; the localhost setup does not prove it. Leave images, search, tools, MCP and sandbox settings disabled/blank initially. Remaining connectors and advanced execution are deferred, and test traces/flags cannot establish production authority.

## 5. Verify changes

```sh
bun run lint
bun run typecheck
bun test
bun run build
```

Run heavy checks sequentially on this host. Tests use disposable databases/provider fixtures; they do not certify live services. `bun run test:native-postgres` additionally needs installed native PostgreSQL server binaries and intentionally fails if absent. CI runs the real case separately; see [native PostgreSQL verification](native-postgres.md). `bun run build:workers` builds the hosting adapter without deploying.

Local testing is the next acceptance step, not evidence that deployment, live provider behavior or the complete $10 monthly operating budget has already passed.
