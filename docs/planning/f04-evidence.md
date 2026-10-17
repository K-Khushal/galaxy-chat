# F04 responsive chat shell — implementation evidence

Date: 2026-10-17. Branch: `codex/f04-chat-ui`, base `e779231`. Status: code-complete local slice; root browser review completed for the reported surfaces and focus paths. Live, physical-device, auditory screen-reader and remaining measured acceptance checks stay pending. The worker inherited Cursor's partial dirty F04 work and finished it. No commit, push, PR, deployment, cloud resource or paid provider call was made by this worker. `next dev` generated an untracked root `AGENTS.md` containing its version-specific documentation reminder; that generated file is left for root integration review.

## Settled decisions and scope

No unanswered product choices. User authorized autonomous design choices and the best reputable free components, with Halaska/Be UI/shadcn/AI Elements as options. The chosen system uses existing Radix/shadcn behavior and adapted AI Elements/Streamdown, retaining Halaska's restrained density/radius conventions while applying the inherited cool neutral Galaxy palette. No Pro component or new dependency was added. The large vendored kit stays outside the chat runtime. Existing MIT Halaska bytes, attribution and checksums remain intact; `bun run f01:integrity` passes.

Requested design.how skills were read from `/private/tmp/galaxy-cursor-skills`: design-system-boss, build-design-system, migrate-design-system, token-mapping, component-docs, ui-review, frontend-design, mobile-native and animate, plus relevant references. Scoped run notes live in ignored `.design-system/`. Root is coordinator/independent verifier; this worker only reports source/command self-checks. Parent instructions override new approval/commit/fanout workflows. There was no clean rendered before baseline because the handoff started with partial redesign edits. No screenshot or pixel-parity claim is made.

## Before and after surfaces

| Surface | Before in inherited/base source | Result |
| --- | --- | --- |
| Chat navigation | partial/broken imports, title animation, fake share item, weak pagination failure handling | search, explicit load more, selected row, rename/delete confirmation and network errors; mobile closes after navigation |
| Desktop/mobile shell | missing chat header/mobile opener | shared private-chat header, named mobile drawer and touch controls; title passed from existing chat record |
| Empty chat/composer | generic greeting, unsupported feature controls, fabricated model defaults | useful draft starters, consistent reading width, minimal textarea and paused availability; model menu has honest unconfigured state |
| Messages | nested competing scroll owners and smooth following during tokens | one scroll region, empty state always starts at the top, populated content follows only near bottom, latest-message control, reduced-motion aware manual scroll; code/table overflow contained |
| Actions | fake like/dislike confirmation and unsafe pending branch actions | copy always reachable; edit/regenerate gated until F05; no fake feedback persistence |
| Account/settings | crowded desktop-only partial tabs, silent export/delete failures | responsive Radix tabs, identity, appearance, privacy, export/delete busy and failure states, explicit destructive confirmation |
| Sign-in | duplicate branding/nested viewport wrapper, raw setup details | shared clean sign-in/unconfigured/invite panel and corrected auth layout; GitHub auth remains enforced |
| Loading/error | generic spinner/error layout | reusable skeleton shell and recoverable conversation error |
| Credits/theme | invented usage defaults or partial placeholders | typed unavailable state by default; no live balance; coherent light/dark/system control |

Product requests retain existing server routes/ownership enforcement. The only existing server-page edit passes the already-read `chat.title` to the UI. Real `/chat` auth layout and API auth/DB logic are untouched. Query text now becomes an editable draft instead of automatically sending a funded request. File/voice/search/branch/provider-key features remain unavailable where not implemented.

## Sources and licenses

- Existing `components/ui/*`: local shadcn-style wrappers over installed Radix; Radix Dialog/Sheet/Tabs/menu behavior retained. Installed Radix packages carry MIT, WorkOS attribution in node_modules.
- Existing AI Elements adapters and `streamdown` rendering: retained and styled through the same semantic tokens. Installed Streamdown license is Apache-2.0, Vercel. No code was downloaded or copied from Be UI or a paid collection in this slice.
- Halaska provenance: `vendor/halaska/PROVENANCE.md`, MIT license and `SHA256SUMS` unchanged.
- Existing Geist/Geist Mono and lucide-react are reused; no new font/icon dependency.
- Version-matched AI SDK UI/transport docs read locally: `node_modules/ai/docs/04-ai-sdk-ui/02-chatbot.mdx`, `21-transport.mdx`. Existing AI SDK 7 transport/body contract retained.

## Tokens and readiness

Canonical mapping and state contracts: `docs/system/f04-ui.md`; Button entry: `docs/system/button.md`. Semantic colors and paired text roles are in `app/globals.css`; primitives and new shell surfaces use those names. Typography and normal geometry use the existing Tailwind scale. Exceptions: safe areas/dynamic viewport, Radix placement variables, actual preview widths, code/Markdown internal layout, standard overlay scrims and untouched legacy routes.

The starter audit command `node /private/tmp/galaxy-cursor-skills/build-design-system/scripts/check-system.mjs --no-allowlist --no-self-test --json` ran against the whole inherited repo and returned exit 1 with 354 findings at close. It reports raw values in the token source, arbitrary geometry, unregistered existing UI, legacy palettes and legacy motion; this is not a zero-gap/full-app migration. Raw output is kept in ignored `.design-system/f04-token-audit.json`. No allowlist was expanded and no broad checker/ratchet was added to conceal those findings. F04 deliberately does not migrate unrelated landing/library/spike screens or install a full registry. Native text patterns are retained as a scoped exception. Root owns any later full-system migration and independent readiness acceptance.

Migration lessons applied: 1 (exact scoped edits/formatter), 2 (preserve server payload strings), 5 (same server endpoints/body keys; UI-only preview actions), 6 (no browser against real writes; fixture callbacks), 7 (no worker runtime-grade claim), 8 (real iframe viewport widths provided; independent measurements pending). No before/after write-body capture pair exists, so no write parity proof is claimed. Existing integration tests continue to prove server ownership.

## Credential-free preview

```sh
F04_UI_HARNESS=1 bun run dev --hostname 127.0.0.1 --port 3044
```

Open `/preview/ui`. Gate requires both development runtime and flag `1`. `.env.example` defaults OFF. Production always returns 404 even with the flag enabled. Real auth routes are never bypassed.

Workbench controls state, theme, account tab, credit fixture, and 390/1280/Fit iframe widths. Each iframe has actual media-query dimensions. Direct canvas example: `/preview/ui?canvas=1&state=populated&theme=dark`. Supported states: empty, populated, loading, streaming, error, long, history-loading, history-error, sign-in, unconfigured. Dialogs: `dialog=profile|appearance|security`; delete confirmation opens from Account. Credits: `credit=unavailable|available|exhausted|paused|byok`. All fixture content is explicitly labeled; it is not presented as model output or real balance.

The harness reuses AppSidebar/SidebarHistory/SidebarUser, ChatHeader, ChatMessages, ChatInput/ModelSelector, SettingsDialog, SignInPanel, ChatLoading and shared primitives. History uses a null SWR key; all mutations/sign-in/sign-out/account actions are injected local callbacks. Composer adds only a local user message and never generates a reply. Account export reports preview behavior without requesting private data. No preview fetch to backend/provider is made. No real auth session is created.

## Commands and observed results

- `bun run lint`: exit 0, Biome checked 172 files, no fixes/findings at final UI check.
- `bun run typecheck`: exit 0 after strict optional-test fix.
- `bun test`: exit 0, 29 pass / 0 fail / 167 assertions across 5 files, including embedded Postgres tests. Loopback permission was granted for the test listener.
- `bun run f01:integrity`: exit 0, vendor integrity passed.
- `bun run build`: exit 0, credential-free production route compilation completed. No private config was added.
- `git diff --check`: exit 0.
- Development canvas HTTP probe: `/preview/ui?canvas=1&state=populated&theme=light` returned 200.
- Production server with `F04_UI_HARNESS=1`: `/preview/ui` and `?canvas=1` returned 404; `/chat` returned 307 to `/sign-in?notice=auth_unconfigured`; `/sign-in` returned 200; `/api/history` returned 503. This verifies the route gate and auth fail-closed behavior, not visual quality.

New tests exercise the runtime/flag matrix, credit state precedence and amount formatting, history cursor/search encoding, whitespace/busy submission guards, rendered disabled composer draft, rendered streaming stop, rendered unconfigured sign-in and reduced-motion scroll/invalid usage. They do not pretend to be browser interaction tests.

## Remaining acceptance

Root’s independent review found the 390px/short-height empty state initially scrolled to the bottom. The worker fixed empty-state following and compacted mobile starters; Root rechecked a fresh 390px iframe in a 1280×720 host: heading/top content visible, remaining starters scroll within messages; capture `/private/tmp/galaxy-f04-mobile.png`. Root also reported coherent dark account layout, history rename Escape returning to the exact row action, and no fresh issue badge. Review also requested deterministic nested account-confirmation focus return and completion announcements; explicit opener refs and one polite atomic lifecycle output were added. Streamed message content remains aria-live off and transport errors retain role=alert. Standards review also requested an explicit mobile drawer opener/close-focus contract and history pending spinners; both were added in shared primitives/call sites. Root’s final browser retest confirms mobile drawer Escape returns to Toggle Sidebar and nested account-confirmation Escape returns to Delete account with a visible focus ring. Independent browser captures/probes are assigned to root; this worker has not captured screenshots or measured rendered contrast, focus rings, Event Timing, screen reader output, viewport bounds or token-stream performance. No physical iOS/Android safe-area test or auditory screen-reader test has been run. Streaming fixtures are static states; live provider SSE/cancellation/reload/branch persistence are F05/live gates. Real OAuth, hosted SSE, credit/BYOK backend integration, billing and deployment remain pending. See root review evidence for the independent rendered record; no device/screenshot counts are invented here. Both worker-owned servers (development 3044, production probe 3045) were stopped before handoff.
