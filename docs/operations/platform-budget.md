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
The plan binds directly to normalized environment limits and real system constants:
- Feature flags: `fundedInferenceEnabled`, `byokEnabled`, `searchToolsEnabled`, `attachmentsEnabled`, `imagesEnabled`, `mcpClientEnabled`.
- Microdollar bounds: `platformInfraMicrodollars`, `platformProviderFeesMicrodollars`, `platformSafetyReserveMicrodollars`, `fundedMonthlyMicrodollars`, `searchActorDailyMicrodollars`, `searchGlobalDailyMicrodollars`.
- Storage & transfer caps: `attachmentPlatformBytes` ($\le 100\text{ MiB}$), `attachmentUserBytes` ($\le 20\text{ MiB}$), `attachmentDailyTransferBytes` ($\le 100\text{ MiB}$), `attachmentMaxUserFiles` (from `attachmentLimits.userFiles`).
- Concurrency & rate limits: `byokHourlyLimit`, `byokDailyLimit`, `byokGlobalDailyLimit`, `byokActorConcurrency`, `byokGlobalConcurrency` (from `BYOK_LIMITS`), `imageMaxBytes` (from `imageLimits`), `mcpMaxProfiles`, `mcpMaxTimeoutMs` (from `MCP_CLIENT_LIMITS`).

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
5. If an existing pending hold increases liability after bootstrap, or if an uncarried hold is discovered, `assertActivePlan` denies operations with `503 uncovered_legacy_exposure`.

---

## 4. Transaction Isolation & Locking Architecture

- **Awaited Advisory Lock**: All registration and assertion operations acquire PostgreSQL transaction advisory lock `41021406` (`FUNDING_ADVISORY_LOCK_ID`).
- **Post-Await Re-Evaluation**: Configuration resolution, DB clock timestamping, killswitch checks (`funding_control` missing or stopped fails closed), time expiration (`reviewedAt <= DB now < expiresAt`), and credit exposure checks run strictly inside the transaction after the lock is acquired.
- **Append-Only Triggers**: Database triggers `platform_budget_plan_no_update_delete` and `platform_budget_carry_no_update_delete` reject all `UPDATE` and `DELETE` queries.

---

## 5. Local Test Invariants & Non-Extrapolation Boundaries

- **Single-Client PGlite Scope**: Integration tests run against local in-memory PGlite with a max-1 client connection pool. They demonstrate serialized transaction queue ordering, barrier-controlled post-await re-validation, and rollback invariants. They do not prove native multi-session PostgreSQL concurrency or multi-node distributed lock contention.
- **Future Integration Gates**:
  1. Wiring `CreditStore` to assert against `platform_budget_plan` under lock `41021406`.
  2. Wiring MCP operations ledger and OAuth token storage.
  3. Trusted cryptographic cost receipt evidence and live infrastructure rate verification.
  4. The current slice provides only the durable allocation and carry foundation; it does NOT establish a real spend guarantee or enable any MCP runtime traffic.
