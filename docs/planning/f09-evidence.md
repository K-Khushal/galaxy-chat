# F09 explicit memory, projects and temporary chat evidence

Date: 2026-10-17. Issue: [F09 / #13](https://github.com/K-Khushal/galaxy-chat/issues/13). Branch `codex/f09-memory`, exact source base `6f256aa2183a19d0252d191dc5ac58c566f51124` (reviewed F08 head). All changes are uncommitted for root independent review. The worker changed only the designated `galaxy-rebuild/galaxy-chat` managed checkout. No push, PR, merge, cloud provisioning/login/deploy/billing, live migration or paid provider call was performed. Original checkout content and F10/F11 checkouts were not edited.

## Explicit memory and project boundaries

`/chat/context` implements real authenticated memory/project create, edit and delete through the private `/api/context` API. All operations use the invited Better Auth session user, strict request schemas, same-origin mutation checks, and owner-filtered SQL. The only memory writer is the explicit Save action/API; chat inference never collects or creates memories. There is no Mem0 integration.

Migration `0005_explicit_context.sql` adds owner-filtered, RLS-enabled project/memory tables, revoked browser-role grants and a composite owner/project foreign key for memories and saved conversations. Projects own instructions and scoped memories; global memories still require opt-in. New conversations choose one owned project. Later turns/branches cannot change that association. The management view groups owned conversations under projects. Project deletion ungroups its conversations and deletes its scoped memories; account deletion cascades context content while existing anonymous money/resource audit survives.

Request context presents the exact selected memory text and project instructions. The browser sends IDs and a preview digest, never trusted instruction text. Server-side resolution denies foreign owner/project IDs, duplicate memory IDs and stale snapshots. Rechecks immediately before provider entry prevent a selection revoked during preparation from entering inference. The picker invalidates send eligibility synchronously when selection changes; a new preview must complete before sending. Clear/refresh controls recover stale selections, and a project deletion may require reloading the conversation. No context text or selected IDs are added to cost/resource evidence.

Safe chosen limits: at most 100 memories per owner, 1,000 characters / 1,800 UTF-8 bytes each; 30 projects per owner, 80-character name and instructions up to 2,000 characters / 3,000 UTF-8 bytes; eight explicitly selected memories per request. Combined base/project/memory instructions have a 4,500 JSON-encoded-byte ceiling. Instructions and recent text share the existing 12,000-byte total context bound, at most 12 recent messages, conservative 16,384 input-token ceiling and 512 output tokens. Oldest messages may be dropped; selected instructions/memories are never silently removed. This is a conservative byte budget, not an exact tokenizer measurement. Existing worst-case reservations and provider bounds remain intact for platform funding and isolated BYOK.

Editing or deleting a selected memory invalidates its preview. A fresh subsequent request omits deleted content. Deletion does not recall already-entered provider requests or remove facts repeated in earlier saved prompts/answers. Providers retain their own independent policies. Owned account export now includes memories/projects and conversation grouping, without exporting keys or anonymous actor identities.

## Temporary content and accounting

`/chat/temporary` uses the real shared chat UI and inference route with explicit temporary mode. It bypasses `prepareRun`/`finishRun` entirely. No chat, message, branch, run, title, personal usage record, history entry, memory, or transcript export is created. Temporary IDs cannot reopen any persisted chat; saved branch anchors/edit/regenerate/retry requests are rejected. Caller-supplied transient history is accepted only in temporary mode. The client retransmits only up to 11 preceding user/assistant text turns, excluding system/reasoning/file/source parts and the current prompt (which travels once as `message`). There is no localStorage/sessionStorage transcript persistence, automatic resume, saved-history reload or history-created event. `data-conversation-mode="temporary"` exposes the eligibility boundary for subsequent UI integration.

Platform temporary requests retain the same durable reservations, idempotency, shared/daily/concurrency limits and conservative cancellation holds. Temporary accounting suppresses remote provider response IDs. Existing anonymous audit holds opaque request IDs, one-way digests, HMAC actor identity, numeric usage/cost/state/timestamps and fixed evidence, not prompt/answer/title/memory/project payload. Explicit BYOK uses only the owner's saved encrypted credential and its existing anonymous resource lease, without platform-money fallback. A pre-entry context revocation releases the safe reservation/lease and returns `context_changed`; unknown entered usage is never released by Stop, disconnect or account deletion.

The visible temporary disclosure distinguishes tab-local transcript, retained anonymous operations and independent provider processing/retention. Operator instructions forbid request-body/prompt/response/SDK-trace content logging. App guarantees do not imply provider or cloud log erasure, or control a user's own clipboard/browser copies.

## UI and local fixture

The existing semantic shell, Geist typography, controls, focus styles and responsive layout are extended without a broad redesign. New sidebar links reach temporary chat and Memory & projects. Native labeled inputs/selects, 16px mobile editing text, scrollable context/editor areas, 44px controls, pending-save guards, explicit deletion confirmation and post-delete field focus support keyboard and touch use. Project and memory content is React-escaped text. The installed SDK's current `throttle` option replaces the inherited deprecated spelling in the touched signed-in chat.

Development-only `/preview/ui?context=1` reuses production ContextManager/ContextPicker with an explicitly injected in-memory client. It supports local CRUD and selection inspection without auth, database or provider calls, is linked in the existing responsive landing workbench, and stays behind both development runtime and `F04_UI_HARNESS=1`. It is not an authentication bypass or live availability claim. Root owns independent browser/physical-device/accessibility review. This worker started no browser/dev/production server and claims no screenshot, auditory screen-reader, contrast-ratio or physical mobile pass.

## Verification

Read the installed Next 16.4.2 route-handler/server-client guides and AI SDK 7.0.143 bundled generation/chat docs/source before integration. Used the repository AI SDK and existing frontend/mobile design guidance, preserving the established shell and funding boundaries.

All SQL, full tests, standalone typecheck and build commands were serialized through the shared local check lock; portable operator instructions use ordinary repository commands and do not depend on that local wrapper. Tests retain the default five-second deadline. Every query after PGlite socket start uses the captured application's postgres.js max:1 driver. Rejection assertions use native-await `rejectionOf`; no direct engine polling races or weakened assertions/timeouts were introduced.

- Final `bun test`: **108 passed, 0 failed, 1,045 assertions across 15 files, 57.37s**.
- Focused F09 integration/UI run: **10 passed, 0 failed, 167 assertions, 10.80s**.
- Final `bun run typecheck`: passed.
- Final `bun run lint`: passed, **235 files**.
- `bun run f01:integrity`: passed.
- Final credential-free `bun run build`: passed, including TypeScript and dynamic `/api/context`, `/chat/context`, `/chat/temporary` routes.
- `git diff --check`: passed.

New real-SQL/signed-session/installed-SDK cases cover exact selected payloads, unselected exclusion, cross-owner/project denials, edit/delete invalidation, fresh-prompt deletion exclusion, project grouping/deletion, composite constraints/RLS/account cascade, unauthenticated/uninvited/foreign-origin denial, temporary empty history/export/content tables, funded and BYOK accounting isolation, shared daily limits, pre-entry context revocation and unknown cancellation holds. UI regressions cover escaped selected content and faithful budget disclosure plus temporary text-only history bounds. Existing guest, immutable audit, ownership, keys, branches, shutdown, recovery and provider-diagnostic regressions remain green. Synthetic SSE only; no remote provider endpoint was contacted.

Live OAuth/invites, real provider prices/receipts/cancellation, hosted database/runtime concurrency, provider/cloud retention and backups, deployed rollback, physical-device and assistive-technology acceptance remain pending. F09 local implementation and passing checks do not authorize or establish public beta launch.

## Changed files

- `app/(chat)/api/chat/route.ts`
- `app/(chat)/api/context/route.ts`
- `app/(chat)/chat/[id]/page.tsx`
- `app/(chat)/chat/context/page.tsx`
- `app/(chat)/chat/page.tsx`
- `app/(chat)/chat/temporary/page.tsx`
- `app/help/page.tsx`
- `app/preview/ui/page.tsx`
- `app/privacy/page.tsx`
- `components/chat/chat.tsx`
- `components/chat/context-picker.tsx`
- `components/context-manager.tsx`
- `components/home/home-sections.tsx`
- `components/preview/context-preview.tsx`
- `components/preview/landing-workbench.tsx`
- `components/sidebar/sidebar-actions.tsx`
- `docs/operations/beta.md`
- `docs/planning/f09-evidence.md`
- `drizzle/0005_explicit_context.sql`
- `lib/actions/account/account.ts`
- `lib/actions/chat/branches.ts`
- `lib/actions/chat/chat.ts`
- `lib/ai/utils.ts`
- `lib/byok/service.ts`
- `lib/context/client.ts`
- `lib/context/contract.ts`
- `lib/context/service.ts`
- `lib/context/transient.ts`
- `lib/credits/service.ts`
- `lib/db/schema.ts`
- `lib/schema/chat/chat.ts`
- `lib/types/index.ts`
- `tests/f03.integration.test.ts`
- `tests/f09-ui.test.tsx`
- `tests/f09.integration.test.ts`
