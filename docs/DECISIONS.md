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
## 2026-10-13 (Security Hardening and Purchasing Staff Scope)
- **Elimination of `user_metadata` for Authorization**: Replaced all permission and role evaluation points that inspected `user_metadata` with server-signed `app_metadata` (`role`, `permissions`, `system_admin`). This completely eliminates client-side privilege escalation attacks via `supabase.auth.updateUser`.
- **Zero Lockout Dual-Mode Architecture (`authMode.ts`)**: Implemented dual-mode authentication controlled by feature flag `VITE_AUTH_MODE` (defaulting to `'legacy'`). Guarantees existing users can always log in without interruption during the migration window.
- **Redaction of Hardcoded Credentials**: Redacted plaintext admin password from code (`DEFAULT_ADMIN.password: ''`), stopped localStorage password persistence in secure mode, eliminated cloud password fetching in `fetchUsersFromCloud`, and sanitized past migrations.
- **Service-Role Edge Functions (`admin-users` & `migrate-users`)**: Isolated all user lifecycle operations (creation, password change, role updates, demotion protection for `marwan-desouky`) in serverless Edge Functions that enforce strict JWT verification. Created an idempotent migration function to transfer existing users to Supabase Auth with synthetic emails (`<username>@warehouse.local`).
- **Unit-Wide Purchasing Staff Scope (`purchasesScope = 'all'`)**: Locked purchasing visibility to unit-wide (`all`), enabling purchasing staff to view all invoices (their own, other staff members', and historical receipts). Added "سُجِّلت بواسطة" (`created_by`) attribution with staff filter dropdown and Excel export.
- **Isolated RLS Hardening with Rollback Scripts**: Developed strict RLS policies revoking `anon` on all sensitive tables, making `audit_logs` append-only with anti-tamper triggers, and isolating all RLS scripts into separate, unapplied migration files accompanied by a 1-click rollback script.
- **Atomic `record_purchase` RPC**: Implemented a `SECURITY DEFINER` database function allowing purchasing staff to register purchase movements and atomically increment the `main` warehouse custody item without granting direct write permissions on the custody table.

## 2026-10-14 (Protected System Admin, Zero-Lockout Login Bridge, and Purchase RPC Alignment)
- **Absolute Protection for System Admin (`marwan-desouky`)**: Established non-bypassable, four-layer protection:
  1. Database Triggers (`BEFORE UPDATE OR DELETE OR INSERT`) on `app_users` rejecting all mutations and deletions even when invoked by `service_role`. Only emergency SQL Editor access by `postgres`/`supabase_admin` is permitted.
  2. Serverless Edge Function (`admin-users`) blocks listing, modifying, elevating, or deleting `marwan-desouky` or deleting `admin`.
  3. Client UI (`UsersPage`) hides the row, counters, export, and editing for all users except the owner himself.
  4. Homoglyph-resistant NFKC normalization and zero-width stripping in TypeScript and SQL to prevent lookalike username impersonation.
- **Sole System Admin Rule**: Blocked creating or promoting any other user to `system_admin` or `app_metadata.system_admin = true`. Additional privileges must be granted via explicit granular permissions (`view_audit`, `view_settings`, `manage_records`).
- **Zero-Lockout Architecture (`login-bridge`)**:
  - Replaced the vulnerable browser-side `anon` password reading with a server-side Edge Function (`login-bridge`).
  - Implemented constant-time password matching (`crypto.subtle.timingSafeEqual`) and rate-limiting via additive `login_attempts` table (5 failed attempts per 15 minutes).
  - Explicitly excluded `marwan-desouky` from `login-bridge` to enforce manual provisioning.
- **Real Schema Alignment for `record_purchase` RPC**:
  - Replaced the schema-incompatible prototype with `20261014130000_fix_record_purchase_rpc.sql`. Uses true UUID identifiers, writes to `received_on`, enforces JWT author identity, applies row-locking (`FOR UPDATE`) on `custody_items`, and sets `auth.uid()` as a valid foreign key in `audit_logs`.
  - Wired frontend (`App.tsx`) to invoke the RPC and reload custody from cloud, completely eliminating double increments.
- **Custody Overwrite Protection Strategy**: Added a smart cloud-reconciliation check in `saveCustodyItemsToCloud` ensuring stale client state cannot overwrite higher cloud balances created by atomic purchase RPCs.
- **Pending RLS Migration Isolation**: Moved `harden_rls.sql` to `supabase/pending/` with clear gatekeeping conditions to guarantee zero accidental lockouts. Enhanced with server-side `BEFORE INSERT` trigger on `audit_logs` enforcing authentic JWT actor claims.
