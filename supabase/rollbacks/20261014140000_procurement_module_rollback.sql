-- Rollback: 20261014140000_procurement_module_rollback.sql
-- Description: Reverses 20261014140000_procurement_module.sql cleanly without touching core data.

BEGIN;

-- 1. Drop View
DROP VIEW IF EXISTS public.supplier_stats CASCADE;

-- 2. Drop RPCs
DROP FUNCTION IF EXISTS public.mark_po_invoiced(UUID);
DROP FUNCTION IF EXISTS public.mark_po_received(UUID);
DROP FUNCTION IF EXISTS public.create_purchase_order(UUID);
DROP FUNCTION IF EXISTS public.select_quote(UUID, UUID);
DROP FUNCTION IF EXISTS public.record_approval(UUID, INT, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.submit_purchase_request(UUID);
DROP FUNCTION IF EXISTS public.can_access_procurement();

-- 3. Remove additive columns from movements
ALTER TABLE IF EXISTS public.movements DROP COLUMN IF EXISTS purchase_order_id;
ALTER TABLE IF EXISTS public.movements DROP COLUMN IF EXISTS supplier_id;

-- 4. Drop Procurement Tables (in reverse dependency order)
DROP TABLE IF EXISTS public.purchase_orders CASCADE;
DROP TABLE IF EXISTS public.supplier_quotes CASCADE;
DROP TABLE IF EXISTS public.purchase_request_approvals CASCADE;
DROP TABLE IF EXISTS public.purchase_request_items CASCADE;
DROP TABLE IF EXISTS public.purchase_requests CASCADE;
DROP TABLE IF EXISTS public.suppliers CASCADE;

-- 5. Drop sequences and helper functions
DROP FUNCTION IF EXISTS public.next_purchase_order_no();
DROP FUNCTION IF EXISTS public.next_purchase_request_no();
DROP SEQUENCE IF EXISTS public.seq_purchase_order_no;
DROP SEQUENCE IF EXISTS public.seq_purchase_request_no;
DROP FUNCTION IF EXISTS public.normalize_arabic_name(TEXT);

COMMIT;
