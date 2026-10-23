# F12-C private images: offline implementation evidence

Application source: `d43e84949266db4584effbe2a0e19f4377c58902`.
Final test-only followup: `c9c2afb359753397407e7acc9ba62fbd66da59d8`, based on merged main
`4d5a1e84119db256001d778712584f4645bb5157`, branch `codex/f12-images`.

One default-off OpenRouter BYOK generation adapter is implemented. No reviewed live
model, endpoint or price is seeded. Editing and masks fail closed. This is offline
implementation evidence; independent review, browser fixture validation, and all
live acceptance gates remain separate.

## Implemented contract

- Strict one-snapshot configuration and complete-snapshot binding after awaited locks;
  exact credential revision, origin, artifact head, ceiling and acknowledgement.
- One provider call/output; exact endpoint/provider routing, fallback/retry disabled;
  60-second combined abort; streamed/declared body cancellation and base64 bounds.
- CRC/chunk/pixel and bounded-inflate checks before fast-png decode; non-animated,
  metadata-free canonical 1024×1024 PNG, 4 MiB maximum, stable SHA-256.
- Atomic BYOK plus private-capacity/transfer reservations; shared F10 object/byte/
  processing/tombstone liability; pending image slots count against ordinary artifacts.
- Immutable image revisions and owned shared-object restore; explicit-revision private
  downloads validate digest/length and charge transfer before reading storage.
- Unknown provider/upload outcomes remain held; pre-entry failure releases capacity;
  durable tombstones survive deletion and repeat after terminal late-write proof.
- Account export metadata/provenance, account/chat/message/artifact cascade cleanup,
  anonymous resource holds, fixed-id error logging, default-off controls and disclosures.

Deletion and artifact mutation use BYOK → attachment → owner/cascade lock order so
image final entry and cascaded state transitions cannot invert those resource locks.
Image lifecycle tests create fresh fixtures in bounded 15-second setup hooks; the
behavior tests retain the default five-second deadline. The populated migration test
runs the real migration runner over 0010 data, adds 0013 despite absent 0011/0012,
reruns idempotently, and verifies retained history, RLS, grants, and migration records.

## Checks

- Focused image/PNG/UI/integration: **26 pass, 0 fail, 254 assertions, 20.85 s**.
- Strict types: passed (`bun run typecheck`, incremental disabled).
- Repository lint: passed, 321 files.
- Final full suite: **223 pass, 1 inherited native-Postgres skip, 0 fail,
  3,292 assertions, 204.09 s** across 35 files.
- Next 16.4.2 Webpack production build: passed, including strict TypeScript
  and all 27 page-generation jobs. Used `NEXT_PRIVATE_STANDALONE=true`.
- OpenNext local packaging: passed with `--skipNextBuild` over that exact
  standalone Webpack output. This is local packaging, not a deployment.
- Fresh offline workerd canonicalization: passed, **6,380 bytes**, SHA-256
  `9a3a5548fd49d9d0266e03ea5f549b5aa27d3f7dbbe13a70f4471210335d81ed`,
  identical to Bun. The local server was stopped and its temporary config removed.

During recovery, TypeScript exposed the recent-status control using the current
request id instead of its selected recent id; a DOM regression now proves the fix.
Expanded tests exposed malformed provenance UI rendering and an incorrectly budgeted
fixture assumption about retained tombstones; both were corrected before source freeze.

The first full run had 221 pass, one inherited skip, and one failure because an F10
storage assertion still expected `redirect:"error"`. The production adapter already
used Workers-compatible `manual` redirects with explicit rejection/cancellation.
The test-only followup corrects that expectation and adds real 3xx cancellation proof
for private check, upload, delete, signing, and signed-download paths: **12 pass,
181 assertions, 9.28 s**. The final full rerun above includes this correction.

The final-check batch passed types/lint/integrity/Webpack/OpenNext, then its fresh
Worker replay initially failed before startup because Wrangler misresolved a temporary
config outside the project. A second outside-project relative-config attempt also
failed before startup. Placing the temporary config beside the project tsconfig
reproduced the prior working harness and passed; no app source changed. Existing
OpenNext warnings about the old compatibility date and upstream BetterAuth bundled
code remain; no build warning was suppressed.

Host-heavy work used `/private/tmp/galaxy-run-check.py` and its shared fcntl lock.
Detailed local logs: `/private/tmp/galaxy-f12c-full-final.log`,
`galaxy-f12c-{types,lint,integrity,webpack,opennext}.log`, and
`galaxy-f12c-workerd-final.log` / `galaxy-f12c-worker-runtime.log`.

## Review and live limits

The development-only `/preview/images` fixture supports explicit generation, held
state, new revisions, restore, deletion, theme switching and disabled downloads. It
uses placeholders and fictitious prices and cannot prove provider output, billing,
private storage, egress, or browser download behavior. Independent desktop and
390-pixel light/dark browser review is pending at handoff.

Before activation, verify the exact selected model/endpoint, all-in prices/fees,
provider budget/max-price behavior, abort/terminal receipts, and hosted private
storage/cleanup/egress/authenticated downloads. No paid image call, provider login,
provisioning, billing change, deployment, GitHub action, PR, or merge was performed.
The original user checkout was preserved.

## Integrated review and final fixture verification — October 23

Integrated reviewed main `0931f08` (search and MCP broker). Independent spec and standards reviews cleared `0f741ee`: migration 0013 preserves search kinds and populated 0011/0012 operation states, actor keys, reservations, receipts and settled amounts; actual SearchStore regression isolates existing held-liability actor/global money caps. The hourly request assertion also meets a concurrency limit and is not independent proof of the hourly gate.

Root full checks on `0f741ee`: standalone Node22 broker 27 pass; app 253 pass, 1 inherited native-Postgres skip, 0 fail, 3,580 assertions; typecheck, lint, integrity and strict Webpack build pass. An adapter check using skipNextBuild failed because an ordinary Next build lacks the adapter's standalone outputs. A subsequent full OpenNext build under Node22 passed, including its own Next build and worker bundling. No generated manifest was fabricated or check bypassed.

Root browser review found the fixture's direct composer catalog omitted the required review digest. The production component correctly stayed disabled. Correction `874fba3` adds the same digest used by its fake catalog; an actual ImageFixture regression covers consent enabling generation, held outcome without a revision, and a subsequent explicit successful fixture action. Independent UI checks: 5 pass, 45 assertions; final types and lint pass. Prior full-suite/build results precede this two-file fixture-only correction; hosted CI must check the final PR head.

CUA checked desktop and 390×844 light/dark fixture layouts: explicit payer/ceiling/unsupported-editing disclosures, consent gate, held status with no automatic retry, revision editor and provenance. Local screenshot evidence: `/private/tmp/galaxy-image-phone-dark-held.png`, `/private/tmp/galaxy-image-phone-light-revision.png`, `/private/tmp/galaxy-image-desktop-revision.png`. Download remains disabled in the development fixture; no provider output, storage proof, browser download, live receipt or paid request is claimed. Temporary server stopped and viewport override reset.

Live provider/pricing/receipt, Supabase permissions, runtime capacity, budget and deployment acceptance remain pending. Advanced image generation remains off by default. Editing and masks remain denied without a verified adapter.
