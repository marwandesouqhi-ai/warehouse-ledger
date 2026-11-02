-- Rollback Migration: 20261102230000_sync_medicine_nursing_67_items.rollback.sql
DELETE FROM public.custody_items WHERE warehouse_id = 'medicine' AND id LIKE 'cust-med-verified-%';
NOTIFY pgrst, 'reload schema';

