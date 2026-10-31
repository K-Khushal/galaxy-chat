# M8 E2E verification

Local run, 2026-10-31, Bun 1.4.3, Node 26.13.0, Linux, Chromium headless.
CI uses Node 22 and Bun 1.4.3.

Required checks ran in order on m8/e2e:

| Command | Result |
| --- | --- |
| bun run lint | PASS |
| bun run typecheck | PASS |
| bun test | PASS: 111 tests, 678 assertions, 21 files (91.46s) |
| bun run build | PASS |
| bun run test:e2e | PASS: 9 passed, 1 attachment placeholder skipped (1.1m including build) |

The E2E command builds production assets, starts next start, and owns local
PostgreSQL and Redis processes. Every browser test signs in as a new User.
The suite covers all nine requested flows, including real Credit exhaustion,
mocked BYOK validation with real encryption, partial Stopped Replies, and
refresh-resume without changing the Reply ID.

Manual guard verification: starting Next with NODE_ENV=production and
GALAXY_TEST_E2E=1 rejects next.config.ts with:
“GALAXY_TEST_E2E requires NODE_ENV=test and cannot run on Vercel”.
Unit coverage checks missing/invalid flags, non-test runtimes, and Vercel
preview/production configurations. Test runtime external fetches and external
browser requests are rejected; no real provider credentials are used.

See tests/e2e/README.md for setup, the deliberate NODE_ENV=test runtime with
production assets, and failure trace instructions. CI evidence is linked in
the PR body so it can refer to the exact head being reviewed.
