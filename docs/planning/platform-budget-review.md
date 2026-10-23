# Shared allocation foundation review

Source d915369, based on reviewed main a38aa46. This foundation adds immutable monthly allocation plans and durable pseudonymous carry records. It does not integrate CreditStore or MCP execution, activate funding, or establish a real spending guarantee.

The selected monthly ceiling is at most 10,000,000 microUSD. Credit allocation, MCP allocation, existing infrastructure/provider-fee/safety commitments and carried liabilities must fit together. Enabled operator configuration must match the persisted revision/digest and bound nonsecret runtime capacity. Coverage assertions and proof references require operator review; they are not hosted cost evidence.

Registration owns a parsed, deeply frozen candidate across awaits. Both registration and assertion fail closed on missing/stopped controls, invalid/current-month mismatches, coverage expiry, conflicting deployment identity, capacity drift and uncovered liabilities. Validation checks run synchronously after the final clock read. Repeated registration checks frozen persisted carry; new/increased prior exposure cannot be silently accepted even with allocation headroom.

Carry is a conservative per-source maximum union of prior carry and pending credit liabilities. Original reservations settling, releasing or accounts being deleted cannot erase period carry. No automatic reconciliation or carry release is implemented. SQL triggers make plans/carry append-only; RLS and revokes protect access. Existing financial rows and CreditStore behavior are unchanged.

Attachment global object/processing bounds 1000/2/1 were extracted into shared constants without changing enforcement; capacity identity includes these and existing text/page/pixel bounds. MCP profile digest includes all ten reviewed fields and excludes secrets.

Root full checks at 3dca4dd: app 308 pass, 1 inherited native-PG skip, 0 fail, 4,029 assertions; Node22 broker 27 pass; types/lint/integrity/strict Webpack/full Node22 OpenNext pass. Final small correction d915369: budget/account/attachment suites 37 pass, 417 assertions; types and lint pass. Full-suite/build evidence precedes that final timing/capacity correction. Hosted CI must verify the final PR head.

Independent security/spec review cleared the complete correction; standards review is tracked separately in execution notes. Tests are offline local DB fixtures. PGlite and a max-one pool demonstrate queued ordering rather than independent native-Postgres session contention. No UI or external request was added.

Next required local work: enforce this plan in existing funded-credit reservation/entry and the future MCP ledger before enabling MCP operations. OAuth, catalogs, approvals and dispatch integration remain pending. Trusted cost measurements, infrastructure rates, hosted runtime/grants, invoice-period attribution and recovery proof remain live gates. Placeholders remain off and no billing or deployment actions were performed.
