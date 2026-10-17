# F09 explicit memory, projects and temporary chat evidence

Date: 2026-10-17. Issue: [F09 / #13](https://github.com/K-Khushal/galaxy-chat/issues/13). Branch `codex/f09-memory`, exact source base `6f256aa2183a19d0252d191dc5ac58c566f51124` (reviewed F08 head). Root pinned the initial implementation and auth-helper extraction at `4b9e482dc492ed1077bd0833576a2c57ab6d0414`; the subsequent review fixes described below remain uncommitted for root independent review. The worker changed only the designated `galaxy-rebuild/galaxy-chat` managed checkout. No push, PR, merge, cloud provisioning/login/deploy/billing, live migration or paid provider call was performed. Original checkout content and F10/F11 checkouts were not edited.

## Explicit memory and project boundaries

`/chat/context` implements real authenticated memory/project create, edit and delete through the private `/api/context` API. All operations use the invited Better Auth session user, strict request schemas, same-origin mutation checks, and owner-filtered SQL. The only memory writer is the explicit Save action/API; chat inference never collects or creates memories. There is no Mem0 integration.

Migration `0005_explicit_context.sql` adds owner-filtered, RLS-enabled project/memory tables, revoked browser-role grants and a composite owner/project foreign key for memories and saved conversations. Projects own instructions and scoped memories; global memories still require opt-in. New conversations choose one owned project. Later turns/branches cannot change that association. The management view groups owned conversations under projects. Project deletion ungroups its conversations and deletes its scoped memories; account deletion cascades context content while existing anonymous money/resource audit survives.

Request context presents the exact selected memory text and project instructions. The browser sends IDs and a preview digest, never trusted instruction text. Server-side resolution denies foreign owner/project IDs, duplicate memory IDs and stale snapshots. Final validation runs inside the READ COMMITTED entry transaction after the awaited global resource lock, under the same owner-context lock as context mutations. It uses only the supplied transaction queue. A stale selection rolls back before the entered transition or provider-entry audit, then existing safe reserved-only cleanup releases it. The linearization cutoff is commit of the validated durable claim. Mutations committed before that claim invalidate stale context; changes after an accepted claim do not recall the request, even if remote dispatch is still pending. The picker invalidates send eligibility synchronously when selection changes; a new preview must complete before sending. Clear/refresh controls recover stale selections, and a project deletion may require reloading the conversation. No context text or selected IDs are added to cost/resource evidence.

Safe chosen limits: at most 100 memories per owner, 1,000 characters / 1,800 UTF-8 bytes each; 30 projects per owner, 80-character name and instructions up to 2,000 characters / 3,000 UTF-8 bytes; eight explicitly selected memories per request. Combined base/project/memory instructions have a 4,500 JSON-encoded-byte ceiling. Instructions and recent text share the existing 12,000-byte total context bound, at most 12 recent messages, conservative 16,384 input-token ceiling and 512 output tokens. Oldest messages may be dropped; selected instructions/memories are never silently removed. This is a conservative byte budget, not an exact tokenizer measurement. Existing worst-case reservations and provider bounds remain intact for platform funding and isolated BYOK.

Editing or deleting a selected memory invalidates its preview. A fresh subsequent request omits deleted content. Deletion does not recall already-entered provider requests or remove facts repeated in earlier saved prompts/answers. Providers retain their own independent policies. Owned account export now includes memories/projects and conversation grouping, without exporting keys or anonymous actor identities.

## Temporary content and accounting

`/chat/temporary` uses the real shared chat UI and inference route with explicit temporary mode. It bypasses `prepareRun`/`finishRun` entirely. No chat, message, branch, run, title, personal usage record, history entry, memory, or transcript export is created. Temporary IDs cannot reopen any persisted chat; saved branch anchors/edit/regenerate/retry requests are rejected. Caller-supplied transient history is accepted only in temporary mode. The client retransmits only up to 11 preceding user/assistant text turns, excluding system/reasoning/file/source parts and the current prompt (which travels once as `message`). There is no localStorage/sessionStorage transcript persistence, automatic resume, saved-history reload or history-created event. `data-conversation-mode="temporary"` exposes the eligibility boundary for subsequent UI integration.

Platform temporary requests retain the same durable reservations, idempotency, shared/daily/concurrency limits and conservative cancellation holds. Temporary accounting suppresses remote provider response IDs. Existing anonymous audit holds opaque request IDs, one-way digests, HMAC actor identity, numeric usage/cost/state/timestamps and fixed evidence, not prompt/answer/title/memory/project payload. Explicit BYOK uses only the owner's saved encrypted credential and its existing anonymous resource lease, without platform-money fallback. Context revocation rejected within the claim rolls back entry, safely releases the still-reserved reservation/lease and returns `context_changed`; unknown entered usage is never released by Stop, disconnect or account deletion.

The visible temporary disclosure distinguishes tab-local transcript, retained anonymous operations and independent provider processing/retention. Operator instructions forbid request-body/prompt/response/SDK-trace content logging. App guarantees do not imply provider or cloud log erasure, or control a user's own clipboard/browser copies.

## UI and local fixture

The existing semantic shell, Geist typography, controls, focus styles and responsive layout are extended without a broad redesign. New sidebar links reach temporary chat and Memory & projects. Native labeled inputs/selects, 16px mobile editing text, scrollable context/editor areas, 44px controls, pending-save guards, stable action labels with an actual-action-only spinner/aria-busy, explicit deletion confirmation and post-delete field focus support keyboard and touch use. Project and memory content is React-escaped text. The installed SDK's current `throttle` option replaces the inherited deprecated spelling in the touched signed-in chat.

Development-only `/preview/ui?context=1` reuses production ContextManager/ContextPicker with an explicitly injected in-memory client. It supports local CRUD and selection inspection without auth, database or provider calls, is linked in the existing responsive landing workbench, and stays behind both development runtime and `F04_UI_HARNESS=1`. It is not an authentication bypass or live availability claim. Root owns independent browser/physical-device/accessibility review. This worker started no browser/dev/production server and claims no screenshot, auditory screen-reader, contrast-ratio or physical mobile pass.

## Verification

Read the installed Next 16.4.2 route-handler/server-client guides and AI SDK 7.0.143 bundled generation/chat docs/source before integration. Used the repository AI SDK and existing frontend/mobile design guidance, preserving the established shell and funding boundaries.

All SQL, full tests, standalone typecheck and build commands were serialized through the shared local check lock; portable operator instructions use ordinary repository commands and do not depend on that local wrapper. Tests retain the default five-second deadline. Every query after PGlite socket start uses the captured application's postgres.js max:1 driver. Rejection assertions use native-await `rejectionOf`; no direct engine polling races or weakened assertions/timeouts were introduced.

- Final `bun test`: **113 passed, 0 failed, 1,111 assertions across 15 files, 61.68s**.
- Focused F09 integration/UI run: **15 passed, 0 failed, 233 assertions, 13.30s**.
- Final `bun run typecheck`: passed.
- Final `bun run lint`: passed, **236 files**.
- `bun run f01:integrity`: passed.
- Final credential-free `bun run build`: passed, including TypeScript and dynamic `/api/context`, `/chat/context`, `/chat/temporary` routes.
- `git diff --check`: passed.

New real-SQL/signed-session/installed-SDK cases cover exact selected payloads, unselected exclusion, cross-owner/project denials, edit/delete invalidation, fresh-prompt deletion exclusion, project grouping/deletion, composite constraints/RLS/account cascade, unauthenticated/uninvited/foreign-origin denial, temporary empty history/export/content tables, funded and BYOK accounting isolation, shared daily limits, pre-entry context revocation and unknown cancellation holds. UI regressions cover escaped selected content and faithful budget disclosure plus temporary text-only history bounds. Existing guest, immutable audit, ownership, keys, branches, shutdown, recovery and provider-diagnostic regressions remain green. Synthetic SSE only; no remote provider endpoint was contacted.

Live OAuth/invites, real provider prices/receipts/cancellation, hosted database/runtime concurrency, provider/cloud retention and backups, deployed rollback, physical-device and assistive-technology acceptance remain pending. F09 local implementation and passing checks do not authorize or establish public beta launch.

## Narrow Next route-export correction

Root's later Webpack generated-route validation found a pre-existing custom `authRouteHandlers` export in `app/api/auth/[...all]/route.ts`. Following the installed Next 16.4.2 route-handler API, the helper and its unconfigured response were moved unchanged into `lib/auth/route-handlers.ts`. The actual route still uses the same dispatch/catch behavior and now exports only GET/POST; the existing auth regression imports the helper from its new location. No feature or authentication behavior was added or changed.

After this extraction, serialized checks passed: focused auth regression **1 test / 4 assertions / 102ms**, lint **236 files**, standalone typecheck, `git diff --check`, and credential-free **`bun run build --webpack`**, including generated route validation, TypeScript, all 22 generated pages and final build traces. The earlier 108-test full-suite result predated only this narrow helper extraction; the final 113-test review-fix run includes it. No server was started. All checks/build processes finished before releasing the writer to root.

Root pinned the initial source and helper extraction as commit `4b9e482` before the subsequent independent review findings below.

## Independent-review corrections

Spec P2: the initial context recheck ran before an awaited resource-entry operation. An edit/deletion could commit while entry waited for its global lock, then stale instructions could dispatch. Both stores now accept `validateEntry(tx: DatabaseTransaction)`, called after their global advisory lock within the existing explicit READ COMMITTED transaction, before any entered update/audit. `validateContextEntry` acquires the same owner-context advisory lock as memory/project mutations and resolves through that provided transaction. Account cascades also take the owner-context lock after the BYOK-global lock. Failure rolls back the claim, leaving the record reserved; the unchanged reserved-only pre-entry cleanup releases zero-cost funding or the unused BYOK lease. No authority to release uncertain entered/held work was added.

The accepted validated-claim commit is the documented cutoff. Mutations committed before the claim invalidate stale selections, including while entry was waiting. A mutation after an accepted claim cannot recall that request, even while SDK/network dispatch is pending. `prepareProvider` is a distinct reserved pre-claim hook for bounded async private-payload I/O; final validation follows all preparation and the global-lock wait. Validators must use the supplied tx with no pooled-driver reentry, nested transaction or network access. `DatabaseTransaction` and `EntryValidation` are exported from `lib/db/client.ts` for subsequent owned attachment validation. F10 received these exact hooks/types and lock ordering; F09 did not integrate attachment/artifact behavior.

Four regressions deterministically gate the real store's awaited entry boundary, commit a real memory edit/delete through the captured app driver, then release entry for both platform and OpenRouter BYOK. They assert zero installed-SDK outbound calls, `context_changed`, released records, zero charged/incurred funding and no provider-entered audit (or no platform credit rows for BYOK). Validation uses the real entry tx; pool reentry would deadlock the max:1 fixture and fail the unchanged default timeout. A fifth regression establishes the successful accepted-claim cutoff: a later project edit does not recall the already accepted request. The deterministic gate models lock waiting; actual parallel multibackend advisory-lock contention remains a hosted acceptance task, not a PGlite claim.

Standards P3: ContextManager tracks the actual pending action, keeps the idle Save memory / Save project / Delete action labels, reserves spinner space and supplies spinner plus `aria-busy` only on that action. Other controls remain disabled behind the existing duplicate-action guard. The shared pending state no longer changes both Save labels or marks an unrelated action busy. Deletion copy also explains that accepted requests may finish.

Final verification after both corrections: focused F09 **15 tests / 233 assertions / 13.30s**; full suite **113 tests / 1,111 assertions / 61.68s**; standalone typecheck; lint **236 files**; credential-free **`bun run build --webpack`** including strict generated-route validation, TypeScript, all 22 pages and final traces; `git diff --check`. All passed. Checks were serialized through the shared host lock, default five-second test timeouts and native-await rejection assertions retained. This worker started no server and made no live/provider/cloud request, commit or push. Source remained frozen during final full-suite/build; only this evidence update followed. Root owns the fix commit and independent re-review.

## Changed files

- `app/(chat)/api/chat/route.ts`
- `app/(chat)/api/context/route.ts`
- `app/(chat)/chat/[id]/page.tsx`
- `app/(chat)/chat/context/page.tsx`
- `app/(chat)/chat/page.tsx`
- `app/(chat)/chat/temporary/page.tsx`
- `app/api/auth/[...all]/route.ts`
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
- `lib/auth/route-handlers.ts`
- `lib/byok/service.ts`
- `lib/byok/store.ts`
- `lib/context/client.ts`
- `lib/context/contract.ts`
- `lib/context/service.ts`
- `lib/context/transient.ts`
- `lib/credits/service.ts`
- `lib/credits/store.ts`
- `lib/db/client.ts`
- `lib/db/schema.ts`
- `lib/schema/chat/chat.ts`
- `lib/types/index.ts`
- `tests/f03-auth-route.test.ts`
- `tests/f03.integration.test.ts`
- `tests/f09-ui.test.tsx`
- `tests/f09.integration.test.ts`
