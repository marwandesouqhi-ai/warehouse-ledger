-- Rollback: Engineering Workshops Custody Import
-- Timestamp: 20261102200000

DELETE FROM public.custody_items
WHERE warehouse_id = 'engineering_workshops' AND import_batch_id = 'ws-import-2026-11-02';

DROP FUNCTION IF EXISTS public.import_custody_batch(TEXT, TEXT, JSONB, BOOLEAN, BOOLEAN);
DROP INDEX IF EXISTS public.custody_items_wh_code_unique;
DROP INDEX IF EXISTS public.idx_custody_items_import_batch;
ALTER TABLE public.custody_items DROP COLUMN IF EXISTS import_batch_id;
