# F15 public home local evidence

Date: 2026-10-17. Implementation baseline: `d8ca7a57117f700d9c79a02e3024d87cf6202442`. Isolated checkout: `codex/f15-landing` in `galaxy-rebuild/galaxy-chat`. The original checkout and its separate planning commit were not edited. Root owns independent source and browser review, integration and GitHub actions. This worker made no commit, push, PR, merge, deployment, provisioning, login, billing change or real provider request.

## Design and component choices

The old home used fixed warm colors, duplicated placeholder copy, no useful product explanation, and “Start for free” without the shared-funding qualification. The new page uses the existing F04 cool blue-gray semantic palette, Geist body type and the existing Georgia serif token for a large display headline. The paired light/dark values remain in `app/globals.css`; no parallel palette or global typography system was added. The composition pairs an oversized left introduction with one conversation surface, then uses open feature columns, funding panels, data controls and a final workspace action. It deliberately avoids fabricated customer counts, testimonials, live output, model lists and performance claims.

`Message` and `MessageContent` render the authored example, with the existing flat message treatment. The visible “Example preview” label and figure caption state that the text was written for the preview and is not a model response. The preview contains no interactive-looking send action or fake model selector. Navigation actions use the existing Button/Link behavior. Footer appearance uses the real shared ThemeControl with scoped visible focus styling. No component package, animation runtime, dependency or lockfile was added.

The design plan was reviewed against the brief before implementation: one shared chat surface, open benefit columns, and two differentiated funding explanations keep the composition specific to the actual workspace. The page uses existing semantic colors for canvas, surface, supporting text, action, border and focus. Scoped geometry, display sizes, responsive breakpoints and safe-area calculations are landing-specific exceptions. The code-native icon and social asset use fixed equivalents of the light brand palette because external image consumers cannot resolve CSS variables. They are original local assets: `app/icon.svg`, `public/galaxy-social.svg`, and the 1200×630 PNG generated from that SVG with the already-installed Sharp package. No stock or paid asset is used. The old favicon was removed so the icon convention supplies Galaxy branding.

Motion is limited to the existing shared 140ms button color feedback. There is no page-load sequence, scroll animation, token animation, parallax or decorative runtime. Global reduced-motion overrides remain authoritative. Custom hover styles are gated on hover/fine-pointer capability. The normal document remains scrollable; public links have manipulation touch behavior, and header/footer padding accounts for safe areas. Physical-device behavior is pending.

## Entry, funding and data boundaries

The primary “Open your workspace” action goes to the existing `/chat` route, retaining its session and invitation checks. `/sign-in` remains the existing GitHub-only gate, including its useful disabled configuration state. The public page does not read private auth/credit/provider endpoints, query a session/database, accept keys, set guest cookies, or make inference requests.

Guest chat is explicitly unavailable on this landing page. Copy describes the planned bounded basic-text entry and directs an invited user to working sign-in. Existing `/api/guest` bot, signed-cookie, proxy, quota and funding checks were not changed. The F08 worker separately owns real guest onboarding and its integration; no success or availability is simulated here. The final guest link should be coordinated after that slice is integrated and reviewed.

Credit copy preserves the agreed policy: one credit = $0.10, five daily credits = a maximum $0.50, 00:00 UTC reset, no rollover/cash value, basic text models only, and availability conditional on shared funding and enabled service. BYOK names only the implemented OpenRouter and Vercel AI Gateway routes, directs key management to Account & settings → Keys, explains provider charges/third-party processing/service limits, and makes no all-model or maximum-provider-bill promise. Funding never silently changes. Memory, attachments, artifacts, tools and browser work are explicitly roadmap items.

New server-rendered `/privacy` and `/help` pages provide real public destinations. They explain current saved-chat behavior, account export/delete and key deletion, provider processing, retained operational records and incomplete live retention/backup verification. Instructions point to actual workspace settings instead of linking to invented settings routes. General support links to this repository's public GitHub issues; private account questions go to the person who invited the user, and no private support inbox is invented. The pages warn against including secrets/private data in public issues. No authentication, ownership, billing, key storage, retention or deletion policy was changed.

## Rendering, metadata and installed documentation

Home, help and data content are Server Components; the existing theme controls are the only new-page client interaction. There is no new fetch, large image in the initial page, or model library in the public UI. Existing root theme handling follows light/dark/system. The page does not opt into dynamic session rendering.

`SITE_URL` is an optional nonsecret bare origin documented in `.env.example`. Valid HTTPS origins (or HTTP loopback for local preview) supply canonical and absolute Open Graph/Twitter image URLs. Missing/invalid values omit those absolute fields entirely, including in credential-free production builds: no production domain or localhost URL is guessed. Credentials, query/fragment/path payloads and insecure remote origins are rejected by a pure tested helper. Metadata configuration is evaluated with the static page build; configure the origin before building for the intended host. Social artwork exists locally regardless of whether an origin is configured.

Read version-matched Next 16.4.2 installed docs before editing: layouts/pages, public-static-pages, metadata/OG overview, metadataBase URL behavior, and the opengraph-image file convention. Current repo planning/evidence and F04 UI/Button contracts informed the copy and shared-component choices.

## Scope of the design workflow

Requested frontend-design, design-system-boss, build-design-system, migrate-design-system, ui-review, mobile-native and animate skill guidance was read. This is the explicitly authorized home redesign on an established system, rather than a whole-app system build or migration. Per the user's narrower scope and standing instructions, it adds no extraction/check-script framework, migration fan-out, commit workflow, new taste-approval round or self-grade. Root independently reviews source and rendered UI. The before image is retained as an intentional redesign baseline, with no pixel-parity claim.

Applicable migration lessons: 1 (edits confined to the named surface and additions), 6 (browser review must not perform backend writes), and 8 (review widths inside the actual rendered viewport). Lesson 5 write-body parity is not applicable: no request/submission handler or API write is added or moved. No backend fixture/test assertion or timeout was weakened.

## Commands and local results

Heavy checks use the host-wide fcntl runner and ran sequentially. No dev server ran during the production build.

- `bun run lint` — exit 0, Biome checked 212 files with no remaining findings.
- `python3 /private/tmp/galaxy-run-check.py bun run typecheck` — exit 0.
- `bun run f01:integrity` — exit 0, vendor integrity passed.
- `git diff --check` — exit 0.
- `python3 /private/tmp/galaxy-run-check.py bun test` — exit 0: 88 tests, 0 failures, 722 assertions across ten files, 41.42 seconds. Includes all F03–F07 regressions, two canonical URL safety tests, and the preview route boundary test. Default five-second per-test deadline retained; local synthetic provider fixtures made no remote requests.
- `python3 /private/tmp/galaxy-run-check.py bun run build` — exit 0, Next 16.4.2 credential-free production build. `/`, `/help`, `/privacy` and `/icon.svg` are statically prerendered; the gated `/preview/landing` route and existing private/API routes retain dynamic behavior.
- Social asset generation: `bun -e 'import sharp from "sharp"; await sharp("public/galaxy-social.svg").png().toFile("public/galaxy-social.png");'`. `file public/galaxy-social.png` confirms 1200×630 RGBA PNG; `ls -lh` reports 61KB. The PNG was opened locally to inspect its rendered content.

## Independent browser evidence and remaining gates

Root captured the unchanged old home at 1280×720 in `/private/tmp/galaxy-f15-before-desktop.png` before source edits. Its accessibility tree showed the placeholder galaxy copy and “Start for free” action. Root stopped its baseline server before implementation/build.

Root completed independent desktop and 390px browser review; its supplied results and limits are recorded below. This worker assigns no rendered quality grade. Tablet, quantitative reduced-motion/contrast/responsiveness, physical-device and auditory assistive-technology measurements are not claimed. No before/after pixel parity is expected from this intentional redesign.

Still pending independently of the landing code: F08 guest integration/end-to-end onboarding; real OAuth and provider streaming/cancellation; host/runtime/CPU/deployment; shared-funding and total-budget acceptance; production retention/backup/restore practices; physical iOS/Android safe-area/touch behavior; auditory assistive-technology checks. Local code checks do not close the public beta release gate.

## Independent review follow-up: real viewport workbench

Root's production desktop pass found coherent home composition and confirmed that the primary `/chat` action redirects to `/sign-in?notice=auth_unconfigured`, where GitHub sign-in is correctly disabled. Root also found that the new help/data instructions named the Privacy tab while the real export/delete controls are in the Account tab. Both public pages now say Account & settings → Account. Existing controls were not moved.

The in-app browser has a fixed outer viewport. `/preview/landing` therefore supplies an actual iframe viewport at 390, 768, 1280, or Fit, with Home/Help/Privacy page selection and the real shared theme control. The iframe loads the actual public route, with no fixtures, auth simulation, changed requests or alternate landing implementation. All destination links keep their ordinary checks. The route reuses the existing `uiHarnessEnabled` gate: development runtime AND `F04_UI_HARNESS=1`; production always calls Next `notFound()`, including when the flag is set. The workbench imports no chat/settings/provider runtime or synthetic fixture module. Preview UI is referenced only by its separate gated route.

Root reviewed the workbench on development port 3063. Reproduce with `F04_UI_HARNESS=1 bun run dev --hostname 127.0.0.1 --port 3063`, then `/preview/landing`. Root owns the server and captures. Physical mobile behavior remains pending even with a real 390px CSS viewport.

- `bun run lint` after the preview/copy additions — exit 0, 212 files.
- `git diff --check` — exit 0.
- `python3 /private/tmp/galaxy-run-check.py bun test tests/f15-metadata.test.ts tests/f15-preview.test.tsx` — exit 0: 3 tests, 0 failures, 20 assertions, 34ms. The new test invokes the actual route boundary across production with/without flag, test, development missing/off, and development enabled; it does not snapshot styling.
- `python3 /private/tmp/galaxy-run-check.py bun run typecheck` after the workbench addition — exit 0.
- `python3 /private/tmp/galaxy-run-check.py bun run build` after the workbench addition and independent responsive QA — exit 0. No build ran while root's review servers were running.


## Root's independent rendered record

Root reported no remaining actionable UI/source findings after the Account-tab copy correction. Production desktop light/dark used the actual landing route, and theme choice persisted across Privacy → Home navigation. The primary chat CTA reached `/sign-in?notice=auth_unconfigured` with disabled GitHub sign-in, preserving the real route gate. The development workbench's actual 390px iframe contained navigation, headline and primary action without horizontal clipping. Root used the skip link and real Tab presses to reach the main CTA and observed its focus ring; theme changes propagated into the iframe.

Captures supplied by root:

- Before: `/private/tmp/galaxy-f15-before-desktop.png` (1280×720 unchanged original home).
- After: `/private/tmp/galaxy-f15-after-desktop-light.png` and `/private/tmp/galaxy-f15-after-desktop-dark.png`.
- Phone CSS viewport: `/private/tmp/galaxy-f15-after-phone-light.png` and `/private/tmp/galaxy-f15-after-phone-dark.png` (390px iframe, not physical-device evidence).

Root's `/private/tmp/galaxy-f15-root-http-metrics.json` records five warm localhost Next production HTTP samples: status 200 throughout; first-byte times 12.37, 2.34, 1.98, 1.56 and 1.52ms; 54,149 HTML bytes; 11 initial script files totaling 655,068 uncompressed bytes. Conditions were Python HTTP reads with identity/uncompressed response sizes on the local production review build, before the final preview-harness build. These are not browser LCP/INP, real-network measurements, transfer-compressed bundle sizes, mobile device timings, model first-token timings or latency guarantees.

The supplied browser record supports the named viewport/theme/focus/CTA checks. No automated accessibility score, measured contrast ratio, auditory screen-reader result, browser Event Timing measurement, or quantitative reduced-motion result was supplied; none is claimed. Existing global reduced-motion styles and the absence of new animated effects remain source-level evidence. The 768px option is available for further tablet inspection, but a measured tablet capture is not claimed here.

Root stopped production review server 3061 and then development server 3063 before the final build/suite. This implementation worker started no server. Guest integration remains pending the independently verified F08 route; the home continues to show its honest unavailable state.


## Final implementation handoff

After root stopped its review servers, the shared-lock full suite passed 88 tests / 0 failures / 722 assertions across ten files in 41.42 seconds. The final credential-free production build then passed, including TypeScript and static prerendering. Final lint (212 files), vendor integrity and whitespace checks passed. Root owns any subsequent independent checks, integration, guest-link coordination and GitHub actions. No source changed after root's final UI review; only this evidence was completed. No implementation-owned process, server, or active writer remains after handoff. No commit, push, merge or deployment was performed.
