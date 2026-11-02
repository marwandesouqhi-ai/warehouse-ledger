-- Rollback: 20261101170000_optimize_custody_print_and_reports.rollback.sql
-- Description: Rollback of custody items print and reporting performance indexes

DROP INDEX IF EXISTS public.custody_items_wh_created_idx;
DROP INDEX IF EXISTS public.custody_items_created_at_idx;

