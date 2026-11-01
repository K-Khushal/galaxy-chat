# Full browser verification

Run date: 2026-11-01. Bun 1.4.4, Next.js 16.4.2, Playwright 1.64.1.

The isolated production-build suite uses Chromium, Firefox and WebKit at
1280×800 and 390×844 (touch), with fresh identities for every test, mock
models, local PostgreSQL and Redis, and in-memory object storage. Ports are
34871/34872/34873 to avoid another active worktree's original harness.
CI installs all three engines and allows 15 minutes for the expanded matrix.

## Production (read-only, unauthenticated)

All three engines were exercised at both viewports. No forms were submitted.
The root and sign-in pages return 200; an unknown path returns 404; /chat
lands at /sign-in. HTTPS www redirects to the apex with 308; HTTP redirects
to HTTPS with 308.

The sign-in responses include a nonce in script-src, no unsafe-eval,
frame-ancestors 'none', HSTS (63072000; includeSubDomains), nosniff,
strict-origin-when-cross-origin and a Permissions-Policy disabling camera,
microphone and geolocation. Cloudflare is allowed in script-src, connect-src
and frame-src.

Turnstile's script and challenge frame load, but a successful ready widget
could not be established in this environment: Cloudflare's brunhild challenge
host fails DNS / reports a bad URI. Cloudflare frame diagnostics also report
blocked data:, connections under its own CSP (the policy names hagen and
brunhild, unlike Galaxy's policy). These are observed external/environment
failures, not established Galaxy CSP bugs. Navigation also aborts some RSC
prefetches; the deliberate 404 produces an expected console resource error.
Consequently “no console errors / no failed requests” does not pass.

## Coverage limits

The guarded test sign-in page also renders the real SignInPanel. The browser
replaces Turnstile with a visible placeholder, mocks the email-code endpoints,
and creates an opaque database session through the existing seam on code
verification. Account-menu sign-out mocks removal of that seam cookie.
These verify UI state and redirects, not real OAuth, email delivery, Turnstile
verification or Better Auth session invalidation. Production inspection stays
read-only. Account deletion and signed-out redirects use the real app paths.

## App bugs

- **P2 — math loses KaTeX markup.** Send a Reply containing `$$E=mc^2$$`.
  Expected: one typeset equation with KaTeX rendering markup. Actual: nested
  spans without KaTeX classes or MathML and duplicated equation text.
  Suspect `components/elements/response.tsx:10` (Streamdown's default math /
  sanitization pipeline). A dedicated executable regression is marked fixme.
- **P2 — Firefox logs blocked JavaScript evaluation for Replies.** Sign in,
  send any Message, and inspect the console; refreshing repeats it.
  Expected: no CSP violations. Actual: Firefox reports a blocked eval in a
  bundled chunk under script-src without unsafe-eval. Suspect the dependency
  tree mounted by `components/elements/response.tsx:10`; the exact dependency
  is not established. The Firefox CSP regression is marked fixme; functional
  Firefox tests still run. No CSP policy was relaxed.

## Final validation

| Command (in order) | Result |
| --- | --- |
| bun run lint | PASS |
| bun run typecheck | PASS |
| bun test | PASS: 178 passed, 1 existing skip, 1041 assertions (84.31s) |
| bun run test:ui | PASS: 37 passed, 105 assertions |
| bun run build | PASS |
| bun run test:e2e | PASS: 142 passed, 8 fixme skips, 0 failures (4.9m) |

The eight fixme cases are math in all six projects and the CSP regression in
both Firefox projects. All other journeys run in every project.
