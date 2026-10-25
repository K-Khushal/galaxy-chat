> Historical CLI workflow. Retired from the current Zcode/user-relay workflow; do not run new implementation assignments from this guide. The old runner and completed assignment scratch files have been removed.

# Antigravity implementation orchestration

Use `agy` for new implementation assignments. Root owns ticket scope, independent review, validation, PRs and merges. Existing subagents may finish their assigned slices; use Codex subagents for independent review or difficult analysis afterward.

## Start or resume work

1. Read execution.md for checkout ownership. Confirm live agents and process/job state; inspect worktree status before assigning. One writer owns a checkout at a time. A CLI lock alone does not detect a separate Codex writer.
2. Run `agy models` when model availability needs verification. On October22 this authenticated catalog offered `gemini-3.8-flash-high`; requested 3.9 was absent. Pin the exact available slug with high effort. Never report an unavailable model as selected.
3. Write a bounded assignment under assignments/: exact checkout/base, permitted paths, concrete behavioral cases, protected invariants, offline-only execution and required evidence. Delegate one reviewable slice; prefer actual SDK/DB behavior tests to mocks that restate the implementation.
4. Launch `python3 docs/planning/automation/run-antigravity.py --checkout ABSOLUTE_CHECKOUT --assignment ABSOLUTE_ASSIGNMENT --job-dir ABSOLUTE_JOB_DIR`. Set the job directory under /private/tmp and record it in execution.md. This invokes authenticated `agy` headless with accept-edits and sandbox, not blanket permission bypass. Host permissions may require an escalated exec. Preserve the returned exec session ID.
5. Inspect state.json, compact event metadata, stderr.log and actual git diff. Resume via the same runner with `--conversation EXACT_ID` only after the previous job has stopped. Use a new job directory for the next attempt. Missing permissions are reported as blockers; an exit0/SUCCESS alone does not prove commands ran or acceptance passed.
6. Review the frozen diff against spec and standards independently. Root runs focused checks through the shared heavy-check runner; then required suite/lint/types/build/integrity, real browser fixture checks as relevant. Send concrete corrections back to the same conversation. Commit only scoped reviewed files; root creates and attaches PR, waits for green hosted CI on exact SHA and merges without bypassing protection.

## Evidence and ownership

Each job writes state.json (PID, checkout, assignment, exact model, conversation ID, exit/terminal status), events.jsonl, stderr.log and result.json. The launcher uses an exclusive per-checkout fcntl lock. Keep assignments and this launcher in the repository so temporary-file cleanup does not lose the workflow. If /private/tmp/galaxy-run-check.py is absent, restore the shared heavy-check wrapper before checks; lock path remains /private/tmp/galaxy-heavy-checks.lock.

Current search job: `/private/tmp/galaxy-agy-search-20261022-resume1`, exec session71041, conversation `d8dab978-a1c7-48da-95fe-371da70f30f3`, search33 patch in rebuild checkout. Initial job ended without edits because its git status command required permission; specific read/check commands were then allowlisted in Antigravity settings, and the exact conversation resumed. Its base is d3666b8; four new independent findings are recorded in assignments/search-review-fixes.md. Image implementation remains owned by /root/image_resume_oct22 until its release. MCP broker e14c5e4 is frozen awaiting review, with client/OAuth/fees still pending.

Antigravity uses its existing authenticated coding account; no paid app inference/search/image/MCP calls, cloud provisioning, billing changes or deployment are part of these jobs. Root preserves the original user checkout and unrelated edits, keeps advanced features off and mixed live-acceptance issues open.

CLI references: [headless sessions](https://www.antigravity.google/docs/cli/headless/), [permissions](https://www.antigravity.google/docs/permissions/).
