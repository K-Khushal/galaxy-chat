# F05 independent review

Baseline09f3edaec12e161de8eb105309ae0f1abdd7ad6a. Two independent GPT-6.1 Sol reviewers inspected source and local SDK/SQL coverage; fixes re-reviewed separately.

## Standards

P2 branch cap used existing snapshot count without reserving the assistant slot. Fixed by checking action-specific prefix plus both generation slots before provider entry;499-message failed-turn send rejects with zero provider calls, bounded shorter forks preserve originals. P3 editor pending label/busy/spinner contract fixed. Review accepted; no additional concrete issue.

## Spec

P2 draft loss during reload: composer cleared before rejected send. Fixed with explicit accepted/rejected claim, sync/submission blocking and same-tick guard. Rejected/duplicate drafts and rejected editor submissions remain intact. Reviewer independently ran UI regressions9tests/43assertions; no scope creep or further specification mismatch.

## Browser and root verification

Supported CUA preview: edit textarea autofocus; Escape returns same Edit action; edited branch adds a selectable alternative while original prompt/response remain intact; regeneration creates a third branch; accepted action focuses composer. Screenshot /private/tmp/galaxy-f05-branches.png. Preview credits/replies remain explicitly fixture-only. Initial stale worker server caused a lazy chunk failure; fresh root-owned server/client completed these interactions without that failure. Root server stopped after review.

Root independently passed final67tests/426assertions in19.31seconds, lint and credential-free production build including TypeScript. Worker passed standalone typecheck/vendor integrity/diff-check. F06 approved fixture correction included; default5second timeout retained. Root records ancestry integration and hosted checks in PR/tracker.

Live OAuth, real prices/bounds/receipts, hosted streaming/runtime, Supabase backend contention, physical mobile, auditory screen-reader and measured performance/accessibility remain pending. Gateway funded execution fails closed until validated receipt/bounds semantics. No paid provider or cloud calls. Issue9 remains open for live gates.
