# F01 evidence

Date: 2026-10-17. Branch: `codex/f01-feasibility`. Scope: local Halaska vendoring and an AI Elements compatibility prototype. This slice does not pin packages, deploy, or call a model.

## Result

The official Halaska kit is vendored unmodified, with MIT license, provenance, and checksums. `/spike/f01` renders the existing AI Elements conversation, message, and response components inside a Halaska shell and streams a canned local reply. No application dependency version changed.

These F01 acceptance items are not complete: package pinning, a deployed streaming request, cancellation against a provider, secret handling on a host, worker runtime and quota behavior, browser keyboard/hydration checks, and a budget go/no-go. Details are below. Do not treat the compile step as a passing production build.

## What changed

- `vendor/halaska/halaska-kit.jsx`, `halaska-kit.d.ts`, and `LICENSE` are the downloaded bytes.
- `vendor/halaska/PROVENANCE.md` and `SHA256SUMS` record source, headers, and hashes.
- `components/spike/halaska-elements-prototype.tsx` and `app/spike/f01/page.tsx` are the prototype.
- `scripts/f01-vendor-smoke.mjs` and `package.json` script `f01:smoke` recheck the checksums and the prototype boundaries.
- `biome.json` ignores `vendor/` so formatting cannot rewrite the kit.

Existing routes, middleware, chat API, and dependency ranges were left as they were. The new route is public in `middleware.ts` because only `/chat` redirects anonymous users. The root layout still wraps every page in `ClerkProvider`, so this route inherits that requirement.

## Vendoring

Downloaded earlier in this session and copied without modification.

| File | Source | Bytes | SHA-256 |
| --- | --- | --- | --- |
| `vendor/halaska/halaska-kit.jsx` | https://ui.halaska.com/halaska-kit.jsx | 739157 | `54e24582de20e96c3228e2abc5eba225219183c03b82eeefc2bad0a57ef5c24a` |
| `vendor/halaska/halaska-kit.d.ts` | https://ui.halaska.com/halaska-kit.d.ts | 9403 | `fc8760c4c3ada52d642f76b2da5c346afd853a7c47f28047762d5dcde01ab27b` |
| `vendor/halaska/LICENSE` | https://raw.githubusercontent.com/Halaska-Studio/ui/main/LICENSE | 1071 | `3e8303becd6efb3a15b58158af96a35da65234196df1733ae1b792a9166b404a` |

Kit response: HTTP 200, `etag: "46e78c0d7a342cae4522ea8d97071632"` (MD5 of the file), `last-modified: Sat, 17 Oct 2026 09:02:15 GMT`, `content-type: text/jsx`. Shim response: `etag: "e8b4c1489c8d0f6bcaeb8bd1338d99ec"`, `content-type: video/mp2t` (the body is the `.d.ts` shim).

GitHub [Halaska-Studio/ui](https://github.com/Halaska-Studio/ui) file `halaska-kit/halaska-kit-v1.0.jsx` has git blob `a7e55b0c39ab7b290e9c851bed81fc73038dd225`, which matches these bytes. Last commit that touched that path: `260b4981306ac5506c86b6b1823e4ae8df2c8f7c` (2026-10-01T07:49:08Z). The site `last-modified` is newer than that commit; the hash still matches the blob.

License: MIT, Copyright (c) 2026 Halaska Studio. Header in the kit: `Halaska UI v1.0`, MIT. Install docs: https://ui.halaska.com/docs/install and https://ui.halaska.com/install.md. The vendor install adds no npm dependency. Stated runtime dependencies are `react` and `react-dom`. The file starts with `"use client"`.

One NUL byte is present at offset 368483 inside a template literal. It is part of the checksum. Webpack compiled that file; see the build section.

## Prototype

Route: `/spike/f01`.

Halaska pieces used: `ThemeProvider`, `usePal`, `tokens`, `Stack`, `Card`, `CardHeader`, `EmptyState`, `SegmentedControl`, `TextArea`, `Button`, `Dialog`, `setKitMotion`.

Existing AI Elements pieces used: `Conversation`, `ConversationContent`, `ConversationScrollButton`, `Message`, `MessageContent`, `Response`.

Adaptations, from the kit source rather than a browser pass:

- `PromptInputPattern`, `AgentChatPattern`, and `MessageThreadPattern` keep their own demo state and do not take the transcript as props. The prototype does not use them.
- `TextArea` accepts `value` and `onChange` (string) and sets `aria-label` from `label`. It does not forward `onKeyDown`, and its `Label` is not tied to the textarea with `htmlFor`. Enter therefore inserts a newline. Send is a `type="submit"` button.
- `Button` only forwards `type`, `aria-label`, `aria-expanded`, `aria-haspopup`, and `aria-describedby`. The prototype sets `type` on every kit button it creates.
- `SegmentedControl` is a `radiogroup` with arrow-key handling and `aria-checked`. It has no prop for an accessible name. The visible word "Theme" next to it is not programmatically associated.
- `Dialog` implements focus move, Tab wrap, Escape, `role="dialog"`, and `aria-modal` in `useModalFocus`. Its backdrop is a clickable `div`. Both of its buttons call `onClose`. This was read from source, not exercised in a browser.
- Kit `prefers-reduced-motion` CSS only stops `[data-halaska-orb]` and `[data-halaska-calm]`. The prototype calls `setKitMotion("instant")` when that media query matches, and it inserts the canned reply in one update instead of the 32ms interval. Other kit animations are not fully disabled.
- The reply text is constant. There is no `fetch`, provider SDK call, or `streamText` use. Stop clears the local interval and leaves the partial text.

## Checks that ran

Machine: Node `v25.8.2`, npm `11.17.0`. `node_modules` was absent, so dependencies were installed from the existing lockfile. No `.env*` files were present. Secret values were not read.

```text
npm ci
```

Outcome: exit 0. `added 607 packages`. `package-lock.json` was not modified.

```text
node scripts/f01-vendor-smoke.mjs
```

Outcome: exit 0. Printed `f01 vendor smoke passed`.

```text
npx biome check app/spike/f01/page.tsx components/spike/halaska-elements-prototype.tsx scripts/f01-vendor-smoke.mjs
```

Outcome: exit 0 after Biome formatted those files. `Checked 3 files. No fixes applied.`

```text
npx tsc --noEmit --pretty false --incremental false
```

Outcome: exit 0. This typechecks against `halaska-kit.d.ts`. That shim types every component as `any` or a wide `ComponentType`, so it does not prove prop correctness.

```text
npx next build
```

Outcome: exit 1. Next.js `15.5.9` printed `Compiled successfully in 24.4s`, then failed while generating static pages:

```text
Error occurred prerendering page "/_not-found"
Error: @clerk/clerk-react: Missing publishableKey.
Export encountered an error on /_not-found/page: /_not-found
```

Webpack also warned: `Serializing big strings (175kiB) impacts deserialization performance`. The production build did not finish, and Next did not print its route size table. The failure is the existing root `ClerkProvider`, not a Halaska syntax error. No Clerk environment name is referenced in this repository's source.

Client files listed for `/spike/f01/page` in `.next/app-build-manifest.json` after that compile, gzip measured locally with `mtime=0`:

| File | Raw bytes | Gzip bytes | Notes |
| --- | ---: | ---: | --- |
| `static/chunks/app/spike/f01/page-23d2a6093541ccc1.js` | 44942 | 14769 | Contains `halaska-blink` / `data-halaska-orb`. Kit plus prototype module. |
| `static/chunks/8140-c39d5372e3c3f0de.js` | 616849 | 187437 | Contains `streamdown`, `shiki`, `katex`, `lucide`, `stick-to-bottom`. Pulled in by existing `Response`. |
| `static/chunks/d3ac728e-c3f1b1482325c621.js` | 268355 | 76242 | Contains `KaTeX`. |
| `static/css/df64af30921ff372.css` | 24731 | 3833 | Contains `KaTeX`. |
| `static/chunks/5707-6e9128a46d0d5a94.js` | 27488 | 8860 | Also referenced by the auth pages. |
| Framework quartet (`webpack`, `4bd1b696`, `1255`, `main-app`) | 358113 | 106788 | Shared with other routes. |

Route files excluding that framework quartet: 982365 raw bytes, 291141 gzip bytes. The Halaska module itself is the 45KB page chunk, not the Streamdown/KaTeX chunks. These numbers are from an unfinished build. They are not a Worker upload size.

Server compile of the same route: `.next/server/app/spike/f01/page.js`, 61414 raw bytes, 20215 gzip bytes, and it contains the kit marker.

## Checks that did not run

- No browser session. Keyboard order, dialog focus return, hydration, contrast, and reduced-motion behavior are unverified at runtime.
- No `next dev` or `next start`. Prerender already requires a Clerk publishable key, and none is available.
- No OpenNext/Wrangler build, preview, or deploy. Worker CPU, streaming cancellation, cold start, and quota were not measured.
- No provider request. `OPENROUTER_API_KEY` is unread and was not present in a local env file.
- No Supabase project, Cloudflare account action, or paid signup.
- Dependency install used npm and the current `package-lock.json`. Bun was not introduced. Local Bun is `1.4.2`; the latest stable release seen on GitHub is `1.4.3` (2026-10-10). Bun was not upgraded.

## Versions proposed for F02, not installed

Current lockfile, left in place:

| Package | Locked version |
| --- | --- |
| `next` | 15.5.9 |
| `react` / `react-dom` | 19.1.0 |
| `ai` | 5.0.61 |
| `@ai-sdk/react` | 2.0.61 |
| `@ai-sdk/openai` | 2.0.44 |
| `@openrouter/ai-sdk-provider` | 1.2.0 |

Registry facts checked against npm on 2026-10-17. Do not treat beta or canary tags as candidates.

| Package | Stable facts |
| --- | --- |
| `next` | `latest` 16.4.2 (2026-10-15). `backport` 15.5.28. Both peer `react` `^18.2.0 \|\| ^19.0.0`. |
| `@opennextjs/cloudflare` | `latest` 1.20.12. Peer `next` is `>=15.5.28 <16 \|\| >=16.4.1`. Peer `wrangler` is `^4.148.0`. |
| `wrangler` | `latest` 4.151.1. |
| `react` | `latest` 19.3.1. `backport` 19.1.10. |
| `ai` | `latest` 7.0.143. Tag `ai-v5` is 5.0.277. Tag `beta` is 7.0.0-beta.187 and is not a pin target. |
| `@ai-sdk/react` | `latest` 4.0.147, matching AI SDK 7. Tag `ai-v5` is 2.0.280. That 2.0.280 peer range is `react` `^18 \|\| ~19.0.1 \|\| ~19.1.2 \|\| ^19.2.1`, which does not include the locked React 19.1.0. |
| `@ai-sdk/openai` | `latest` 4.0.96. Tag `ai-v5` is 2.0.135. |
| `@openrouter/ai-sdk-provider` | `latest` 3.1.0 peers `ai` `^7`. 1.5.4 peers `ai` `^5`. 2.10.0 peers `ai` `^6`. |

`@opennextjs/cloudflare@1.20.12` does not accept the locked `next@15.5.9`. A later F02 pin has to move Next to at least 15.5.28, or to 16.4.1+, and then retest the app. AI SDK 7 is a separate migration from the locked 5.0.61 chat route. This slice did not attempt either move.

Cloudflare's current Next.js guide recommends vinext and calls it beta. vinext was not added. OpenNext remains the non-beta adapter to test in F02.

## Cost notes from primary pages already fetched

Not a budget acceptance pass. No account was billed.

- Workers pricing (https://developers.cloudflare.com/workers/platform/pricing/): Free is 100,000 requests/day and 10ms CPU per invocation. Paid is a $5 USD/month minimum, then usage past the included amounts. Paid is not a hard monthly cap.
- Workers limits (https://developers.cloudflare.com/workers/platform/limits/, updated Oct 12, 2026): Free and Paid both list Worker size as 64 MiB uncompressed, and that page says there is no compressed size limit. HTTP duration is unlimited while the client stays connected. CPU time on Free stays 10ms.
- OpenNext's Cloudflare page still says the Worker size limit is 3 MiB compressed on Free and 10 MiB on Paid. That conflicts with the limits page above. This slice did not produce a Worker bundle, so neither document was tested against this app.
- Vercel Hobby (https://vercel.com/docs/plans/hobby): free, and the fair-use text restricts it to non-commercial personal use. It is not the commercial hosting plan.
- Supabase and Vercel AI Gateway prices were not re-fetched in this slice. Nothing here authorizes turning them on.

The $10/month cap is not shown to fail by these notes, and it is also not shown to hold. Workers Paid would consume $5 before inference if Free cannot run the app. That choice is blocked on the missing worker build.

## Remaining requirements

1. Provide a Clerk publishable key locally, rerun `npx next build`, and keep the failing prerender from being reported as success. Then record the route table Next prints.
2. Browser-check `/spike/f01` for hydration, Tab/Escape dialog behavior, the unlabeled theme radiogroup, contrast, and `prefers-reduced-motion`.
3. In F02, pin an adapter-compatible Next version and a matching AI SDK line, then run an OpenNext build. Measure uncompressed Worker size, startup, streaming, cancellation, and CPU. Do not deploy until that build fits the chosen tier.
4. Keep paid inference, Supabase provisioning, and Cloudflare resource creation out of the spike until credentials and the budget gate are explicit.
