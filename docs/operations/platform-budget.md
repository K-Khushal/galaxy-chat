# Shared Platform Budget & Durable Carry Operations

---

## 1. Overview & Single Platform Ceiling

The platform enforces a single, immutable monthly budget plan per UTC month (`YYYY-MM`, with months strictly validated `01..12`) bounded by the total platform ceiling:

$$\text{PLATFORM\_CEILING\_MICRODOLLARS} = 10{,}000{,}000 \ (\text{\$10.00 USD / month})$$

### Hard Arithmetic Invariants & Snapshot Bindings
Every reviewed plan must satisfy exact integer arithmetic without float approximations:

$$A_{\text{credit}} + A_{\text{mcp}} + K + L_{\text{carried}} \le B_{\text{selected}} \le 10{,}000{,}000$$

Where:
- $B_{\text{selected}}$: Selected platform budget cap for the month ($0 \le B \le 10{,}000{,}000$). When $B = 0$, all components must be exactly 0.
- $A_{\text{credit}}$: Allocation reserved for funded model inference (`FUNDED_MONTHLY_MICRODOLLARS`), strictly bound: $A_{\text{credit}} = \text{capacitySnapshot.fundedMonthlyMicrodollars}$.
- $A_{\text{mcp}}$: Allocation reserved for future Child 34 MCP operations (allocating capacity does NOT enable MCP entry).
- $K = K_{\text{infra}} + K_{\text{provider\_fees}} + K_{\text{safety}}$: Immutable platform commitments, strictly bound to `capacitySnapshot` fields and retaining configured commitments without reduction.
- $L_{\text{carried}}$: Conservative snapshot of all prior-month liabilities across the multi-month carry union.

---

## 2. Finite Capacity Snapshot & Coverage Assertions

### Finite Runtime Capacity Allowlist
The plan binds directly to normalized environment limits and real system constants across all functional areas:
- **Feature enablement**: `fundedInferenceEnabled`, `byokEnabled`, `searchToolsEnabled`, `attachmentsEnabled`, `imagesEnabled`, `mcpClientEnabled`.
- **Microdollar bounds**: `platformInfraMicrodollars`, `platformProviderFeesMicrodollars`, `platformSafetyReserveMicrodollars`, `fundedMonthlyMicrodollars`, `searchActorDailyMicrodollars`, `searchGlobalDailyMicrodollars`.
- **Search bounds**: `searchActorHourlyRequests`, `searchActorDailyRequests`, `searchGlobalDailyRequests`, `searchActorDailyMicrodollars`, `searchGlobalDailyMicrodollars`, `searchMaxResults` (`SEARCH_LIMITS.results`), `searchTimeoutMs` (`SEARCH_LIMITS.timeoutMs`), `searchContextBytes` (`SEARCH_LIMITS.contextBytes`), `searchTransportBytes` (`SEARCH_LIMITS.transportBytes`).
- **BYOK bounds**: `byokHourlyLimit`, `byokDailyLimit`, `byokGlobalDailyLimit`, `byokActorConcurrency`, `byokGlobalConcurrency`, `byokActorRecords`, `byokGlobalRecords`, `byokMetadataBytes` (from `BYOK_LIMITS`).
- **Attachment bounds**: `attachmentPlatformBytes` ($\le 100\text{ MiB}$), `attachmentUserBytes` ($\le 20\text{ MiB}$), `attachmentDailyTransferBytes` ($\le 100\text{ MiB}$), `attachmentMaxUserFiles`, `attachmentMaxFileBytes`, `attachmentMaxPerMessage`, `attachmentUploadLeaseMs`, `attachmentTextBytes`, `attachmentExtractedCharacters`, `attachmentPages`, `attachmentImagePixels`, `attachmentGlobalObjects`, `attachmentGlobalProcessing`, `attachmentOwnerProcessing` (from `attachmentLimits`).
- **Image bounds**: `imageMaxBytes`, `imageMaxMilliseconds`, `imageMaxPromptCharacters` (from `imageLimits`).
- **MCP client bounds**: `mcpMaxProfiles`, `mcpMaxTimeoutMs`, `mcpMaxRequestBytes`, `mcpMaxEnvelopeBytes`, `mcpMaxTransportResponseBytes`, `mcpMaxDecodedBodyBytes` (from `MCP_CLIENT_LIMITS`).
- **MCP profile map digest**: `mcpProfilesDigest` (canonical SHA-256 digest of sorted non-secret reviewed operator profile metadata: `profileId`, `revision`, `purpose`, `resource`, `issuer`, `credential`, `maxRequestBytes`, `maxResponseBytes`, `timeoutMs`, `expiresAt`). When `mcpClientEnabled` is false, this is an empty string; when enabled, changing any profile field invalidates the capacity digest. Secrets and tokens are strictly excluded from snapshot data.

> [!WARNING]
> These finite runtime bounds constrain local platform operations. They do not claim to prove external hosting provider billing; operator attestation is not hosted cost proof.

### Mandatory Coverage Assertions
Every plan must explicitly assert coverage (`true`) across all 8 operational domains:
- `infra`: Platform server and worker infrastructure.
- `storage`: S3/Supabase private object storage footprint.
- `transfer`: Network egress and daily transfer bandwidth.
- `database`: PostgreSQL connection pools, storage, and transaction overhead.
- `queues`: Background deletion, upload, and maintenance queues.
- `ordinaryByok`: Compute and proxy overhead for BYOK model execution.
- `accountLevelCharges`: Account export, audit, and credential lifecycle overhead.
- `conservativeLegacyUnknownExposure`: Coverage for historical unresolved holds.

---

## 3. Durable Carry Union ($L_{\text{carried}}$)

When bootstrapping a new UTC month plan $M$:
1. The store queries all prior carry records (`platform_budget_carry WHERE month < M`) and all prior pending holds (`credit_reservation WHERE month < M AND state IN ('reserved', 'entered', 'held')`).
2. It constructs a **union by source reservation ID**, where each source requires:
   $$\text{amount} = \max(\text{previous carried amount}, \text{current pending charged amount})$$
3. $L_{\text{carried}}$ must be $\ge$ the sum of this union. Understating $L_{\text{carried}}$ fails closed with `400 carried_liability_insufficient`.
4. Persisted carry records are **frozen and permanent**: subsequent settlement, release, user account deletion, or month transitions cannot shrink or delete carry rows.
5. **Repeat Registration Invariants**: For existing plans, the store inspects persisted carry rows for month $M$. If any prior pending hold appears or increases above its persisted carry row amount, both repeat `registerReviewedPlan` and `assertActivePlan` fail closed with `503 uncovered_legacy_exposure`, even if $L_{\text{carried}}$ has headroom. Persisted carry is never mutated.

---

## 4. Transaction Isolation & Locking Architecture

- **Awaited Advisory Lock**: All registration and assertion operations acquire PostgreSQL transaction advisory lock `41021406` (`FUNDING_ADVISORY_LOCK_ID`).
- **Caller-Owned Candidate Isolation**: Candidate inputs are validated, cloned, and deeply frozen on entry via `parseBudgetPlanInput(unknown)`; original references are discarded. All public input parsing errors map to typed `AppError` (`400 invalid_budget_plan` or `400 invalid_budget_coverage`).
- **Post-Await Re-Evaluation**: Configuration resolution, fresh DB clock timestamping (`clock_timestamp()`), killswitch checks (`funding_control` missing or stopped fails closed), time window expiration (`reviewedAt <= DB now < expiresAt`), month alignment, revision/digest matching, and capacity drift checks run strictly inside the transaction after lock acquisition, immediately prior to `INSERT`, and immediately before ANY transaction return. Any intermediate drift triggers transaction rollback with 0 partial rows.
- **Append-Only Triggers**: Database triggers `platform_budget_plan_no_update_delete` and `platform_budget_carry_no_update_delete` reject all `UPDATE` and `DELETE` queries.

---

## 5. Local Test Invariants & Non-Extrapolation Boundaries

- **Single-Client PGlite Scope**: Integration tests run against local in-memory PGlite with a max-1 client connection pool. They demonstrate serialized transaction queue ordering, barrier-controlled post-await re-validation, and rollback invariants. They do not prove native multi-session PostgreSQL concurrency or multi-node distributed lock contention.
- **Future Integration Gates**:
  1. Wiring MCP operations ledger and OAuth token storage.
  2. Trusted cryptographic cost receipt evidence and live infrastructure rate verification.
  3. The current slice integrates CreditStore with the durable allocation and carry foundation; it does NOT establish a real spend guarantee or enable any MCP runtime traffic.

---

## 6. Credit Reservation Plan Binding & Operator Bootstrap Workflow

- **Operator Pre-Registration Required**: There is strictly NO auto-registration of budget plans, new months, or reallocations inside `reserve` or `enter`. Operators must explicitly register reviewed monthly plans in advance using `PlatformBudgetStore.registerReviewedPlan(candidate, env)`.
- **Runtime Enforced Binding**: Every credit reservation binds to the reviewed plan (`plan_month`, `plan_revision`, `plan_digest`, `plan_capacity_digest`). Database constraints enforce either all four NULL (legacy rows) or all four explicit non-null with strict pattern matching and `plan_month = month`.
- **Immutability Once Bound**: Database trigger `credit_reservation_plan_binding_immutable_trigger` prohibits any update, alteration, clearing, or backfilling of binding columns once written.
- **Function Bootstrap Workflow**:
  ```ts
  import { PlatformBudgetStore } from "@/lib/funding/store";
  import { requireDb } from "@/lib/db/client";

  const store = new PlatformBudgetStore(requireDb());
  await store.registerReviewedPlan(planCandidate, process.env);
  ```
- **CLI & External Spent Boundaries**: An optional CLI is intentionally not introduced in this slice. Hosted proofs and external cost measurement receipts remain pending live gates. No deployment, billing, or provider activation is performed.
