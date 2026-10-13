-- supabase/migrations/20261013200000_transfers_custody_sources.sql
-- Phase 3: Additive columns for warehouse transfers and disbursement tracking

ALTER TABLE public.movements
  ADD COLUMN IF NOT EXISTS source_warehouse_id TEXT DEFAULT 'main';

ALTER TABLE public.movements
  ADD COLUMN IF NOT EXISTS dest_warehouse_id TEXT;

ALTER TABLE public.movements
  ADD COLUMN IF NOT EXISTS dest_type TEXT DEFAULT 'warehouse';

ALTER TABLE public.movements
  ADD COLUMN IF NOT EXISTS custodian_name TEXT;

COMMENT ON COLUMN public.movements.source_warehouse_id IS 'ID of source warehouse for outward transfer (e.g. main, pharmacy, etc.)';
COMMENT ON COLUMN public.movements.dest_warehouse_id IS 'ID of destination warehouse for inter-branch transfer';
COMMENT ON COLUMN public.movements.dest_type IS 'Destination classification: warehouse (inter-branch transfer) or custodian (personal/departmental custody)';
COMMENT ON COLUMN public.movements.custodian_name IS 'Recipient employee or custodian name if dest_type is custodian';
