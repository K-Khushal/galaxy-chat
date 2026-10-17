# F09 independent review

Fixed feature baseline: `6f256aa2183a19d0252d191dc5ac58c566f51124`. Initial source `4b9e482`; accepted correction `7883aae64eae4aad6e75e924795e63e42d26abb5`. Ancestry merge `aa832b885dba50d379e21936833d606050554163` includes merged beta main without source changes.

## Spec and security

Independent spec review initially found a P2 race: context validation preceded an awaited durable entry lock, allowing edits/deletion during that wait. The correction validates inside the existing READ COMMITTED entry transaction after the global resource lock and under the owner context lock. All context reads use that transaction, not a nested pooled query. Stale validation rolls back before entry state/audit; existing reserved-only release remains safe. Entered/held unknown spending is never refunded by this change. Preparation including later attachment I/O precedes validation. Account deletion follows BYOK-resource then owner-context lock order.

The spec reviewer independently re-read and accepted the correction. Four real-store blocked-entry edit/delete cases across funded/BYOK assert zero outbound requests and safe released reservations; an accepted-claim test establishes the cutoff. Edits after the validated claim commits cannot recall accepted work. No remaining spec/security finding. Explicit-only CRUD, owned grouping, exact bounded selection, temporary no-content persistence and funding isolation match the ticket.

## Standards

The standards reviewer initially found P3 pending controls violated `docs/system/button.md` by changing idle labels and lacking spinners. Corrected controls retain labels, show `aria-busy` and reserved spinner space on the submitted action, and disable peers. Independent re-review accepted; no remaining hard finding. Duplicated limit disclosure values were noted as an optional maintenance improvement, not a blocker. The inherited auth-route helper was moved outside the Next route, preserving GET/POST behavior while passing strict generated route validation.

## Root verification

Independent command: `bun test tests/f09.integration.test.ts tests/f09-ui.test.tsx tests/f03-auth-route.test.ts` — **16 passed, 237 assertions, 23.53s**, default deadlines unchanged. Real migrated local SQL, signed sessions and installed SDK use synthetic provider responses only. Covers the four races, accepted cutoff, exact selected context, auth/origin/ownership, project/cascade and temporary persistence/accounting/cancellation boundaries. Worker final full suite: **113 passed, 1,111 assertions**, plus lint236/typecheck/integrity/diff and strict credential-free Webpack production build including generated route types.

Root used the real Next development server and CUA/IAB desktop viewport1280x720, with the visibly labeled injected local production-component fixture. Verified memory create/edit/save/delete, inert literal markup, delete confirmation with focus returned to the memory field, project creation, explicit opt-in selection, exact project instructions/selected memory text, no automatic memory inclusion, and reachable inner context/budget scrolling. The real390px iframe was inspected in light/dark themes; controls and disclosure remained contained and reachable. Screenshots: `/private/tmp/galaxy-f09-desktop-context.png`, `/private/tmp/galaxy-f09-phone-light.png`, `/private/tmp/galaxy-f09-phone-dark.png`. No real auth/database/provider call occurred through the UI fixture. Root server3073 stopped before further heavy checks.

Browser evidence is desktop emulation, not physical-mobile, contrast-ratio or screen-reader proof. Live OAuth, real provider receipts/cancellation, independent hosted backends/lock contention, cloud retention/backup/runtime/budget remain pending. This local feature does not open the public beta.
