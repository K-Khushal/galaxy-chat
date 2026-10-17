# F10 private attachments — implementation evidence

Status: private storage, extraction, API, context contract, and picker foundation implemented locally. Shared chat inference/context/account deletion integration is deliberately awaiting F09 coordination. This is not public-beta, hosted-storage, hosted-CI, deployment, or paid-inference evidence.

## Implemented boundary

- Migration `0006_attachments.sql` is independent of migration 0005. Better Auth ownership remains server checked. All attachment metadata, delete jobs, transfer accounting, and reconciliation records have RLS enabled and no browser policies/grants. Storage bucket privacy is checked against the actual Supabase bucket API before upload/read/delete work.
- `/api/attachments` accepts a saved owned conversation and raw file bytes. It never accepts arbitrary URLs, object paths, user ids, public storage links, or browser provider options. Invited session and same-origin mutation checks precede service work. Guest APIs never call this service. Temporary attachment context is explicitly denied.
- Supported inputs: UTF-8 text and Markdown (128 KiB), PDF and PNG/JPEG/WebP (2 MiB), at most 12 PDF pages, 24,000 extracted characters, image dimensions at most 4,096 per side / 4 million pixels. HTML, SVG, executable formats, mismatched signatures and invalid text are rejected. Files are never displayed in an iframe or injected as HTML. Markdown is source text rather than executed MDX.
- PDF extraction uses pinned `unpdf@1.9.0`, its serverless Mozilla PDF.js 6.4.299 build, and streamed page text. It does not create a viewer, render, run scripts, follow document links, load remote fonts/CMaps, or run OCR. Image-only scans return a clear no-text/no-OCR error. Password-protected or malformed PDFs fail closed.
- PDF extraction has a 10-second abort deadline and request work a 45-second deadline; storage network work has a 20-second deadline. PDF.js runs on the isolate event loop: a timer cannot preempt a synchronous CPU/memory spike. Hosted isolate CPU/memory enforcement and hostile-document load testing remain deployment gates. Byte/page/text/pixel checks are real limits, not a claim of hard process isolation.
- Upload metadata/quota is reserved transactionally before reading the request body. The platform maximum is 100 MiB, each user at most 20 MiB and 20 records, platform at most 1,000 records, and at most two global / one per-user processing lease. Explicit operator configuration can choose smaller limits. Capacity includes queued and unknown object liabilities, including after account cascades.
- Daily UTC transfer reservations cap upload, download, and model-image reads; each operation reserves at least 64 KiB to bound tiny-file/request amplification. Maximum configurable cap is 100 MiB/day. A zero-to-ten-dollar operating target still requires operator review of database, storage, transfer, request, and infrastructure costs. No free-plan allowance is assumed or guaranteed. Attachments default unavailable with all capacity settings blank.
- Downloads first check ownership, reserve transfer bytes, obtain a 60-second signed URL internally, verify origin/path and content hash, and proxy bytes with `attachment`, `application/octet-stream`, `nosniff`, sandbox CSP, and `private, no-store`. Signed URLs and server credentials are never returned to the browser/model or logged. Redirects are rejected. The model receives reviewed image bytes rather than a storage URL.

## Context/service contract for F09 integration

`buildAttachmentContext({ userId, chatId, attachmentIds, model, maxContextTokens, expectedDigest?, includeImageBytes?, temporary? }, service?)` returns `{ content, provenance, estimatedTokens, digest, instructions }`.

`content` uses current installed AI SDK `file` parts with image media type and raw bytes (the old `image` part is deprecated), plus JSON-encoded text parts labeled as untrusted source data. Source metadata includes attachment id, escaped filename, content hash, and PDF page labels. The system instruction explicitly rejects instructions found in file content. Callers must append these user content parts to the current message, include the returned instruction in the bounded instruction set, include the content/token estimate in funding/resource reservation and digest, and repeat the owned ready/hash/digest check immediately before provider entry.

Images require a server-reviewed `{ images: { verified: true, mediaTypes, maxTokensPerImage } }` capability, with an explicit conservative bound of 4,096–16,384 tokens per image. The default funded and BYOK catalogs are still text-only. Capability rejection occurs before image loading or provider calls. A synthetic capability test exercises actual AI SDK/OpenRouter serialization with a mocked network and proves inline `data:image/png` payloads. It does not enable a live model or spending.

For an empty attachment selection, callers must skip constructing the storage service so disabled storage cannot block ordinary text chat. Text estimates include UTF-8 bytes for source JSON and the untrusted-data instruction, intentionally conservative. Image bounds are added before image reads. No provider/OCR calls occur during extraction. At most three distinct attachment ids are accepted. The context digest rechecks the same owned extracted text and content hashes, and a changed/deleted attachment fails rather than silently using stale context.

`AttachmentPicker` is an accessible reusable saved-chat shell with native file selection, selected checkboxes, limits, cancellation, provenance metadata, download, and deletion. It has not yet been wired into the shared Chat composer pending F09. Mobile target sizes/overflow are implemented; real-phone/keyboard/browser interaction evidence remains outstanding.

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
bun test tests/f10-attachments.test.tsx
bun run lint
bun run typecheck
bun test
bun run build
```

The current collaboration serializes SQL/tests/typecheck/build with a machine-local lock wrapper; that wrapper is not a repository dependency. SQL fixtures apply all migrations to real PGlite, then route all queries through the captured application postgres.js max:1 queue. Rejections use native await so the same-process socket makes progress. Tests use local fixture bytes and mocked external network; they make no live storage, OCR, or paid model requests.

Latest foundation checks (2026-10-17):

- Focused F10 tests: 11 passed, 152 assertions (8.07 seconds).
- Full suite after updating the static migration-ledger expectation: 109 passed, zero failed, 1,030 assertions across 14 files (59.76 seconds). The first full run identified only that expected manifest update; migration application itself succeeded.
- `bun run lint`: passed, 237 files checked; final repeat passed after the manifest update.
- `bun run typecheck`: passed. Production build also completed its TypeScript phase against final source.
- `bun run build`: passed on Next 16.4.2/Turbopack; compile 16.0 seconds, TypeScript 11.4 seconds, all 22 static pages generated, `/api/attachments` emitted as a dynamic route.
- `git diff --check`: passed.
- Operator commands without configuration/terminal-proof confirmation: expected exit 1, redacted stable error identifiers only; no network reached.

 Shared inference integration, hosted storage access/policy proof, automatic scheduled cleanup provisioning, hostile PDF isolate resource checks, real-phone interaction, and hosted CI remain gates. Do not mark the whole F10 ticket complete from foundation evidence alone.

## Primary API references checked

- Installed Next 16.4.2 route-handler guide at `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md`.
- Installed AI SDK 7.0.143 prompt docs/types at `node_modules/ai/docs/02-foundations/03-prompts.mdx` and its provider-utils file-part type.
- [Supabase private downloads](https://supabase.com/docs/guides/storage/serving/downloads) and [official StorageFileApi REST implementation](https://github.com/supabase/storage-js/blob/master/src/packages/StorageFileApi.ts).
- [unpdf official documentation, including untrusted PDF resource caveats](https://github.com/unjs/unpdf) and [PDF.js API documentation](https://mozilla.github.io/pdf.js/api/draft/module-pdfjsLib.html).

## Changed foundation files

- `.env.example`, `package.json`, `bun.lock`: fail-closed configuration, pinned parser, operator commands.
- `drizzle/0006_attachments.sql`: owned records, durable deletion/capacity liability, transfer reservations, reconciliation evidence.
- `lib/attachments/{contract,config,content,extract,storage,store,service,context,http}.ts`: complete foundation boundaries.
- `app/(chat)/api/attachments/route.ts`: owned API exports.
- `components/chat/attachment-picker.tsx`: reusable UI shell, not yet composer integration.
- `scripts/attachments-{cleanup,reconcile}.ts`: bounded operator-only maintenance.
- `tests/f10-attachments.test.tsx`, `tests/helpers/attachment-fixture.ts`: real local bytes/SQL/SDK-adapter tests.
- `tests/f03.integration.test.ts`: expected migration ledger includes 0006; no assertion weakening.
- `docs/planning/f10-evidence.md`: evidence and remaining gates.

No GitHub, push, merge, live provider, cloud login/provisioning, deployment, or browser-session action was performed by this implementation agent.
