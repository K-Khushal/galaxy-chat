# Production-build E2E

Install dependencies with Bun, install local PostgreSQL (pg_config, initdb, pg_ctl) and redis-server, then run:

```sh
bunx playwright install --with-deps chromium
bun run test:e2e
```

Playwright builds normal production assets with `next build`, starts a fresh
migrated local PostgreSQL database on TCP :5544 and a disposable Redis on :6399, then runs
`next start` on :3008. It owns and stops these processes. No external services
or credentials are needed. Each test signs up a fresh identity with 10 Credits;
there is no ordering dependency or shared browser state.

The server runtime uses `NODE_ENV=test GALAXY_TEST_E2E=1`. This deliberately
separates optimized production assets from a production deployment: Next emits
a nonstandard NODE_ENV warning. The centralized zod guard rejects the flag
unless NODE_ENV is test, and rejects every Vercel environment. next.config.ts
checks on both build and start; every seam checks again at runtime. Never set
the flag in deployment configuration. Direct NODE_ENV references are inlined by
Next, so the guard reads the runtime environment object instead.

The test-only sign-in form and POST endpoint create an opaque, HttpOnly cookie
and a real database session. Real account deletion invalidates it by cascade.
OAuth, OTP, Resend and Turnstile are bypassed. Generation uses the M4 AI SDK
mock stream; only Messages containing [slow] get a 5-second Reply. BYOK
validation accepts only the dummy key in the spec; encryption and persistence
use the normal app path. Real Redis handles locks, Stop and resume coordination.
Server fetch and browser routing reject external HTTP, including provider calls.
Attachments remain explicitly skipped pending PR #85.

CI runs this as a separate informational job (branch protection is unchanged),
caches Chromium, and retains traces, screenshots and the HTML report on failure.
Open a failure trace with `bunx playwright show-trace <trace.zip>`.
Specs use .e2e.ts so Bun's unit-test discovery does not run Playwright tests.
