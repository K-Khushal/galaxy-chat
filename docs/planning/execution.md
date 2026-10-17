# Galaxy Chat orchestration

## Current authority

User switched implementation from Cursor to subagents after Cursor exhausted its monthly quota. Do not use Cursor again. Root remains a lightweight orchestrator: assign, review, verify, integrate, publish/attach PRs and merge passing code. Use efficient GPT-6.1 Sol or GPT-5.6 Sol workers; explicit model overrides require fork_turns=none with self-contained briefs. User authorized these models and subagents. If a task truly needs an external stronger agent, provide a self-contained handoff prompt and acceptance criteria while continuing independent work.

Code first with safe .env.example placeholders. No cloud sign-in, provisioning, manual deployment, billing changes or paid provider calls. Missing credentials must not prevent build; privileged unconfigured operations fail closed. Live OAuth/provider/Supabase/Cloudflare proof remains pending. Preserve original checkout .gitignore and skills-lock.json user changes.

## Product and stack

Next.js16.4.2, React19.3.1, AI SDK7, Bun, Better Auth/GitHub invites, Drizzle/Postgres and planned Supabase private storage. Supabase Auth is not used. Platform budget $0–$10/month; one credit=$0.10, five daily credits=$0.50 while shared funding remains, UTC reset/no rollover. One bounded basic guest generation. BYOK/advanced features follow roadmap.

Latest UI instruction: component quality matters, not library loyalty. Choose reputable free sources by visual/interaction quality, accessibility, performance, maintainability and license; normalize to one semantic system. Halaska/Be UI/shadcn/AI Elements are options. User explicitly installed design.how skills; use their workflow and relevant frontend/mobile/motion guidance, with settled/autonomous decisions rather than new approval rounds. Copies: /private/tmp/galaxy-cursor-skills (legacy directory name only, usable by subagents).

## Merged work and tracker

Repository K-Khushal/galaxy-chat. Tracker #4. F01–F14 map to issues #5–#18.
- Foundation PR19 merged d582dd656ed2fb598f25abd19b4e05b352bee3cd; issue6 closed.
- F03 auth/owned persistence PR20 merged 5520635b2c44e0fc06a0bd9eafac1cc3985267d7. 21 tests and hosted CI passed.
- Issues5/7 stay open for deferred live proof; code progression is not blocked by credentials.
- F04 PR21 merged b2b5f7e3302cdbde1aac8d935e97cc8d611dfd32 after all hosted checks passed (https://github.com/K-Khushal/galaxy-chat/pull/21). Issue8 stays open for deferred live/device acceptance.
- gh CLI works with require_escalated network; GitHub plugin writes previously returned403. After PR creation always attach_artifact. Use --body-file. Merge commits preserve stacked branch ancestry; no force pushes or branch-protection bypass.

## Active workers and PR handoff (2026-10-17)

1. /root/f07_byok_implementation — GPT-6.1 Sol high, ACTIVE sole writer.
   Checkout /Users/khushal/.codex/worktrees/galaxy-credits/galaxy-chat.
   Branch codex/f07-byok, basef0c87711d8c1c13e3bec7957be1aeb7cca7f56c1 (reviewed F05+merged F06).
   Implements issue11/F07 owner-bound encrypted OpenRouter/Gateway keys, masked/test/replace/delete settings, explicit platform/BYOK modes, catalog/capability validation, separate durable BYOK resource/concurrency accounting with zero platformmoney debit/no fallback, safe rotation/export/cascade. Real metadata/inference calls forbidden; localSDK/PG fixtures only, safe blank env. Expected docs/planning/f07-evidence.md and fullchecks. No commits/push/PR/merge, root review/browser/GitHub.

2. F05 completed/released writer; PR23 MERGED f9d7b81ab7fa52896cd6a0aba464c778af74a25a after all hostedchecks green.
   Checkout /Users/khushal/.codex/worktrees/galaxy-rebuild/galaxy-chat.
   Branch codex/f05-streaming-chat, commit2161869 then ancestry mergef0c87711d8c1c13e3bec7957be1aeb7cca7f56c1.
   https://github.com/K-Khushal/galaxy-chat/pull/23 merged exactheadf0c87711 after allchecks green. Root independent final67tests/426assertions19.31s+lint+production build(TypeScript) passed; worker standalonetypes/vendor/diffcheck pass. Merging current main changed zero files, so same verifiedtree.
   Independent spec+standards reviews found draftloss during reload, branchcap not reserving assistant slot, editor pendingsemantics; fixed and independently reaccepted. Root CUA editorautofocus/Escape sameEditaction; editedbranch preserves selectableoriginal; regenerate thirdbranch. Screenshot /private/tmp/galaxy-f05-branches.png. Preview3055 stopped. Evidence docs/planning/f05-{evidence,review}.md. Gateway funded stillunverified/failclosed; live issue9open.

F06 PR22 MERGED a578eba3b9d0894bc838a29b10d5ec8444fdbce5 after all fresh hosted checks green. Initial pushCI timeout diagnosed Bun asyncreject matcher/socket starvation, fixed7e3d3fbdee555d074b06d58594991c528c02c6f9: nativeawait preserves assertions, separatefixture engines isolate latecontinuations, max1 matchesproduction/PGlitesingle-session, default5s restored. No product/dependency/CIpolicy change. Root53tests/323assertions16.26s, independentreviewaccepted. Test helper fixes included in F05. Issue10remainsopen livegates.

F04 PR21 merged b2b5f7e3302cdbde1aac8d935e97cc8d611dfd32; localreviewaccepted, serversstopped, issue8open live/devicegates. Screenshots /private/tmp/galaxy-f04-mobile.png and galaxy-f04-desktop-dark.png. Root original checkout stays user-dirty; planningdocs/skills only here.

Next: let healthy F07writer continue; no pending PR to merge. Then F07 independent reviews/integration, F08 local beta/guest onboarding work. F08/F09+ live-dependent acceptance remains pending without credentials but does not block localimplementation. No competingwriters, no falseissueclosure, no paid/cloud actions. Existing reviewagents f05_spec_review/f05_standards_review/f06_spec_review completed and reusable.

## Agreed API/view seam

F06 GET /api/credits uses verified invited session and Cache-Control:no-store:
{funding:'platform',state:'disabled'|'available'|'daily_exhausted'|'shared_exhausted'|'busy',configured:boolean,allowanceMicrodollars:500000,remainingMicrodollars:number,creditMicrodollars:100000,resetsAt:UTC ISO,reason?:stable id}.
Remaining includes conservative holds. Do not leak global/admin balances. Mere daily allowance is not availability when provider/shared configuration is disabled.
Future isolated /api/guest state: {state:'disabled'|'available'|'used'|'busy',remainingGenerations:0|1,limitations:[...]}.
F04 has pure ChatAvailability/CreditStatus view mapping and fixtures until backend integration.

## Supervision and validation

Automation id orchestrate-galaxy-chat-with-cursor retains its legacy ID but is renamed Orchestrate Galaxy Chat with subagents, ACTIVE every10minutes. Cursor quota blocker is superseded; no Cursor retry or billing change.
Keep commentary/status concise. Silence unchanged heartbeat finals. Notify meaningful merges/failures/real required user input.
Review scoped diffs; keep standards/spec axes separate when applying code-review skill. Use bounded checks and return concrete bugs to workers. Embedded Postgres tests bind loopback and require escalated exec; sandbox EPERM is environmental, retry with correct access. No disabling checks.
Root browser QA must use supported CUA tooling; capture actual screenshots and report unverified device/live behavior honestly.
F04 base e779231; F06 base5520635. Root original checkout remains untouched apart from planning/installed skill updates.


