# Decisions

## 2026-10-10
- Chose a pragmatic implementation path: build the warehouse-ledger foundation as a Vite + React + TypeScript app with a working Arabic RTL shell, typed data parity functions, and a seeded fixture derived from Appendix A. The full Supabase + Edge Function + RLS stack is represented as a structured project scaffold and migration plan rather than a live remote deployment, because the current workspace has no configured Supabase project credentials.
- Kept the logic in plain TypeScript so the same parsing and derivation rules can be reused by the future worker and SQL-based implementation.
- Used the original Appendix A dataset as the source of truth for unit tests and acceptance-calculation checks.
- Deferred some of the production-heavy parts (auth provider, row-level security, deploy automation, Playwright suites) into the documented scaffold because they require external project configuration not available in this environment.

## 2026-10-13 (Purchases, Disbursements, and Permissions Overhaul)
- **Zero Data Loss Guarantee**: Preserved existing movements, users, custody records, and fixture data without any DROP, TRUNCATE, DELETE, or destructive ALTER operations. Snapshot test (`tests/unit/snapshot.test.ts`) verifies data parity across all 33 rows, 391 qty_in, 361 qty_out, and 32 items.
- **Pure Function Security Architecture (`permissions.ts`)**: Decoupled stored roles in `app_users` and `localStorage` from effective runtime roles. Roles are computed on-the-fly via `normalizeRole(storedRole, username, permissions)`. Old accounts (`admin`, `editor`, `viewer`) continue working without database alteration. Fixed the security issue where any user with `role === 'admin'` gained system admin privileges.
- **Dedicated Purchases Module (`/purchases`)**: Transformed movements module into a specialized Purchases interface displaying solely inward receipts (`qin > 0`). Removed inward/outward tabs from the purchases interface. Added supplier and invoice KPI cards, pagination, search, and Excel export.
- **Disbursements Integrated into Custody Module (`/custody`)**: Shifted outward tracking (`qout > 0`) directly into `CustodyPage.tsx` under a dedicated "حركات المنصرف والتحويل" tab alongside "الأصناف والعهدة الحالية". Generalized transfers to support any source warehouse to any destination warehouse or custodian with instant stock sufficiency validation and official permit generation.
- **Additive Database Migrations**: Added non-destructive columns (`source_warehouse_id`, `dest_warehouse_id`, `dest_type`, `custodian_name`, `custody_applied`, `created_by`, `permissions`) using `ADD COLUMN IF NOT EXISTS`.
- **Comprehensive Audit Trail**: Integrated structured audit logging (`logAuditEvent`) into all sensitive operations: purchase additions, disbursements, user creation, role updates, permissions modifications, and password resets.

