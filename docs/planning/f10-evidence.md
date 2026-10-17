# F10 private attachments — implementation evidence

Status: private storage, extraction, owned API, shared chat/context/provider integration, account export/deletion, and composer implemented locally. F09 explicit context and its atomic provider-claim fix are inherited. This is not public-beta, hosted-storage, hosted-CI, deployment, or paid-inference evidence.

## Implemented boundary

- Migration `0006_attachments.sql` is independent of migration 0005. Better Auth ownership remains server checked. All attachment metadata, delete jobs, transfer accounting, and reconciliation records have RLS enabled and no browser policies/grants. Storage bucket privacy is checked against the actual Supabase bucket API before upload/read/delete work.
- `/api/attachments` accepts a saved owned conversation and raw file bytes. It never accepts arbitrary URLs, object paths, user ids, public storage links, or browser provider options. Invited session and same-origin mutation checks precede service work. Guest APIs never call this service. Temporary attachment context is explicitly denied.
- Supported inputs: UTF-8 text and Markdown (128 KiB), PDF and PNG/JPEG/WebP (2 MiB), at most 12 PDF pages, 24,000 extracted characters, image dimensions at most 4,096 per side / 4 million pixels. HTML, SVG, executable formats, mismatched signatures and invalid text are rejected. Files are never displayed in an iframe or injected as HTML. Markdown is source text rather than executed MDX.
- PDF extraction uses pinned `unpdf@1.9.0`, its serverless Mozilla PDF.js 6.4.299 build, and streamed page text. It does not create a viewer, render, run scripts, follow document links, load remote fonts/CMaps, or run OCR. Image-only scans return a clear no-text/no-OCR error. Password-protected or malformed PDFs fail closed.
- PDF extraction has a 10-second abort deadline and upload/body processing uses a 45-second abort budget; each storage network call has a 20-second deadline. Opportunistic cleanup is separate bounded maintenance (at most five jobs on upload; operator/post-cascade calls at most twenty). PDF.js runs on the isolate event loop: a timer cannot preempt a synchronous CPU/memory spike. Hosted isolate CPU/memory enforcement and hostile-document load testing remain deployment gates. Byte/page/text/pixel checks are real limits, not a claim of hard process isolation.
- Upload metadata/quota is reserved transactionally before reading the request body. The platform maximum is 100 MiB, each user at most 20 MiB and 20 records, platform at most 1,000 records, and at most two global / one per-user processing lease. Explicit operator configuration can choose smaller limits. Capacity includes queued and unknown object liabilities, including after account cascades.
- Daily UTC transfer reservations cap upload, download, and model-image reads; each operation reserves at least 64 KiB to bound tiny-file/request amplification. Maximum configurable cap is 100 MiB/day. A zero-to-ten-dollar operating target still requires operator review of database, storage, transfer, request, and infrastructure costs. No free-plan allowance is assumed or guaranteed. Attachments default unavailable with all capacity settings blank.
- Downloads first check ownership, reserve transfer bytes, obtain a 60-second signed URL internally, verify origin/path and content hash, and proxy bytes with `attachment`, `application/octet-stream`, `nosniff`, sandbox CSP, and `private, no-store`. Signed URLs and server credentials are never returned to the browser/model or logged. Redirects are rejected. The model receives reviewed image bytes rather than a storage URL.

## Shared context and provider boundary

`/api/context` keeps F09’s selection/digest contract and accepts an optional attachment preview selection `{ chatId, ids, model, funding }`. It returns the exact owned excerpts, provenance, attachment digest, and conservative input estimate. `/api/chat` accepts `{ ids, digest }` separately from memory selection. At most three distinct ids are accepted; they must belong to the caller and the same saved chat and remain ready. Guest files and temporary-chat files are explicitly unavailable. Empty selection never constructs a storage service, so ordinary text chat works with attachments disabled and no secrets.

`buildAttachmentContext` returns text/file content, source provenance/excerpts, digest, text/image token estimates, and a fixed untrusted-data instruction. Source fingerprints include id, filename, pages, kind, media type, byte count, bucket, content hash, and extracted text. Text excerpts are JSON-encoded user data; only the fixed data guard joins instructions. F09 instruction bounds (4,500 encoded bytes), existing text bounds (12,000 encoded bytes), and 16,384 conservative total input tokens include the selected data and guard once. Earlier turns can be dropped to fit; the current prompt and selected excerpts cannot silently be truncated. No automatic OCR or additional model call occurs.

Images require a server-reviewed `{ images: { verified: true, mediaTypes, maxTokensPerImage } }` capability with a conservative 4,096–16,384 token bound per image. The default funded and BYOK catalogs remain text-only; funded images are denied. A reviewed BYOK capability creates real current AI SDK `file` parts containing checked private image bytes. Unsupported selection fails before image loading, chat-run creation, resource reservation, or provider calls. No storage URL reaches the SDK. A synthetic reviewed capability exercises actual AI SDK/OpenRouter inline `data:image/png` serialization against mocked network; it does not enable a live model or spending.

Provider entry reuses the F09 phase contract: private image I/O finishes while the BYOK resource reservation is held, before entry; the durable entry transaction acquires the resource global lock, then the context owner lock, then the attachment lock. Both context and file resolvers use the supplied transaction queue. The final owned ready/digest/capability checks run after the awaited entry lock and before the entered-state/audit claim. Claim commit is the authorization cutoff. A deletion or edit committed while entry waits rolls back the claim and releases only a never-dispatched reservation. There is no new entered-state refund path. Unknown provider holds retain existing accounting semantics. No storage network I/O runs inside or after the final claim transaction.

The production composer supports upload/cancellation/deletion, explicit selected files, exact escaped excerpt/provenance preview, unsupported-image guidance, loading/error states, and readiness gating for send/retry. Server-authored safe source metadata is saved on the user message and shown on reload; extracted text/image bytes are not copied into the saved message. Providers cannot author application data parts. Deleting a file does not rewrite old source references in saved messages. Account export includes owned metadata/extracted text without object keys, signed URLs, or credentials. Attachment/chat/account deletion queues durable private cleanup and attempts bounded post-transaction cleanup; deletion never claims unknown writes have stopped.

`/preview/ui?attachments=1` uses the same production composer/picker with an injected in-memory client. It is guarded by the existing development-only `F04_UI_HARNESS=1` switch. Its visible label explains that it has no authentication, database, private storage, or provider requests. The fixture covers text-only versus explicitly approved image selection, hostile escaped excerpts and source names, loading/unavailable responses, local Blob downloads, and delayed text/Markdown uploads/cancellation/deletion. It deliberately does not simulate PDF extraction, image validation, backend authorization, or billing acceptance. Browser review remains separate from SQL/backend evidence.

## Durable deletion and unknown writes

Upload state is `reserved → entered → terminal`. The transition to `entered` is a compare-and-set immediately before any remote write; a deleted/cancelled reservation cannot begin an upload. Successful storage completion marks the row or its surviving deletion job terminal, including if the account disappeared while the write was running. Failures before remote entry are safe terminal no-writes.

Deleting an attachment/chat/account creates a durable job without a foreign key. It contains a SHA-256 owner prefix/object id, bucket, bytes, upload state, and retry time; it contains no filename or extracted plaintext. Known terminal and never-entered writes release capacity only after storage confirms removal. Expired processing is queued, never blindly discarded.

An entered write with a timeout, abort, or unknown result stays charged against capacity indefinitely. Five minutes is the retry cadence/grace, not terminal proof. Successful deletion does not release an unknown upload. A late terminal callback racing a delete requires another deletion after the callback; quota cannot be released retroactively. Local tests cover a late write after a successful delete, account cascade, and a terminal callback/deletion race.

Run cleanup from the repository on an operator-controlled runtime with the same private bucket:

```sh
bun run attachments:cleanup
```

It processes at most 20 eligible jobs and reports only counts. Schedule it in the hosting environment at least every five minutes before enabling uploads; no public cleanup endpoint or cloud automation is provisioned here. It remains operable while uploads are disabled and retries failed deletes. Keep old bucket credentials available until its queue drains; changing the configured bucket cannot delete jobs in an old bucket.

Unknown writes require provider-supported terminal/bounded-write evidence or explicit operator reconciliation. Retain the exact evidence in operator records and pass its SHA-256 only after establishing that no remote write can still land:

```sh
bun run attachments:reconcile '<anonymous-object-key>' '<evidence-sha256>' --provider-upload-is-terminal
bun run attachments:cleanup
```

The command records a write-once association to the evidence hash and makes the job eligible for a post-terminal delete. A timeout, elapsed lease, successful delete, or user account deletion alone is insufficient evidence. No HTTP route calls reconciliation. Capacity exhaustion due to unresolved writes deliberately leaves further uploads unavailable until reconciliation.

## Local verification

Repository-portable commands (run sequentially):

```sh
bun test tests/f09.integration.test.ts tests/f10-attachments.test.tsx tests/f10.integration.test.tsx tests/f10-attachment-ui.test.tsx
bun run lint
bun run typecheck
bun test
bun run build --webpack
```

The current collaboration serializes SQL/tests/typecheck/build with a machine-local lock wrapper; that wrapper is not a repository dependency. SQL fixtures apply all migrations to real PGlite, then route all queries through the captured application postgres.js max:1 queue. Rejections use native await so the same-process socket makes progress. Tests use local fixture bytes and mocked external network; they make no live storage, OCR, or paid model requests.

Initial integrated checkpoint checks (2026-10-17; final reviewed follow-up below):

- Initial focused F09/F10 integration: 30 passed, zero failed, 442 assertions across three files (30.90 seconds).
- Full combined suite at source checkpoint `cfbc2ad27797ec0e99c52135ae1062366a9b5e8d`: 132 passed, zero failed, 1,356 assertions across 17 files (83.56 seconds). Includes F09 memory claim-race regressions and F10 funded-text/BYOK-image file deletion after preparation while entry waits.
- Focused F10 route/inference tests at that checkpoint: eight passed, zero failed, 93 assertions (12.09 seconds).
- `bun run lint`: passed, 257 files checked after the local preview and claim-race tests.
- `bun run typecheck` (no incremental state): passed on that integrated checkpoint.
- `bun run build --webpack`: passed at checkpoint `cfbc2ad`; Next 16.4.2 compiled in 30.5 seconds, completed its generated-route TypeScript phase in 14.9 seconds, and generated all 23 static pages. `/api/attachments`, `/api/context`, `/api/chat`, and development preview routes emitted successfully.
- The development landing-workbench option for `/preview/ui?attachments=1` was added after that initial build, exposing the existing 390-pixel iframe. Subsequent lint passed (257 files); existing preview-gate/composer tests passed (10 tests, 49 assertions, 166 ms). The final follow-up build below includes both this selector and the reviewed pending-action fix. Harness gates do not substitute for browser interaction or backend acceptance.
- Foundation baseline (before shared integration): 109 tests / 1,030 assertions passed, normal Next 16.4.2/Turbopack production build passed. This historical baseline does not substitute for final combined checks.
- Vendor integrity: passed. Final `git diff --check`: passed.
- Operator commands without configuration/terminal-proof confirmation: expected exit 1, redacted stable error identifiers only; no network reached.

Hosted private bucket access/policy proof, scheduled cleanup provisioning, hostile PDF isolate resource/load checks, reviewed live image model bounds, real-phone interaction, browser review, hosted CI and deployment remain gates. Attachments must remain disabled until the applicable operational checks are satisfied. No free-plan cost guarantee is made.

## Reviewed pending-action follow-up

The independent standards review found that repeated delete clicks could issue duplicate DELETE/cleanup requests and completions could restore stale selected ids. The picker now serializes uploads/deletes with synchronous duplicate guards, identifies the pending delete, blocks send during mutation, and applies selection changes through functional updates in the production composer. A delete completion removes its id from the current selection. Upload completion consults the current image capability. Add file and Delete retain their action labels and expose a spinner plus `aria-busy`, following `docs/system/button.md`; Cancel upload remains usable.

`tests/f10-attachment-ui.test.tsx` mounts the real production composer and picker in pinned dev-only `happy-dom@21.0.3`, using deferred injected client promises. It exercises same-tick A/A/B delete clicks, selection/model changes while A deletion waits, unsupported-image gating, serial B deletion and restored send readiness. It also covers the upload busy label/spinner, a model change before image completion, and cancellation. No test timeout was raised. DOM globals are narrowly installed and restored, and windows/root state are closed after each test. This is component interaction evidence, not browser security, storage authorization, or provider acceptance proof.

Final checks on pinned source `592d04b43dd557e5c10713c1d3fede82d1cd2eb7` (only this evidence update follows):

- Focused DOM regressions: two tests, 35 assertions (662 ms), no failures.
- Full suite: 134 passed, zero failed, 1,391 assertions across 18 files (84.28 seconds). SQL/SDK tests after the DOM tests also passed with restored globals.
- Strict nonincremental typecheck: passed.
- Full lint: passed, 258 files checked.
- `bun run build --webpack`: passed; Next 16.4.2 compile 13.1 seconds, generated-route TypeScript 11.0 seconds, all 23 static pages generated in 801 ms; route generation and build tracing completed.
- Vendor integrity and final `git diff --check`: passed.

The earlier `cfbc2ad` results remain historical evidence for that checkpoint. Browser interaction and operational gates remain separate; no claim of hosted acceptance or live storage/provider behavior follows from these local checks.

## Primary API references checked

- Installed Next 16.4.2 route-handler guide at `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md`.
- Installed AI SDK 7.0.143 prompt docs/types at `node_modules/ai/docs/02-foundations/03-prompts.mdx` and its provider-utils file-part type.
- [Supabase private downloads](https://supabase.com/docs/guides/storage/serving/downloads) and [official StorageFileApi REST implementation](https://github.com/supabase/storage-js/blob/master/src/packages/StorageFileApi.ts).
- [Bun official DOM test guide](https://bun.sh/guides/test/happy-dom) and installed Happy DOM 21.0.3 Window types for the dev-only component regression runtime.
- [unpdf official documentation, including untrusted PDF resource caveats](https://github.com/unjs/unpdf) and [PDF.js API documentation](https://mozilla.github.io/pdf.js/api/draft/module-pdfjsLib.html).

## Principal changed modules

- `.env.example`, `package.json`, `bun.lock`: fail-closed storage/capacity and reviewed image capability configuration, pinned parser, operator commands.
- `drizzle/0006_attachments.sql`: owned records, durable deletion/capacity liability, transfer reservations, reconciliation evidence; migration manifest preserves F09 0005 and F10 0006.
- `lib/attachments/`: content/extraction, Supabase REST, ownership/quota store, service, request/context/model payload, HTTP/client boundaries.
- `app/(chat)/api/{attachments,context,chat}/route.ts`, shared context/schema/types/chat/account actions and BYOK service: owned preview, bounded request, final transactional claim, provenance, export and cascade cleanup.
- `components/chat/{attachment-picker,attachment-composer,chat,chat-input,chat-messages}.tsx`: production selection and disclosure flow. `components/preview/attachment-preview.tsx` plus the existing preview route: labeled local review fixture.
- Help/privacy/account/error copy: explicit limits, model data sharing, disabled guest/temporary files, asynchronous deletion and unknown-write reconciliation.
- `scripts/attachments-{cleanup,reconcile}.ts`: bounded operator-only maintenance.
- `tests/f10-attachments.test.tsx`, `tests/f10.integration.test.tsx`, `tests/helpers/attachment-{fixture,http-fixture}.ts`: real local bytes, SQL, route, SDK and provider-entry race evidence.

No GitHub, push, remote merge, live provider, cloud login/provisioning, deployment, or browser-session action was performed by this implementation agent.
