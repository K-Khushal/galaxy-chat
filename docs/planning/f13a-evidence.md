# F13-A bounded tools and exact-action approval foundation

Scope: child #32 of #17. This is an offline implementation slice, not live-provider acceptance. No account, infrastructure, deployment, billing configuration or paid inference was used. Tools default off; the basic-chat path is unchanged.

## Implemented boundaries

`ai@7.0.143` bundled agent/loop-control/tool-approval docs and source, the installed Next 16.4.2 route-handler guide, and repository UI/button standards were read before implementation. Runtime uses `ToolLoopAgent`, typed `tool` schemas, explicit `isStepCount(3)`, `toolApproval`, and zero SDK retries. No handwritten model loop, auxiliary inference, platform tool adapter, web search, MCP, sandbox or executable external-write tool exists.

The signed-owner `/chat/tools` workbench and `/api/tools` boundary use a distinct, expiring operator-reviewed `TOOL_MODELS_JSON` snapshot. `TOOLS_ENABLED=1`, configured BYOK key encryption/resource controls, an approval secret of at least 32 characters, reviewed tool capability, disabled reasoning, explicit provider routing and reviewed provider spending controls are all required. `.env.example` values remain blank. A basic-text model snapshot cannot enable tools. Guest sessions and temporary/platform flags cannot enter the strict request schema.

Each run requires the exact current estimate, an integer microdollar ceiling at least that large, and explicit acknowledgement of a provider spending limit. The conservative estimate prices three maximum input allocations and the shared maximum output allocation. These are application limits, not a guarantee of provider billing. Live verification of the provider limit, protocol and price snapshot remains mandatory before enabling a real model.

Existing `ByokStore` reservations, actor/global concurrency/rate/record limits, encryption, HMAC resource digests and atomic credential/context entry are reused. Tool runs reserve three resource units up front against the existing shared hourly/daily/global paid-call limits; basic chat and credential tests continue to reserve one. The projected increment is checked atomically under the existing lock. Unused tool-step capacity is conservatively charged to rate limits. Migration `0008_tools.sql` adds private run/call/approval rows and content-free per-step claims, with database output/state constraints. Private storage is capped at 200 runs per owner, 2,000 globally and four approval records per run. Every actual SDK model dispatch rechecks the current model snapshot, credential revision/state, owner/run, selected revisions, deadline and sequential durable claim. The claim commits before calling the adapter. Final provider middleware measures the complete serialized provider prompt, instructions, schemas, tool calls/results and any reasoning/history before each entry. The joint input ceiling is 12,000 bytes (also below the existing 16,384-token ceiling); each reported input receipt must fit that token ceiling.

The run permits at most three model calls, four tool dispatches, 20 seconds including setup, and a 4,096-byte untrusted JSON result per tool. Model output reservations are 170, 171 and 171 tokens, totaling 512 across the run. Missing/invalid usage, unexpected reasoning or an exceeded receipt stops continuation. The provider's result and error diagnostics are stripped before SDK/UI delivery. No retry, fallback, repair generation or client-authored approval continuation can reset these bounds.

Initial tools are finite four-operation arithmetic (no expression evaluator) and a bounded slice of an owned immutable artifact revision explicitly selected before the run. The model receives selected IDs only and has no account-wide search tool. Every read rechecks ownership and selection. Newer revisions never replace selected revisions. Tool results remain escaped untrusted text in the UI and context.

Exact-action approval records bind owner, run, call ID, tool revision, connection revision, canonical JSON arguments, target and cost bound. Only a server issuer can create records; the authenticated decision endpoint cannot invent an action. Records expire no later than the original 20-second run deadline, can be denied/revoked and are consumed atomically before an effect. Changed bindings, another owner, expired/denied/revoked records, replay and a client `approved:true` are insufficient. The only executable approval fixture is inert test code; no external write or approval-continuation API is exposed. A future external-write slice must supply and revalidate its real current tool/connection binding and use the same durable step budget before any additional model call.

Private runs, outputs, prompts, selected IDs and approvals are included in account export and cascade on deletion. Individual run deletion removes private data and approvals without releasing remote resource claims. Anonymous BYOK operations and tool-step counts contain no prompt, arguments, target, output or secret and survive account cascade. Cancellation, crash, timeout, unknown usage and ambiguous provider errors retain active/unknown remote holds; an abort is not proof of provider termination.

## Local proof

All heavy commands use `python3 /private/tmp/galaxy-run-check.py` to serialize against other work. Tests use the real installed SDK with `MockLanguageModelV4`, never a paid adapter. PGlite integration uses only the captured application postgres.js `max:1` queue after socket start, native awaited rejection helpers and normal five-second tests (the real 20-second deadline test explicitly allows 25 seconds).

- Before inheriting F10: `bun run lint` passed (260 files); `bun run typecheck` passed; full `bun test` passed **147 tests / 1,493 assertions / 103.99s**.
- The first full run caught the exact migration manifest missing 0008; that expected version was updated before the passing run.
- Main F10 merge `e4ec439eeb321c0a0f4ddf2aa32ce07326f2d6be` was inherited in `0d9177c`. Account export retains both tool data and attachments; attachment cleanup, image-payload preparation and atomic entry hooks remain intact. The exact migration manifest includes 0005/0006/0007/0008. Locked dependencies were installed in this checkout.
- After inheritance, focused cap tests passed **11 tests / 85 assertions**, including the real 20-second deadline. The SDK-generated invalid-input error case was additionally pinned to the exact `tool_result_limit` rejection (**1 test / 7 assertions**). Both normal tool outputs and SDK-created tool errors/denials are capped before another model entry.
- Combined lint passed **284 files** and standalone typecheck passed. Final combined full-suite and strict-build results follow below.

Focused proof includes exactly three model dispatches; a shared 512-output-token allocation; four dispatches with a fifth denied; duplicate-call IDs; schema and accumulated-history pre-entry limits; selected-only cross-owner/immutable/deleted-revision behavior; malicious 4 KiB result handling; unknown/reasoning usage; abort and real deadline behavior; no platform reservation/fallback; durable credential replacement checks; request idempotency; exact-action expiry/revocation/replay/changed arguments; and the actual SDK signed approval protocol backed by a durable decision and inert single-use execution.

## UI review handoff

Root review uses the explicitly enabled development `F04_UI_HARNESS=1` harness at `/preview/ui?tools=1`. It renders the same production workbench/trace/approval components with an offline client. Modes cover run, tools off, all five tool states, and an inert approve/deny/revoke fixture. Idle action names remain stable while busy, a spinner plus `aria-busy` communicates pending work, immediate ref guards prevent duplicate actions, result text is escaped/wrapped, and the layout stays in natural document flow. The preview continues to return 404 in production. Root browser evidence at 390px and short height, keyboard, reduced motion and production preview gating must be recorded separately; this worker started no server/browser. Real-phone touch and provider behavior are not implied by fixture screenshots.

## Separate live gates

Real-model tool protocol, maximum output semantics, complete input/output/reasoning usage, provider routing/price/budget enforcement, hosted execution CPU/deadline behavior and actual cancellation/billing reconciliation remain unverified. Missing configuration fails closed. No paid call or deployment is authorized by this implementation or evidence file.

## Final combined verification and writer handoff

Frozen application source: `b48754ab471a7b45f7f6fde6b12a9fc8923dacd8` on `codex/f13-tools`, including reviewed main `e4ec439eeb321c0a0f4ddf2aa32ce07326f2d6be`. The preceding feature checkpoint is `26bba3a`; the main inheritance merge is `0d9177c`. Only this evidence file changed after the final source pin.

All commands below were serialized through the shared check runner and passed against that frozen combined source:

- `bun run lint`: **284 files**, no fixes or errors.
- `bun run typecheck`: passed with incremental output disabled.
- `bun test`: **169 pass / 1 skip / 0 fail**, **1,780 assertions**, **170 tests across 24 files**, **119.34s**. The skip is the inherited F10/F11 native-Postgres concurrency fixture when its explicit database URL is absent; no F13 test is skipped. The actual 20-second uncooperative-provider test ran and passed.
- `bun run build --webpack`: passed strict compilation, generated-route TypeScript, all **25/25** generated pages and final build traces. `/api/tools` and `/chat/tools` are dynamic; the existing development-only preview gate is preserved.
- `git diff --check`: passed, and the checkout was clean before this evidence-only update.

The full suite covers the inherited F10 attachment/PDF/image/payload/context/cleanup paths alongside F13. No existing BYOK image-payload, preparation or atomic owned-context validation hook was removed. Resource units default to one for ordinary chat and key metadata tests; tool runs atomically reserve three against the same shared rate limits. The regression proves 28 existing units deny a tool run before any adapter call, 27 permit a three-unit run, and a later ordinary chat reservation cannot exceed the shared limit of 30.

The real OpenRouter package was also exercised with wholly intercepted local JSON responses: two SDK calls used the owner's key, explicit provider/no fallback, 170/171 output allowances and untrusted continuation results. A subsequent fake HTTP 500 generated exactly one attempt, retained its conservative hold, and leaked no provider diagnostic or key into private exports. No live inference request occurred.

Writer released after this evidence-only commit. All test sockets/databases, typecheck and build processes finished; no implementation-owned server or browser was started and no host check lock remains held. Root owns independent review, browser checks, GitHub/PR/CI/merge and any remaining live gates. Original and other managed checkouts were not modified. No push, PR, deployment, provisioning, cloud login, billing change or paid call was performed by this worker.
