# Frontend Phase 2 — inventory integrity

Branch: `codex/frontend-phase-2`, based on Phase 1 commit `4ba0a59`.

## Status and deployment boundary

Implementation and local validation are complete. The generated migration has **not**
been applied to a hosted Supabase database. It was applied only to isolated, ephemeral
PGlite databases in the automated tests. No live user records were migrated or edited.
Deploy the database migration before using this frontend's new cloud mutation path.
The frontend rejects a missing RPC/version conflict; it never falls back to unsafe
snapshot upserts or to an optimistic local success after a failed cloud mutation.

## Issues addressed

- #3: One pure operation planner allocates proportional partial-transfer values to six decimal places, preserves the exact decimal residual and full-transfer value, subtracts the same value from the source, and conserves total quantity/value across partial, full, branch, and personal transfers.
- #4: Edit computes the net difference between recorded old/new effects. Cancellation reverses recorded effects in the same transaction and soft-deletes the ledger row. Consumed stock, stale dialogs, and unrecorded legacy effects reject without changing balances.
- #2: Removed the larger-cloud-quantity heuristic and input-object mutation. Explicit operations submit affected records with expected versions and durable idempotency IDs.
- #6: Ledger derivation partitions by item/warehouse, uses running weighted valuation or recorded issue effects, and validates available stock instead of comparing an outward-only row to its own incoming quantity. The dashboard uses current inventory for ending quantity/value, including opening stock and manual adjustments.
- #12: Local storage and cloud mutations are separate. Ledger and custody commit to one versioned local snapshot; cloud mutations use one Postgres RPC. Changed records only are sent. Web Locks serialize browser mutations, a local queue orders same-tab work, and database versions reject stale clients. Delayed hydration does not overwrite an in-flight operation.
- #39: Cloud mapping reads/writes an explicit acquisition date, independently of created_at. Unknown legacy dates remain unknown; known local dates are retained when the cloud has no acquisition date.
- #26: Reports subscribe to shared inventory state. History uses structured events and retained previous images; old free-text notes remain separately visible without invented historical events.

## Schema changes (additive)

Migration: `supabase/migrations/20261103173855_frontend_inventory_integrity.sql`, generated with the official Supabase CLI.

- `custody_items`: `acquisition_date date`, `version bigint`, `deleted_at timestamptz`, and `history jsonb`.
- `movements`: `version`, `deleted_at`, source item/quantity/value context, recorded `inventory_effects`, and `request_fingerprint`.
- Partial unique index on active non-null request fingerprints; existing rows are not backfilled.
- `inventory_operations`: immutable-by-client operation receipts/events, actor-scoped RLS, SELECT/INSERT grants only.
- Version triggers invalidate stale plans even when an older client writes a row.
- `apply_inventory_operation`: SECURITY INVOKER, explicit auth/role checks, consistent row locking, version checks, value/quantity conservation validation, idempotent replay, and atomic inventory/ledger/history persistence.

Existing inventory and movement RLS policies are not rewritten in this phase. The SQL
tests use an isolated schema matching the repository's relevant tables and functions;
they do not prove the policies or schema of the hosted project. Run the live schema,
RLS matrix, and database advisors against the intended environment before deployment.
There is no destructive down migration. Rolling back code must not drop these columns,
receipts, or the new local snapshot. Export the full v2 backup before a code rollback;
older frontend versions do not understand the new local snapshot.

## Data preservation and intentional limits

- The original local movement/custody keys remain untouched by new transactions. The new aggregate is `warehouse-ledger-inventory-v2`.
- Both new and old records can be read. No automatic correction of legacy balances, inferred acquisition dates, or historical effects is performed.
- Legacy movements without recorded effects cannot be safely edited/cancelled until their opening balances/effects are reviewed. This is intentionally blocked rather than guessed.
- Depleted lots and cancelled movements remain stored. Custody removal archives the record; it does not physically delete it.
- Pending cloud plans survive ambiguous errors and can be replayed with `retryInventoryOperation(id)`. Successful requests retain their idempotency receipt; redundant pending payloads are compacted only after the snapshot commits.
- Browsers without Web Locks reject mutations instead of risking concurrent local writes. Modern secure-context browsers are required.
- Mixed inward/outward imports must be split into two new operations; existing mixed legacy rows are preserved.
- Replacement imports over existing inventory and conflicting backup restores are blocked to preserve user records. Append/update and conflict-free merges remain available.
- Backup export includes the complete v2 snapshot, including archived records and history. Cloud backup verifies existing committed versions instead of replaying ledger/stock snapshots.

## Verification

Final full-suite run: 280 passed, 3 failed (283 total, 31 files). All 272 local unit,
component, and isolated database tests passed. The three failures are the existing
live Supabase response assertions with network access disabled. The seven Postgres
contract tests also passed after the final migration review.

`npm run typecheck` and explicit frontend compilation passed. Lint exited zero with
31 warnings. Standalone Vite production bundling and `git diff --check` passed.
`npm run build` remains blocked by the unchanged pre-existing config typo noted below.

Coverage includes real
second-application idempotency, partial/full value conservation, purchase/transfer edits,
soft cancellation, consumed-stock rejection, CAS conflicts, network-failure replay,
cross-tab revision rejection, delayed hydration, structured history, reactive reports,
backup conflicts, and real Postgres statement rollback/auth/version checks.

PGlite is a pinned development dependency only. Windows test workers use baseline
WebAssembly compilation and run serially to avoid compiler/memory exhaustion. Test
network access was disabled to prevent the existing live security tests from sending
mutating requests. Their three live-response assertions cannot pass offline.

The pre-existing `noFallthroughCassesInSwitch` typo in the user-modified
`tsconfig.node.json` still blocks `npm run build`; that file was intentionally left
untouched. Frontend type compilation and standalone Vite production bundling are checked
separately. Arabic RTL and existing color tokens are preserved.

## Files changed

- [docs/FRONTEND_PHASE_2.md](C:/Users/Glory/OneDrive/Desktop/warehouse-ledger/docs/FRONTEND_PHASE_2.md)
- [package-lock.json](C:/Users/Glory/OneDrive/Desktop/warehouse-ledger/package-lock.json)
- [package.json](C:/Users/Glory/OneDrive/Desktop/warehouse-ledger/package.json)
- [src/App.tsx](C:/Users/Glory/OneDrive/Desktop/warehouse-ledger/src/App.tsx)
- [src/components/CustodyItemHistoryModal.tsx](C:/Users/Glory/OneDrive/Desktop/warehouse-ledger/src/components/CustodyItemHistoryModal.tsx)
- [src/lib/backup.ts](C:/Users/Glory/OneDrive/Desktop/warehouse-ledger/src/lib/backup.ts)
- [src/lib/custody.ts](C:/Users/Glory/OneDrive/Desktop/warehouse-ledger/src/lib/custody.ts)
- [src/lib/custodyImport.ts](C:/Users/Glory/OneDrive/Desktop/warehouse-ledger/src/lib/custodyImport.ts)
- [src/lib/derive.ts](C:/Users/Glory/OneDrive/Desktop/warehouse-ledger/src/lib/derive.ts)
- [src/lib/fixture.ts](C:/Users/Glory/OneDrive/Desktop/warehouse-ledger/src/lib/fixture.ts)
- [src/lib/inventoryOperations.ts](C:/Users/Glory/OneDrive/Desktop/warehouse-ledger/src/lib/inventoryOperations.ts)
- [src/lib/inventoryRepository.ts](C:/Users/Glory/OneDrive/Desktop/warehouse-ledger/src/lib/inventoryRepository.ts)
- [src/lib/inventoryStorage.ts](C:/Users/Glory/OneDrive/Desktop/warehouse-ledger/src/lib/inventoryStorage.ts)
- [src/lib/inventoryTypes.ts](C:/Users/Glory/OneDrive/Desktop/warehouse-ledger/src/lib/inventoryTypes.ts)
- [src/lib/movementStorage.ts](C:/Users/Glory/OneDrive/Desktop/warehouse-ledger/src/lib/movementStorage.ts)
- [src/lib/movementsRepository.ts](C:/Users/Glory/OneDrive/Desktop/warehouse-ledger/src/lib/movementsRepository.ts)
- [src/lib/quality.ts](C:/Users/Glory/OneDrive/Desktop/warehouse-ledger/src/lib/quality.ts)
- [src/lib/useInventory.ts](C:/Users/Glory/OneDrive/Desktop/warehouse-ledger/src/lib/useInventory.ts)
- [src/pages/CustodyPage.tsx](C:/Users/Glory/OneDrive/Desktop/warehouse-ledger/src/pages/CustodyPage.tsx)
- [src/pages/QualityPage.tsx](C:/Users/Glory/OneDrive/Desktop/warehouse-ledger/src/pages/QualityPage.tsx)
- [src/pages/ReportsPage.tsx](C:/Users/Glory/OneDrive/Desktop/warehouse-ledger/src/pages/ReportsPage.tsx)
- [src/test/setup.ts](C:/Users/Glory/OneDrive/Desktop/warehouse-ledger/src/test/setup.ts)
- [supabase/migrations/20261103173855_frontend_inventory_integrity.sql](C:/Users/Glory/OneDrive/Desktop/warehouse-ledger/supabase/migrations/20261103173855_frontend_inventory_integrity.sql)
- [tests/unit/backup.test.ts](C:/Users/Glory/OneDrive/Desktop/warehouse-ledger/tests/unit/backup.test.ts)
- [tests/unit/custody.test.ts](C:/Users/Glory/OneDrive/Desktop/warehouse-ledger/tests/unit/custody.test.ts)
- [tests/unit/custodyImport.test.ts](C:/Users/Glory/OneDrive/Desktop/warehouse-ledger/tests/unit/custodyImport.test.ts)
- [tests/unit/inventoryDatabase.test.ts](C:/Users/Glory/OneDrive/Desktop/warehouse-ledger/tests/unit/inventoryDatabase.test.ts)
- [tests/unit/inventoryLedger.test.ts](C:/Users/Glory/OneDrive/Desktop/warehouse-ledger/tests/unit/inventoryLedger.test.ts)
- [tests/unit/inventoryOperations.test.ts](C:/Users/Glory/OneDrive/Desktop/warehouse-ledger/tests/unit/inventoryOperations.test.ts)
- [tests/unit/inventoryRepository.test.ts](C:/Users/Glory/OneDrive/Desktop/warehouse-ledger/tests/unit/inventoryRepository.test.ts)
- [tests/unit/inventoryViews.test.tsx](C:/Users/Glory/OneDrive/Desktop/warehouse-ledger/tests/unit/inventoryViews.test.tsx)
- [tests/unit/movementsRepository.test.ts](C:/Users/Glory/OneDrive/Desktop/warehouse-ledger/tests/unit/movementsRepository.test.ts)
- [tests/unit/purchases.test.ts](C:/Users/Glory/OneDrive/Desktop/warehouse-ledger/tests/unit/purchases.test.ts)
- [tests/unit/recordPurchaseRpc.test.ts](C:/Users/Glory/OneDrive/Desktop/warehouse-ledger/tests/unit/recordPurchaseRpc.test.ts)
- [vite.config.ts](C:/Users/Glory/OneDrive/Desktop/warehouse-ledger/vite.config.ts)
