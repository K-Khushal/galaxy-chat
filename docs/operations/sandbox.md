# Durable sandbox foundation (issue #59, child of #37)

This slice provides an exact owned artifact proposal, explicit approval, separately funded execution journal and bounded Markdown publication. Tests exercise real SQL and a bounded client against a scripted loopback HTTP endpoint. Submitted code is never evaluated on the application or developer host. No production adapter, route or worker is enabled; #37 and #38 remain open.

## Admission and identity

Every execution admission re-parses the runtime under the SQL clock. The offline adapter requires both the actual process and supplied environment to be in test mode; a saved test environment cannot enable it in production. Client construction and every network call independently require actual test mode. Only literal loopback HTTP destinations without credentials, paths, queries or fragments are accepted. The factory captures immutable credentials, derives their SHA-256 identity and brands issued clients privately. Caller-shaped client objects cannot authorize execution.

Approval binds the immutable source revision/content digest, empty selected-input list, image/interpreter digests, provider/account/region, gateway/key identity, synthetic fee digest, immutable sandbox envelope digest, platform plan/capacity identity, action revision and expiry. Any drift denies entry or rolls publication back. The synthetic fee snapshot is test data, never vendor pricing or capability proof.

Limits remain one owner/two global active resources, including uncertain orphans; 1 vCPU, 512 MiB memory, 128 MiB disk, denied network/package installation, five-minute absolute lifetime, at most 15 seconds for the command within the original 20-second lease, five attempts/ten-minute job wall. Entry persists the minimum of the original lease, command, job, approval and fee deadlines. Recovery and per-request timeouts never renew it. Wire responses/logs are bounded to 4 KiB; source/final artifacts to 128 KiB. Retained operation counts are bounded separately.

## Journal and recovery

Funding precedes entry under funding → BYOK → attachments → jobs → owner locks. Reserve, commitment, entry and the creation tombstone commit before a create request. A final coherent SQL read checks fence, attempt, lease, source, approval and time after journal writes; synchronous runtime/identity checks follow it. Publication uses `mutateArtifactInTransaction` and performs final authority checks after all publication writes, so late changes roll back the report, message, evidence and job completion together.

Once entry commits, an HTTP error proves neither no resource nor zero cost. Non-success/malformed/oversized/lost responses retain the full liability and stop funded admissions. Retries never create another operation for the same job. Post-entry failures retain uncertainty even after owner deletion, invitation removal, configuration loss or lease expiry, and request cleanup of an exact observed handle when available. `retainUncertainOperation` is a separate anonymous, retention-only operator recovery API: it requires no owner, runtime, attempt or lease and can never create, release or settle.

Command completion and a terminate acknowledgement are not authenticated resource-stop evidence. Completed operations continue to occupy active capacity and retain their full financial commitment. An unknown create without a handle remains held; this child does not invent an orphan lookup or provider capability.

There is **no authenticated receipt issuer** in this foundation. `reconcile` returns `sandbox_receipt_authority_unavailable`; SQL rejects settlement. Caller-shaped receipt JSON, even with plausible digests or a zero amount, cannot reduce liability. Only a proven never-entered reservation (zero attempts and no tombstone) can be released. A future reviewed adapter/issuer must supply concrete cost and resource-stop evidence before these restrictions can change.

## Retention, export and budget

Migration 0022 is additive; merged migrations remain unchanged. Financial operations, evidence digests, audit, periods, commitments and retained principal/counter rows do not cascade or permit deletion. Only separate owner/job/source metadata cascades. Raw output and logs live in owned messages/artifacts; retained financial evidence stores their digests only. Account export includes sanitized operation IDs, states, revisions, amounts and timestamps without needing sandbox runtime configuration, handles, keys or fee snapshots.

Canonical numeric GitHub identity and retained key versions preserve limits across account deletion/recreation and actor-key rotation. Namespaced carry uses every prior frozen commitment at its historical maximum, even after release; missing/increased carry blocks all funded admissions. Bootstrap freezes plan identity, source digest and ordinary infrastructure commitment atomically and has no carry-check bypass. Rebootstrapping cannot silently change that reviewed envelope.

Every funded admission checks `ordinaryInfra + sandboxCommitted + incoming ≤ Kinfra` when sandbox exposure exists. Acredit/Amcp are not borrowed. The existing global equation remains `Acredit + Amcp + Kinfra + Kfees + Ksafety + Lcarried ≤ B ≤ $10/month`, including all infrastructure, fees, reserves and carried liabilities.

## Evidence boundaries

Offline tests cover actual SQL/wire ownership, approvals, carry, retained capacity, account deletion/export, response ambiguity, original deadlines, final-write rollback and production denial. The scripted endpoint's in-memory map exists only for its fixture lifetime; application creation tombstones are durable SQL. This is not a real provider restart, billing or isolation proof.

No cataloged provider currently establishes all required disk/network/lifetime/cost guarantees. Catalog entries retain their precise denial reasons. Native PostgreSQL contention/snapshot recovery, authenticated receipts/resource-stop/orphan lookup, vendor account/fees/isolation, live OAuth and hosted worker/deployment/budget evidence remain separate pending gates. No paid calls, provisioning or deployment were performed.
