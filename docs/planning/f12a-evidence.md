# F12-A chart artifacts: local evidence

Date: 2026-10-17. Child #29 of parent #16. Base: merged attachment/artifact main `e4ec439eeb321c0a0f4ddf2aa32ce07326f2d6be`. Isolated managed checkout `/Users/khushal/.codex/worktrees/galaxy-artifacts/galaxy-chat`, branch `codex/f12-charts`. Final checked implementation source commit: `b46d37a33a7d955ac84426e0d391a3b9a1510724`. This document is the only subsequent change at writer handoff.

## Contract and storage

Chart artifacts extend the existing F11 store; there is no replacement store or attachment parser. `drizzle/0009_chart_artifacts.sql` expands only the existing artifact kind check to `markdown|html|chart`. It leaves immutable revision/origin triggers, composite owner/message foreign keys, deletion cascades, byte limits, RLS and browser-role revocations in place. Migration 0008 is reserved for F13 and is not part of this base. The fresh migration manifest is 0000–0007 plus 0009; the populated-upgrade test applies 0009 after old artifact data exists.

Creation reads a persisted assistant message from the signed invited owner's conversation. It accepts a whole JSON object or one whole-response `json`/`chart` code fence; it does not extract code from arbitrary prose. Callers cannot supply source, owner, a temporary override or executable component props when creating an artifact. Saves get their kind from the locked existing row. Create, save and restore all validate chart content before advancing the head; failures roll back atomically. Existing owner-first lock, optimistic version check, quota accounting, revisions, account export and account/chat deletion behavior are reused unchanged.

`lib/artifacts/chart-spec.ts` accepts only strict version 1 declarative JSON for bar, line, area and scatter. Common required fields are title, description, xAxis/yAxis labels, labeled series, and labeled positional rows. Category cells contain a number or null. Scatter cells contain a strict `{x:number,y:number}` pair or null. Each row has exactly one cell per series. Labels never become data keys, property paths, CSS, attributes, formatter callbacks or executable markup; internal keys are generated `s0`…`s7`.

Bounds: 128 KiB UTF-8 before JSON parsing; 1–8 series; at most 2,000 scalar cells (a scatter pair, including a missing pair, counts as two); at least one nonmissing numeric value. Numbers must be finite and within ±1 trillion. Titles/row labels are bounded to 120 characters, descriptions to 1,000, and axis/series labels to 80. Unknown keys at every object layer, wrong types/versions, ragged/empty/all-missing data and unsupported kinds fail closed. Text is plain and escaped. No URL, remote-data, HTML, MDX, import, callback, custom-component or expression field exists.

For example:

```json
{
  "version": 1,
  "type": "line",
  "title": "Support requests",
  "description": "Requests received each week; missing is not zero.",
  "xAxis": { "label": "Week" },
  "yAxis": { "label": "Requests" },
  "series": [{ "label": "Received" }],
  "rows": [
    { "label": "Week 1", "values": [24] },
    { "label": "Week 2", "values": [null] },
    { "label": "Week 3", "values": [35] }
  ]
}
```

A scatter variant uses `"type":"scatter"` and cells such as `"values":[{"x":2,"y":92}]` with the same positional series contract. JSON is data only; malformed code is never evaluated.

The existing shared caps remain 40 immutable revisions, 50 artifacts and 8 MiB total revision source per owner. Chart bytes count toward the same quota alongside Markdown/HTML; deletion frees those bytes. Chart sources are not automatically added to inference context. Rendering, editing, saving and exporting add no model request or paid path.

## Rendering and downloads

`components/artifacts/chart-preview.tsx` uses already installed Recharts 2.15.4 through fixed owned components/props and the existing semantic chart shell. It disables plotting animation and uses a fixed palette/dashes/shapes. The workbench lazily imports the chart renderer when the preview is opened; it does not eagerly load Recharts for every Markdown/HTML artifact. App semantic tokens, title/description, visible axis labels/legend and a native table are shared across light/dark and phone layouts. The visual plot is hidden from assistive technology in favor of the equivalent exact table with caption, scoped headers, full labels and explicit missing values. Its bounded scroll region is keyboard focusable. Source errors keep the editor available and disable invalid saves.

`GET /api/artifacts?id=...&download=source` returns exact validated saved chart source as JSON with a safe `.chart.json` filename. `download=svg` returns deterministic inert SVG from `lib/artifacts/chart-export.ts`, which serializes only fixed SVG primitives, finite owned geometry, escaped text, and title/description. It cannot embed images, links, scripts, event attributes, foreign objects, stylesheet/font loads or remote resources. Exports use the persisted revision, not unsaved edits. Both downloads pass through the existing ownership check and return attachment, nosniff, private/no-store and sandbox deny-all CSP headers. Malformed historical chart content cannot be exported or restored. The SVG is a portable fixed light canvas; the interactive preview follows the app theme.

## Verification

All heavy commands use the shared serialization wrapper `python3 /private/tmp/galaxy-run-check.py`. Dependencies are the checkout's own directory, not a symlink to the original checkout. `bun install --frozen-lockfile` added the ten inherited attachment/DOM-test packages missing from this local installation; package.json and bun.lock are unchanged. No new rendering dependency was needed.

Passed checks:

- `bun test`: **152 passed, 1 skipped, 0 failed; 2,508 assertions across 24 files in 92.86 seconds.** This includes the fresh full migration manifest and attachment/artifact integration. The opt-in native PostgreSQL concurrency regression was skipped because `F10_F11_POSTGRES_URL` was not configured; PGlite is not presented as native row-lock concurrency proof. This run preceded the final Unicode/XML label tightening described next.
- Final `bun test tests/f12-chart.test.ts tests/f12-chart-ui.test.tsx tests/f12.integration.test.ts tests/f11.integration.test.ts tests/f11-ui.test.tsx`: **18 passed, 0 failed; 1,124 assertions in 11.41 seconds.** Final review tightened plain text to reject lone surrogates, Unicode noncharacters and control characters before trimming, so every accepted label can be represented in XML. Added exact title/axis/series/row text-boundary regressions, then reran all chart and inherited artifact paths. No public interface, storage, attachment or funding behavior changed after the full suite.
- Final `bun run lint`: **passed**, 277 files, no fixes.
- Final `bun run typecheck`: **passed**, strict nonincremental TypeScript.
- `bun run f01:integrity`: **passed**.
- `bun run build --webpack`: **passed** on the final source, Next 16.4.2. Optimized compilation 30.6 seconds, generated TypeScript 13.1 seconds, all 24 static pages generated in 682 ms; route generation, optimization and traces completed. `/api/artifacts`, `/api/attachments` and `/preview/charts` are emitted as dynamic routes. No type/build bypass or changed Next configuration was used. Installed Next CLI docs confirm the supported Webpack option.
- `git diff --check`: **passed** before the implementation commit and again for the final evidence update.

Coverage includes all four chart types; unsupported versions/types and unknown nested keys; raw JS/MDX/imports, remote/formatter/component/expression slots, prototype keys, malformed JSON, empty/all-missing/ragged input, finite/±1-trillion boundaries, exact and over-limit UTF-8/series/cell/text bounds; determinism, fixed inert SVG primitives, escaped hostile labels, finite exported coordinates, constant/negative/single values and maximum size; accessible equivalent tables and invalid editor state; real signed route ownership/CSRF/guest/temp denial, atomic CAS/save/restore failures, immutable history, cross-kind shared storage/revision limits, exact saved exports, account export and account/chat deletion; fresh migration and populated F11 upgrade preserving old history and immutability guards. Provider fetch observations remain empty in chart integration tests.

The first targeted run passed all ten real F11/F12 route/SQL tests and both chart UI tests, but one SVG test used a raw regex that mistook escaped hostile label text `onerror=` for an actual event attribute. The corrected assertion parses SVG nodes, checks real attribute names and finite numeric coordinates; it retains hostile labels in the fixture and does not relax the product validator or exporter.

## Independent browser and release gates

Root owns CUA and browser verification. This implementation agent did not start a dev server or browser, execute browser automation, capture screenshots, or claim assistive-technology/physical-device results. `/preview/charts` uses the real artifact editor/preview with a labeled in-memory client, four samples, theme control, hostile/long labels, edits/invalid state/save/history/restore/delete, and local saved-revision JSON/SVG downloads. It is available only through the existing `NODE_ENV=development` plus `F04_UI_HARNESS=1` gate; production requests stay 404. It is not a private-route authentication bypass.

After checks finish, root can run `F04_UI_HARNESS=1 bun run dev --webpack --port 3113` in this managed checkout and open `/preview/charts`. Choose a sample, click Create artifact, select Chart from JSON, and create. Edit the JSON, preview, save a second revision, restore revision 1 from History, and download saved JSON/SVG. Remove a required key to verify invalid-save recovery. Reopen the fixture with hostile labels and check parent state, navigation, zero external requests, long-label/table scrolling and keyboard focus at desktop and 390px widths in both themes. In-memory data resets on page reload. The fixture never contacts an inference provider or attachment service.

Hosted CPU/render/bundle/storage compatibility, physical-device behavior and assistive technology remain separate live gates. No cloud login/provisioning/deployment, billing change, live migration, paid model call, issue/PR/push operation, or original-checkout edit was performed by this worker. Root authorized the base fetch and chart branch creation; root owns final source/browser review, GitHub and release operations.

Writer release: the scoped source/tests are committed at the source pin above, all check processes and local test sockets have exited, and no worker dev server or browser is running. Only this evidence document follows that checked source commit. Root may take over the clean checkout for CUA and integration. Installed Next use-client, route, lazy-loading and CLI guides were read; frontend-design and design engineering skill guidance informed the existing-shell chart/table layout.
