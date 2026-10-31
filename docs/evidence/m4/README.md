# M4 verification

The UI uses M3's AI SDK mock provider through `tests/manual/chat-browser.ts`.
No provider calls, credentials, authentication bypasses or new environment
variables are needed. The script starts a local API harness (PGlite and
in-memory Redis) on port 3100 and uses Playwright network routing to connect
only its browser to it. `/design/chat` is an isolated shell available only in
development; production returns 404. The regular `/chat` and API authentication
remain unchanged.

Run in two terminals:

```sh
bun run dev
bun tests/manual/chat-browser.ts
```

The runner checks streaming, refresh replay, Stop and its label, regenerated
Reply Versions, edited User Message Versions, Interrupted Reply continuation, and model locks in light/dark at
1280 × 900 and 390 × 900, writing PNGs here. Escape closes the picker using the
Base UI dialog's keyboard handling. Component interaction tests cover Enter,
Shift+Enter, IME composition, empty messages, Stop, plain-text copy, regenerate,
Version boundaries, and inline editing/cancellation. They run in a subprocess
to isolate the DOM and React development runtime from server tests that load
Next.js in production mode.

Known API limitation: M3 does not persist reasoning duration. While observing
reasoning live the UI shows “Thought for Ns”; a freshly loaded saved Reply
shows “Thought process” rather than inventing a duration.

Review follow-up verification (rebased on M3 `82948dd`): the runner also checks
`no_credits`, `needs_byok_key`, 413 and generic errors, verifying the draft remains
and that only payment/key errors show the key action. Each viewport/theme includes
empty and Failed Reply screenshots. The Failed fixture has no text and was paid
with Credits; component tests also cover BYOK wording. Version screenshots hover
the controls, and picker screenshots wait 400ms for the open transition to settle.

Keyboard-only checks Tab to the composer, send with Enter, open inline editing
with Enter, Escape back to the Edit Message button, reach Reply actions and the
Version switcher with Tab, change Version with Enter, and close the picker with
Escape, restoring its trigger focus. The live region is empty on initial load
and announces Reply text when a Generation ends.

The runner additionally exercises a rejected first send after creating a Chat:
`galaxy:draft:new` and `galaxy:send:<id>` remain, the composer restores the text,
and a successful retry clears both records on server acceptance. Component/hook
regressions cover Credit/key errors, 413, network failure, busy refusal, pending
acceptance with newer typing, accepted headers before streaming ends, edit
rejection, focus restoration and Failed Replies. No real provider is called.
