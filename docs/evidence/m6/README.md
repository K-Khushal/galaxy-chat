# M6 verification

`tests/manual/attachments-browser.ts` drives the real composer and chat UI in
Chromium (Playwright) against the same isolated harness M4 used: PGlite,
in-memory Redis and the AI SDK mock model on port 3100, with
`bun run dev` on port 3000. Storage is in memory, but the harness hands out
URLs on port 3100 and answers CORS preflight like a configured R2 bucket, so
the browser performs a real cross-origin PUT with upload progress. No R2,
OpenRouter or other network call is made; the Reply text is the mock's.

```sh
bun run dev
bun tests/manual/attachments-browser.ts
```

The run, in light at 1280 × 900 and dark at 390 × 900:

- opens the "+" menu, picks a PNG and a PDF, and sees the progress bars and a
  disabled Send while they upload;
- sends, and asserts the model's prompt contained a read URL for **both** files
  (`image/png` and `application/pdf`: the default model reads PDFs directly);
- sees the thumbnail and PDF chip on the User Message, opens the thumbnail
  larger and closes it with Escape, reloads and still sees both;
- tries a file over 10 MB and an `.exe` (refused in the composer with plain
  copy) and pastes a file;
- deletes the Chat and asserts both objects are gone from storage.

Screenshots: `light-1280-menu`, `light-1280-uploading`, `light-1280-sent`,
`light-1280-larger`, `dark-390-sent`.

What this does not cover: a real R2 bucket and a real provider reading the
files. Both need the owner's credentials (see "Attachments (R2)" in the root
README).
